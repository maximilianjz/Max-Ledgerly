import { sanitizeWebhook, type WebhookReceipt } from "../whop-webhooks.ts";
import { normalizeTransaction, routeSellers } from "./ledger.ts";
import { assertPlatform } from "./onboarding.ts";
import { API_VERSION, type Provider } from "./provider.ts";
import { digest, IntegrationError, type Store } from "./store.ts";

// Read-only preparation. An operator reviews the result before calling saveReceipt.
// A payment snapshot must never be represented as a signed payment.succeeded event.
export async function preparePaymentRecovery(
  store: Store,
  provider: Provider,
  sellerExternalId: string,
  paymentId: string,
  reason: string,
) {
  if (!/^pay_[A-Za-z0-9]+$/.test(paymentId) || !reason.trim() || reason.length > 500)
    throw new IntegrationError("invalid_recovery", "Provide a payment ID and recovery reason.");
  const context = await assertPlatform(store, provider);
  if (context.environment === "fixture")
    throw new IntegrationError("environment_mismatch", "Recovery requires a live registry.");
  const seller = await store.seller(sellerExternalId);
  const endpoint = `/payments/${paymentId}`;
  const data = await provider.request("GET", endpoint, { version: API_VERSION });
  if (data.id !== paymentId || typeof data.account_id !== "string")
    throw new IntegrationError("invalid_recovery", "Whop returned a different payment identity.");
  const payload = sanitizeWebhook({
    type: "payment.snapshot",
    api_version_date: API_VERSION,
    account_id: data.account_id,
    data,
  });
  const sellers = await routeSellers(store, payload, data.account_id);
  if (
    seller.platformAccountId !== context.platformAccountId ||
    !sellers.some((row) => row.externalId === sellerExternalId)
  )
    throw new IntegrationError("unresolved_seller", "This payment does not belong to the seller.");
  const transaction = normalizeTransaction("payment", data, seller, data.account_id);
  // Exclude retrieval time so retrying an unchanged snapshot keeps the same identity.
  const id = `recovery_${digest([context, sellerExternalId, payload])}`;
  payload.id = id;
  const receipt: WebhookReceipt = {
    source: "api_recovery",
    event_id: id,
    type: "payment.snapshot",
    account_id: data.account_id,
    seller: sellerExternalId,
    disposition: "routed",
    payload_hash: digest(payload),
    received_at: new Date().toISOString(),
    payload,
    recovery: { endpoint, reason: reason.trim(), environment: context.environment },
  };
  return { receipt, transaction };
}
