import { z } from "zod";
import { isCountryCode } from "../countries.ts";
import { EMAIL_PATTERN, EXTERNAL_ID } from "../seller-contracts.ts";
import { API_VERSION, listAll, type Provider, trustedWhopUrl } from "./provider.ts";
import {
  canonical,
  digest,
  IntegrationError,
  type JsonObject,
  type Operation,
  object,
  type Seller,
  type SellerInput,
  type Store,
} from "./store.ts";

export const sellerInputSchema = z.object({
  externalId: z
    .string()
    .trim()
    .regex(EXTERNAL_ID, "Use a stable external ID of 1–120 letters, digits, or . _ : -."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .regex(new RegExp(`^${EMAIL_PATTERN}$`), "Provide a valid seller email."),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .refine(
      isCountryCode,
      "Choose a valid two-letter country code for the seller’s business location.",
    ),
});

function sellerInput(input: SellerInput): SellerInput {
  const parsed = sellerInputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const codes: Record<string, string> = {
      externalId: "invalid_external_id",
      email: "invalid_email",
      country: "invalid_country",
    };
    throw new IntegrationError(codes[String(issue.path[0])] || "invalid_seller", issue.message);
  }
  return parsed.data;
}

export async function assertPlatform(store: Store, provider: Provider) {
  const context = await store.context();
  const account = await provider.request("GET", "/accounts/me");
  if (account.id !== context.platformAccountId || account.parent_account != null) {
    throw new IntegrationError(
      "wrong_platform",
      "The key must belong to the configured parent account.",
    );
  }
  return context;
}

export function checkRetry<T>(operation: Operation<T>, provider: Provider, now: number) {
  if (operation.credentialId !== provider.credentialId) {
    throw new IntegrationError(
      "credential_changed",
      "The pending operation used another credential. Recover its existing resource before retrying.",
    );
  }
  const age = now - Date.parse(operation.startedAt);
  // Whop retains keys for 24h. Leave a one-hour safety margin for clock/latency.
  if (!Number.isFinite(age) || age < 0 || age >= 23 * 60 * 60 * 1000) {
    throw new IntegrationError(
      "outcome_unknown",
      "The retry window expired. No new resource was created; inspect the original operation before proceeding.",
    );
  }
}

export function verifiedSeller(
  account: JsonObject,
  input: SellerInput,
  platformAccountId: string,
): Seller {
  if (
    typeof account.id !== "string" ||
    !/^biz_[A-Za-z0-9]+$/.test(account.id) ||
    object(account.parent_account).id !== platformAccountId ||
    object(account.metadata).external_id !== input.externalId ||
    typeof account.email !== "string" ||
    account.email.toLowerCase() !== input.email ||
    typeof account.country !== "string" ||
    account.country.toUpperCase() !== input.country
  ) {
    throw new IntegrationError(
      "seller_identity_mismatch",
      "Whop's account identity does not match the external ID, email, country, and parent. No new binding was saved.",
    );
  }
  return { ...input, accountId: account.id, platformAccountId };
}

export async function readConnectedAccount(provider: Provider, seller: Seller) {
  // Removed accounts can still be retrieved by ID. Check the parent's current
  // connections so a saved binding does not grant access after removal.
  const { records } = await listAll(provider, "/accounts", {
    parent_account_id: seller.platformAccountId,
    query: seller.accountId,
  });
  const account = records.find((record) => record.id === seller.accountId);
  if (!account)
    throw new IntegrationError(
      "seller_unavailable",
      "This seller is no longer connected to Ledgerly. Choose another seller.",
    );
  return account;
}

export async function ensureSeller(
  store: Store,
  provider: Provider,
  raw: SellerInput,
  now = Date.now(),
) {
  const input = sellerInput(raw);
  const { platformAccountId } = await assertPlatform(store, provider);
  const operation = await store.put<Operation<SellerInput>>("seller-inputs", input.externalId, {
    input,
    key: `ledgerly-account-${digest([platformAccountId, input.externalId])}`,
    startedAt: new Date(now).toISOString(),
    credentialId: provider.credentialId,
    apiVersion: API_VERSION,
  });
  if (canonical(operation.input) !== canonical(input) || operation.apiVersion !== API_VERSION) {
    throw new IntegrationError(
      "identity_conflict",
      "That seller external ID already has different inputs or an API version. Use the original inputs.",
    );
  }
  const existing = await store.read<Seller>("sellers", input.externalId);
  let remote: JsonObject;
  if (existing) {
    remote = await readConnectedAccount(provider, existing);
  } else {
    const { records } = await listAll(provider, "/accounts", {
      parent_account_id: platformAccountId,
    });
    const matches = records.filter(
      (account) => object(account.metadata).external_id === input.externalId,
    );
    if (matches.length > 1)
      throw new IntegrationError(
        "duplicate_seller",
        "Whop returned multiple accounts for this external ID. Resolve the identity conflict first.",
      );
    remote = matches[0];
    if (!remote) {
      checkRetry(operation, provider, now);
      remote = await provider.request("POST", "/accounts", {
        key: operation.key,
        version: operation.apiVersion,
        body: {
          email: input.email,
          country: input.country,
          metadata: { external_id: input.externalId },
        },
      });
    }
  }
  const seller = verifiedSeller(remote, input, platformAccountId);
  if (remote.status === "suspended")
    throw new IntegrationError(
      "seller_suspended",
      "This seller is suspended; it must not be recreated.",
    );
  return store.exact("sellers", input.externalId, seller);
}

export async function onboardSeller(
  store: Store,
  provider: Provider,
  raw: SellerInput,
  links: { returnUrl: string; refreshUrl: string },
  now = Date.now(),
) {
  for (const value of [links.returnUrl, links.refreshUrl]) {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password)
      throw new IntegrationError(
        "invalid_callback",
        "Onboarding callbacks must use HTTPS without embedded credentials.",
      );
  }
  const seller = await ensureSeller(store, provider, raw, now);
  // Links are intentionally refreshed on each call and never cached in the registry.
  const link = await provider.request("POST", "/account_links", {
    body: {
      account_id: seller.accountId,
      use_case: "account_onboarding",
      return_url: links.returnUrl,
      refresh_url: links.refreshUrl,
    },
  });
  if (
    typeof link.expires_at !== "string" ||
    Date.parse(link.expires_at) <= now ||
    !Number.isFinite(Date.parse(link.expires_at))
  ) {
    throw new IntegrationError(
      "invalid_link",
      "Whop returned an invalid onboarding-link expiration.",
    );
  }
  return { seller, onboardingUrl: trustedWhopUrl(link.url), expiresAt: link.expires_at };
}
