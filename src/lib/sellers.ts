import "server-only";
import { getAccountId, getAppOrigin, getWhopKey } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { createCheckout } from "@/lib/integration/checkout";
import { priceWithFee } from "@/lib/integration/money";
import {
  assertPlatform,
  ensureSeller,
  onboardSeller,
  verifiedSeller,
} from "@/lib/integration/onboarding";
import { WhopProvider } from "@/lib/integration/provider";
import { configuredContext, createStore, storageIssue } from "@/lib/integration/storage";
import {
  IntegrationError,
  object,
  type Seller,
  type SellerInput,
  type Store,
} from "@/lib/integration/store";
import {
  EXTERNAL_ID,
  type PaymentLinkInput,
  type SellerStatus,
  sellerPath,
} from "@/lib/seller-contracts";

function platformContext() {
  const context = configuredContext();
  if (context.environment !== "production")
    throw new AppError(
      "This workspace uses production. Set WHOP_ENVIRONMENT to production.",
      503,
      "environment_mismatch",
    );
  return context;
}

export function onboardingIssue() {
  try {
    platformContext();
    getWhopKey();
    return storageIssue();
  } catch (error) {
    return error instanceof AppError || error instanceof IntegrationError
      ? error.message
      : "Seller onboarding is not configured.";
  }
}

export function verificationIssue() {
  return (
    onboardingIssue() ||
    (getAppOrigin().startsWith("https:")
      ? null
      : "Use your deployed HTTPS workspace to continue verification or create payment links.")
  );
}

export async function registeredStore(store: Store = createStore()) {
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

export async function createSellerPaymentLink(externalId: string, input: PaymentLinkInput) {
  priceWithFee(input.amount, "usd");
  const origin = getAppOrigin();
  if (!origin.startsWith("https:"))
    throw new AppError(
      "Creating a payment link requires an HTTPS workspace. Open your deployed Ledgerly page.",
      503,
      "https_required",
    );
  return createCheckout(await registeredStore(), new WhopProvider(getWhopKey()), {
    ...input,
    sellerExternalId: externalId,
    currency: "usd",
    flow: "direct",
    redirectUrl: `${origin}${sellerPath(externalId)}`,
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
    };
  const state = await readSellerStatus(externalId);
  if (state.status === "suspended")
    throw new AppError("This seller is suspended.", 403, "seller_suspended");
  return state.seller;
}

export function requestedSeller(request: Request) {
  const values = new URL(request.url).searchParams.getAll("seller");
  if (values.length > 1 || (values.length && !EXTERNAL_ID.test(values[0])))
    throw new AppError("Choose a registered seller.", 400, "invalid_seller");
  return values[0];
}
