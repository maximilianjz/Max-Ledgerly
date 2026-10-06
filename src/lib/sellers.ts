import "server-only";
import { getAccountId, getAppOrigin, getWhopKey } from "@/lib/config";
import { AppError } from "@/lib/errors";
import {
  assertPlatform,
  ensureSeller,
  onboardSeller,
  verifiedSeller,
} from "@/lib/integration/onboarding";
import { WhopProvider } from "@/lib/integration/provider";
import { createStore, storageIssue } from "@/lib/integration/storage";
import {
  type Context,
  object,
  type Seller,
  type SellerInput,
  type Store,
} from "@/lib/integration/store";
import { type SellerStatus, sellerPath } from "@/lib/seller-contracts";

function platformContext(): Context {
  const platformAccountId = process.env.WHOP_PLATFORM_ACCOUNT_ID || "";
  if (!/^biz_[A-Za-z0-9]+$/.test(platformAccountId))
    throw new AppError(
      "Configure the platform account before adding sellers.",
      503,
      "configuration_required",
    );
  if (process.env.WHOP_ENVIRONMENT && process.env.WHOP_ENVIRONMENT !== "production")
    throw new AppError(
      "This workspace uses production. Keep sandbox work in the separate CLI environment.",
      503,
      "environment_mismatch",
    );
  return { platformAccountId, environment: "production" };
}

export function onboardingIssue() {
  try {
    platformContext();
    getWhopKey();
    return storageIssue();
  } catch (error) {
    return error instanceof AppError ? error.message : "Seller onboarding is not configured.";
  }
}

export function verificationIssue() {
  return (
    onboardingIssue() ||
    (getAppOrigin().startsWith("https:")
      ? null
      : "Whop verification opens from an HTTPS workspace. You can create a seller and check its status locally; continuing on Whop becomes available after secure hosting.")
  );
}

async function registeredStore(store: Store = createStore()) {
  const configured = platformContext();
  const saved = await store.context();
  if (
    saved.platformAccountId !== configured.platformAccountId ||
    saved.environment !== "production"
  )
    throw new AppError(
      "The saved sellers belong to another environment or platform.",
      409,
      "environment_mismatch",
    );
  return store;
}

export async function listSellers() {
  if (storageIssue()) return [];
  const store = createStore();
  if (!(await store.read("context", "platform"))) return [];
  return (await (await registeredStore(store)).list<Seller>("sellers")).sort((a, b) =>
    a.externalId.localeCompare(b.externalId),
  );
}

export async function createSeller(input: SellerInput) {
  const issue = onboardingIssue();
  if (issue) throw new AppError(issue, 503, "configuration_required");
  const store = createStore();
  await store.initialize(platformContext());
  return ensureSeller(store, new WhopProvider(getWhopKey()), input);
}

export async function readSellerStatus(externalId: string): Promise<SellerStatus> {
  const store = await registeredStore();
  const seller = await store.seller(externalId);
  const provider = new WhopProvider(getWhopKey());
  const context = await assertPlatform(store, provider);
  const account = await provider.request("GET", `/accounts/${seller.accountId}`);
  const verified = verifiedSeller(account, seller, context.platformAccountId);
  if (verified.accountId !== seller.accountId)
    throw new AppError(
      "Whop returned a different account for this seller.",
      502,
      "seller_identity_mismatch",
    );
  const verification = object(account.verification);
  const status = (value: unknown) =>
    typeof object(value).status === "string" ? (object(value).status as string) : null;
  return {
    seller,
    status: typeof account.status === "string" ? account.status : "unknown",
    verification: {
      individual: status(verification.individual),
      business: status(verification.business),
    },
    requiredActions: Array.isArray(account.required_actions)
      ? account.required_actions.map((value) => {
          const action = object(value);
          return {
            title: typeof action.title === "string" ? action.title : "Action required",
            description:
              typeof action.description === "string"
                ? action.description
                : "Continue on Whop to review this step.",
            status: typeof action.status === "string" ? action.status : "unknown",
          };
        })
      : null,
    capabilities: Object.fromEntries(
      Object.entries(object(account.capabilities)).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
    checkedAt: new Date().toISOString(),
  };
}

export async function sellerOnboardingLink(externalId: string) {
  const issue = verificationIssue();
  if (issue) throw new AppError(issue, 503, "https_required");
  const store = await registeredStore();
  const seller = await store.seller(externalId);
  const callback = `${getAppOrigin()}${sellerPath(externalId)}`;
  return onboardSeller(store, new WhopProvider(getWhopKey()), seller, {
    returnUrl: `${callback}?returned=1`,
    refreshUrl: `${callback}?refresh=1`,
  });
}

// Query values select a registered external ID, never an arbitrary Whop account
// ID from the browser. Visitor access must be controlled by the deployment.
export async function payoutSeller(externalId?: string) {
  if (!externalId)
    return {
      accountId: getAccountId(),
      externalId: undefined,
      country: "",
      label: "Configured seller",
    };
  const state = await readSellerStatus(externalId);
  if (state.status === "suspended")
    throw new AppError("This seller is suspended.", 403, "seller_suspended");
  return { ...state.seller, label: state.seller.externalId };
}

export function requestedSeller(request: Request) {
  const values = new URL(request.url).searchParams.getAll("seller");
  if (
    values.length > 1 ||
    (values.length && !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(values[0]))
  )
    throw new AppError("Choose a registered seller.", 400, "invalid_seller");
  return values[0];
}
