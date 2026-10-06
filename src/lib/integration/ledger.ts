import type { WebhookReceipt } from "../whop-webhooks.ts";
import { usdMinor } from "./money.ts";
import {
  type Checkout,
  canonical,
  IntegrationError,
  type JsonObject,
  type Operation,
  type Order,
  object,
  type Seller,
  type Store,
} from "./store.ts";

export type Transaction = {
  kind: "payment" | "transfer";
  id: string;
  sellerExternalId: string;
  accountId: string;
  amountMinor: number;
  currency: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  originLedgerId: string | null;
  destinationLedgerId: string | null;
};
type LedgerIssue = { resourceId: string; reason: string; eventId?: string };

export function timestamp(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new IntegrationError("invalid_timestamp", "Transaction timestamp is missing or invalid.");
  }
  return new Date(value).toISOString();
}

export async function paymentOrder(store: Store, data: JsonObject) {
  const metadataId = object(data.metadata).ledgerly_order_id;
  const checkoutId = data.checkout_configuration_id;
  const checkout =
    typeof checkoutId === "string" ? await store.checkoutById(checkoutId) : undefined;
  if (checkout && metadataId && checkout.orderId !== metadataId) {
    throw new IntegrationError(
      "order_conflict",
      "Payment metadata and checkout point to different orders.",
    );
  }
  const id = checkout?.orderId ?? metadataId;
  if (typeof id !== "string") return null;
  const order = (await store.read<Operation<Order>>("orders", id))?.input ?? null;
  const savedCheckout = await store.read<Checkout>("checkouts", id);
  const sellerId = object(data.metadata).ledgerly_seller_external_id;
  if (
    (savedCheckout && checkoutId && savedCheckout.id !== checkoutId) ||
    (order && sellerId && order.sellerExternalId !== sellerId)
  ) {
    throw new IntegrationError(
      "order_conflict",
      "Payment identity does not match the saved checkout and seller.",
    );
  }
  return order;
}

export async function routeSellers(
  store: Store,
  event: JsonObject,
  envelopeAccountId: string | null,
): Promise<Seller[]> {
  const { platformAccountId } = await store.context();
  const data = object(event.data);
  const kind = String(event.type).split(".")[0];
  if (kind === "transfer") {
    const origin = object(data.origin).id;
    const destination = object(data.destination).id;
    if (
      envelopeAccountId !== null &&
      (origin || destination) &&
      ![platformAccountId, origin, destination].includes(envelopeAccountId)
    )
      return [];
    const matches = await store.sellersByAccount(
      [origin, destination].filter((id): id is string => typeof id === "string"),
    );
    return matches.length
      ? matches
      : envelopeAccountId === null
        ? []
        : store.sellersByAccount([envelopeAccountId]);
  }
  if (envelopeAccountId === null) return [];
  if (kind === "account" && data.id !== envelopeAccountId) return [];
  if (kind === "payment" || kind === "dispute") {
    if (data.account_id && data.company_id && data.account_id !== data.company_id) return [];
    const accountId = data.account_id ?? data.company_id ?? envelopeAccountId;
    if (accountId !== envelopeAccountId) return [];
    if (kind === "payment" && accountId === platformAccountId) {
      const order = await paymentOrder(store, data);
      if (!order || order.chargeAccountId !== platformAccountId || order.flow !== "platform")
        return [];
      const seller = await store.read<Seller>("sellers", order.sellerExternalId);
      return seller?.accountId === order.sellerAccountId ? [seller] : [];
    }
  }
  return store.sellersByAccount([envelopeAccountId]);
}

