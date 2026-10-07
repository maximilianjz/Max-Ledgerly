import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectLedger } from "@/lib/integration/ledger";
import { onboardSeller } from "@/lib/integration/onboarding";
import { PostgresStore } from "@/lib/integration/postgres";
import { reconcile } from "@/lib/integration/reconciliation";
import { preparePaymentRecovery } from "@/lib/integration/recovery";
import { type JsonObject, object } from "@/lib/integration/store";
import { readWebhookActivity } from "@/lib/webhook-activity";
import { listReceipts, saveReceipt } from "@/lib/whop-webhooks";
import { clearStorageEnvironment, StorageFixture } from "./storage-fixture";
import { FixtureProvider } from "./whop-fixture";

let database: StorageFixture;
let store: PostgresStore;
let provider: FixtureProvider;
let payment: JsonObject;
const scope = "recovery-test";
const sellerId = "seller-us";
const reason = "Payment predates webhook registration; no delivery to replay.";

beforeEach(async () => {
  clearStorageEnvironment();
  database = new StorageFixture();
  store = new PostgresStore(database, scope);
  provider = new FixtureProvider();
  vi.stubEnv("WHOP_PLATFORM_ACCOUNT_ID", provider.platformId);
  vi.stubEnv("WHOP_ENVIRONMENT", "production");
  await store.initialize({ platformAccountId: provider.platformId, environment: "production" });
  const { seller } = await onboardSeller(
    store,
    provider,
    { externalId: sellerId, email: "seller@example.test", country: "US" },
    {
      returnUrl: "https://ledgerly.example/return",
      refreshUrl: "https://ledgerly.example/refresh",
    },
  );
  payment = {
    id: "pay_historical",
    account_id: seller.accountId,
    status: "paid",
    total: { amount: "25.00", currency: "usd" },
    refunded_amount: { amount: "25.00", currency: "usd" },
    refunded_at: "2026-10-05T21:00:00.000Z",
    created_at: "2026-10-05T19:00:00.000Z",
    updated_at: "2026-10-05T21:00:00.000Z",
    customer_email: "private@example.test",
    client_secret: "private-payment-secret",
  };
  provider.payments.push(payment);
  const request = provider.request.bind(provider);
  vi.spyOn(provider, "request").mockImplementation(async (method, path, options) => {
    if (method === "GET" && path === "/payments/pay_historical") {
      provider.calls.push({ method, path, options: options || {} });
      return structuredClone(payment);
    }
    return request(method, path, options);
  });
  database.query.mockClear();
  provider.calls = [];
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const prepare = () => preparePaymentRecovery(store, provider, sellerId, "pay_historical", reason);

describe("reviewed historical payment recovery", () => {
  it("prepares a sanitized API snapshot without writing or claiming a webhook delivery", async () => {
    const { receipt, transaction } = await prepare();
    expect(database.query.mock.calls.every(([sql]) => sql.startsWith("SELECT"))).toBe(true);
    expect(provider.calls.every((call) => call.method === "GET")).toBe(true);
    expect(await listReceipts(store)).toEqual([]);
    expect(receipt).toMatchObject({
      source: "api_recovery",
      event_id: expect.stringMatching(/^recovery_/),
      type: "payment.snapshot",
      seller: sellerId,
      disposition: "routed",
      recovery: { endpoint: "/payments/pay_historical", reason, environment: "production" },
      payload: {
        data: {
          status: "paid",
          refunded_amount: { amount: "25.00", currency: "usd" },
          refunded_at: payment.refunded_at,
        },
      },
    });
    expect(JSON.stringify(receipt)).not.toContain("private");
    expect(transaction).toMatchObject({ id: payment.id, amountMinor: 2500, status: "paid" });
  });

  it("deduplicates repeated recovery, survives restart, and reconciles without further writes", async () => {
    const first = await prepare();
    expect((await saveReceipt(store, first.receipt)).created).toBe(true);
    const repeated = await prepare();
    expect(repeated.receipt.event_id).toBe(first.receipt.event_id);
    expect((await saveReceipt(store, repeated.receipt)).created).toBe(false);
    const restarted = new PostgresStore(database, scope);
    const receipts = await listReceipts(restarted);
    expect(receipts).toHaveLength(1);
    database.query.mockClear();
    const report = await reconcile(
      restarted,
      provider,
      sellerId,
      { from: "2026-10-05T00:00:00Z", to: "2026-10-07T00:00:00Z" },
      receipts,
    );
    expect(report).toMatchObject({ clean: true, localCount: 1, providerCount: 1, differences: [] });
    expect(database.query.mock.calls.every(([sql]) => sql.startsWith("SELECT"))).toBe(true);
    expect(await readWebhookActivity(restarted)).toEqual([]);
  });

  it("keeps later signed provider observations authoritative without deleting recovery evidence", async () => {
    const { receipt } = await prepare();
    await saveReceipt(store, receipt);
    await saveReceipt(store, {
      ...receipt,
      source: "signed_delivery",
      recovery: undefined,
      event_id: "msg_later",
      type: "payment.failed",
      payload_hash: "fixture-newer",
      payload: {
        ...receipt.payload,
        id: "msg_later",
        type: "payment.failed",
        data: {
          ...object(receipt.payload.data),
          status: "failed",
          updated_at: "2026-10-06T00:00:00Z",
        },
      },
    });
    const receipts = await listReceipts(store);
    expect(receipts).toHaveLength(2);
    const ledger = await projectLedger(store, receipts);
    expect(ledger.issues).toEqual([]);
    expect(ledger.transactions).toHaveLength(1);
    expect(ledger.transactions[0].status).toBe("failed");
    expect((await readWebhookActivity(store)).map((row) => row.event_id)).toEqual(["msg_later"]);
  });

  it.each([
    ["id", "pay_wrong", "invalid_recovery"],
    ["account_id", "biz_unrelated", "unresolved_seller"],
    ["status", null, "invalid_transaction"],
    ["currency", "eur", "unsupported_currency"],
    ["created_at", null, "invalid_timestamp"],
  ])("rejects an invalid %s without writes", async (field, value, code) => {
    payment[field] = value;
    await expect(prepare()).rejects.toMatchObject({ code });
    expect(database.query.mock.calls.every(([sql]) => sql.startsWith("SELECT"))).toBe(true);
    expect(await listReceipts(store)).toEqual([]);
  });

  it("requires the original platform and an explicit recovery reason", async () => {
    await expect(
      preparePaymentRecovery(store, provider, sellerId, "pay_historical", " "),
    ).rejects.toMatchObject({ code: "invalid_recovery" });
    provider.platformId = "biz_wrongplatform";
    await expect(prepare()).rejects.toMatchObject({ code: "wrong_platform" });
    expect(database.query.mock.calls.every(([sql]) => sql.startsWith("SELECT"))).toBe(true);
  });
});
