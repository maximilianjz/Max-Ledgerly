import type { WebhookReceipt } from "../whop-webhooks.ts";
import {
  comparable,
  normalizeTransaction,
  paymentOrder,
  projectLedger,
  type Transaction,
  timestamp,
  transactionKey,
} from "./ledger.ts";
import { assertPlatform } from "./onboarding.ts";
import { listAll, type Provider } from "./provider.ts";
import { canonical, IntegrationError, type JsonObject, type LocalStore } from "./store.ts";

export type Difference = { kind: string; resourceId: string; fields?: string[] };

export function diffTransactions(local: Transaction[], remote: Transaction[]): Difference[] {
  const differences: Difference[] = [];
  const index = (rows: Transaction[], side: string) => {
    const map = new Map<string, Transaction>();
    for (const row of rows) {
      const key = transactionKey(row);
      if (map.has(key)) differences.push({ kind: `duplicate_${side}`, resourceId: row.id });
      map.set(key, row);
    }
    return map;
  };
  const left = index(local, "local");
  const right = index(remote, "provider");
  for (const [key, row] of right) {
    const existing = left.get(key);
    if (!existing) differences.push({ kind: "missing_local", resourceId: row.id });
    else {
      const a = comparable(existing);
      const b = comparable(row);
      const fields = (Object.keys(b) as (keyof typeof b)[]).filter(
        (field) => canonical(a[field]) !== canonical(b[field]),
      );
      if (fields.length) differences.push({ kind: "mismatch", resourceId: row.id, fields });
    }
  }
  for (const [key, row] of left)
    if (!right.has(key)) differences.push({ kind: "missing_provider", resourceId: row.id });
  return differences;
}

export async function reconcile(
  store: LocalStore,
  provider: Provider,
  sellerExternalId: string,
  window: { from: string; to: string },
  receipts: WebhookReceipt[],
) {
  const from = timestamp(window.from);
  const to = timestamp(window.to);
  if (from >= to)
    throw new IntegrationError(
      "invalid_window",
      "The start must be before the end of the creation-time window.",
    );
  const startedAt = new Date().toISOString();
  const { platformAccountId } = await assertPlatform(store, provider);
  const seller = await store.seller(sellerExternalId);
  const query = { created_after: from, created_before: to };
  const ledger = await projectLedger(store, receipts, { sellerExternalId, from, to });
  // Read both payment owners: a platform sale belongs to Ledgerly, while its
  // order identifies the seller entitled to the later transfer.
  const direct = await listAll(provider, "/payments", { ...query, account_id: seller.accountId });
  const platform = await listAll(provider, "/payments", {
    ...query,
    account_id: platformAccountId,
  });
  const incoming = await listAll(provider, "/transfers", {
    ...query,
    destination_id: seller.accountId,
  });
  const outgoing = await listAll(provider, "/transfers", { ...query, origin_id: seller.accountId });
  const remote: Transaction[] = [];
  const unresolved: Difference[] = [];
  const inWindow = (record: Transaction) => record.createdAt > from && record.createdAt < to;
  const add = (kind: Transaction["kind"], data: JsonObject, accountId: string) => {
    try {
      const record = normalizeTransaction(kind, data, seller, accountId);
      if (inWindow(record)) remote.push(record);
    } catch (error) {
      unresolved.push({
        kind: error instanceof IntegrationError ? error.code : "invalid_transaction",
        resourceId: String(data.id || "unknown"),
      });
    }
  };
  for (const data of direct.records) {
    if (data.account_id !== seller.accountId)
      unresolved.push({ kind: "unexpected_payment_owner", resourceId: String(data.id) });
    else add("payment", data, seller.accountId);
  }
  let unrelatedPlatformPayments = 0;
  for (const data of platform.records) {
    try {
      const order = await paymentOrder(store, data);
      if (!order) {
        unresolved.push({ kind: "unresolved_platform_order", resourceId: String(data.id) });
        continue;
      }
      if (order.sellerExternalId !== sellerExternalId) {
        unrelatedPlatformPayments++;
        continue;
      }
      if (
        data.account_id !== platformAccountId ||
        order.chargeAccountId !== platformAccountId ||
        order.flow !== "platform"
      ) {
        unresolved.push({ kind: "unexpected_payment_owner", resourceId: String(data.id) });
      } else add("payment", data, platformAccountId);
    } catch {
      unresolved.push({ kind: "order_conflict", resourceId: String(data.id) });
    }
  }
  // Self-transfers may appear in both lists. Deduplicate that overlap only;
  // duplicate IDs within either paginated list remain visible to the diff.
  const incomingIds = new Set(incoming.records.map((row) => row.id));
  for (const data of incoming.records) add("transfer", data, seller.accountId);
  for (const data of outgoing.records)
    if (!incomingIds.has(data.id)) add("transfer", data, seller.accountId);
  const local = ledger.transactions.filter(
    (row) => row.sellerExternalId === sellerExternalId && inWindow(row),
  );
  const differences = [
    ...diffTransactions(local, remote),
    ...unresolved,
    ...ledger.issues.map((issue) => ({ kind: issue.reason, resourceId: issue.resourceId })),
  ];
  return {
    source: "read_only_reconciliation",
    environment: (await store.context()).environment,
    sellerExternalId,
    sellerAccountId: seller.accountId,
    window: { from, to, boundaries: "exclusive" },
    startedAt,
    completedAt: new Date().toISOString(),
    coverage: {
      complete: true,
      pages: {
        directPayments: direct.pages,
        platformPayments: platform.pages,
        incomingTransfers: incoming.pages,
        outgoingTransfers: outgoing.pages,
      },
      unrelatedPlatformPayments,
    },
    localCount: local.length,
    providerCount: remote.length,
    clean: differences.length === 0,
    differences,
  };
}