export function normalizeTransaction(
  kind: Transaction["kind"],
  data: JsonObject,
  seller: Seller,
  accountId: string,
  observedAt?: string,
): Transaction {
  const money = object(data.total);
  const amount =
    kind === "payment" ? (money.amount ?? data.final_amount ?? data.amount) : data.amount;
  const currency = data.currency ?? money.currency;
  if (currency !== "usd" || (money.currency && money.currency !== currency)) {
    throw new IntegrationError(
      "unsupported_currency",
      "This ledger compares USD amounts only; no currency conversion is implied.",
    );
  }
  if (
    typeof data.id !== "string" ||
    !new RegExp(kind === "payment" ? "^pay_[A-Za-z0-9]+$" : "^ctt_[A-Za-z0-9]+$").test(data.id) ||
    typeof data.status !== "string" ||
    !data.status
  ) {
    throw new IntegrationError("invalid_transaction", "Missing transaction ID or status.");
  }
  const status =
    kind === "payment" && data.status === "succeeded"
      ? "paid"
      : kind === "transfer" && data.status === "completed"
        ? "succeeded"
        : data.status;
  return {
    kind,
    id: data.id,
    sellerExternalId: seller.externalId,
    accountId,
    amountMinor: usdMinor(amount),
    currency,
    status,
    createdAt: timestamp(data.created_at),
    updatedAt: timestamp(data.updated_at ?? observedAt ?? data.created_at),
    originLedgerId:
      typeof data.origin_ledger_account_id === "string" ? data.origin_ledger_account_id : null,
    destinationLedgerId:
      typeof data.destination_ledger_account_id === "string"
        ? data.destination_ledger_account_id
        : null,
  };
}

export function transactionKey(record: Transaction) {
  return `${record.sellerExternalId}:${record.kind}:${record.id}`;
}
export function comparable(record: Transaction) {
  const { updatedAt: _updatedAt, ...rest } = record;
  return rest;
}

// The ledger is a projection of the durable inbox. There is no second write to
// lose between accepting an event and recording its transaction after a crash.
export async function projectLedger(
  store: Store,
  receipts: WebhookReceipt[],
  filter?: {
    sellerExternalId: string;
    from: string;
    to: string;
  },
) {
  const context = await store.context();
  const groups = new Map<string, Transaction[]>();
  const issues: LedgerIssue[] = [];
  for (const receipt of receipts) {
    if (!receipt.type.startsWith("payment.") && receipt.type !== "transfer.completed") continue;
    const data = object(receipt.payload.data);
    try {
      if (filter) {
        const created = timestamp(data.created_at);
        if (created <= filter.from || created >= filter.to) continue;
      }
      if ((context.environment === "fixture") !== (receipt.source === "local_fixture")) {
        throw new IntegrationError(
          "environment_mismatch",
          "Fixture and live observations must be kept separate.",
        );
      }
      const sellers = await routeSellers(store, receipt.payload, receipt.account_id);
      if (!sellers.length)
        throw new IntegrationError(
          "unresolved_seller",
          "No registered seller owns this transaction.",
        );
      for (const seller of sellers) {
        if (filter && seller.externalId !== filter.sellerExternalId) continue;
        const kind = receipt.type.startsWith("payment.") ? "payment" : "transfer";
        const accountId = kind === "payment" ? receipt.account_id : seller.accountId;
        if (accountId === null)
          throw new IntegrationError("unresolved_seller", "The payment has no owning account.");
        const record = normalizeTransaction(
          kind,
          data,
          seller,
          accountId,
          typeof receipt.payload.timestamp === "string" ? receipt.payload.timestamp : undefined,
        );
        const key = transactionKey(record);
        groups.set(key, [...(groups.get(key) || []), record]);
      }
    } catch (error) {
      issues.push({
        resourceId: String(data.id || "unknown"),
        eventId: receipt.event_id,
        reason: error instanceof IntegrationError ? error.code : "invalid_transaction",
      });
    }
  }
  const transactions: Transaction[] = [];
  for (const records of groups.values()) {
    records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const latest = records[0];
    const tied = records.filter((record) => record.updatedAt === latest.updatedAt);
    if (new Set(tied.map((record) => canonical(comparable(record)))).size > 1) {
      issues.push({ resourceId: latest.id, reason: "conflicting_observations" });
    } else transactions.push(latest);
  }
  return {
    transactions: transactions.sort((a, b) => transactionKey(a).localeCompare(transactionKey(b))),
    issues,
  };
}
