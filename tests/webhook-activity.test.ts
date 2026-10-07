import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCheckout } from "@/lib/integration/checkout";
import { onboardSeller } from "@/lib/integration/onboarding";
import { createStore } from "@/lib/integration/storage";
import { isLocalOperator } from "@/lib/local-operator";
import { readWebhookActivity } from "@/lib/webhook-activity";
import type { WebhookReceipt } from "@/lib/whop-webhooks";
import { clearStorageEnvironment, configurePostgres, StorageFixture } from "./storage-fixture";
import { FixtureProvider } from "./whop-fixture";

beforeEach(() => clearStorageEnvironment());
afterEach(() => vi.unstubAllEnvs());

describe("private webhook activity", () => {
  it("is available only in local development, never on Vercel or through a public hostname", () => {
    vi.stubEnv("NODE_ENV", "development");
    for (const host of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000"])
      expect(isLocalOperator(new Headers({ host }))).toBe(true);
    const rejectedHeaders: HeadersInit[] = [
      {},
      { host: "max-ledgerly.vercel.app" },
      { host: "localhost.evil.example" },
      { host: "localhost:3000", "x-forwarded-host": "public.example" },
      { host: "localhost:3000", forwarded: "host=public.example" },
    ];
    for (const headers of rejectedHeaders)
      expect(isLocalOperator(new Headers(headers))).toBe(false);
    vi.stubEnv("VERCEL", "1");
    expect(isLocalOperator(new Headers({ host: "localhost:3000" }))).toBe(false);
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(isLocalOperator(new Headers({ host: "localhost:3000" }))).toBe(false);
  });

  it("reads payment-to-order matches without writes and preserves a quarantined receipt's original disposition", async () => {
    const database = new StorageFixture();
    configurePostgres(database);
    const store = createStore();
    const provider = new FixtureProvider();
    await store.initialize({ platformAccountId: provider.platformId, environment: "production" });
    await onboardSeller(
      store,
      provider,
      { externalId: "seller-us", email: "seller@example.test", country: "US" },
      {
        returnUrl: "https://ledgerly.example/return",
        refreshUrl: "https://ledgerly.example/refresh",
      },
    );
    const { checkout } = await createCheckout(store, provider, {
      orderId: "order-1",
      sellerExternalId: "seller-us",
      title: "Preset pack",
      amount: "25.00",
      currency: "usd",
      flow: "direct",
      redirectUrl: "https://ledgerly.example/thanks",
    });
    const receipt: WebhookReceipt = {
      source: "signed_delivery",
      event_id: "msg_1",
      type: "payment.succeeded",
      account_id: String(provider.accounts[0].id),
      seller: null,
      disposition: "quarantined",
      payload_hash: "fixture",
      received_at: "2026-10-06T12:00:00Z",
      payload: {
        type: "payment.succeeded",
        data: { id: "pay_1", checkout_configuration_id: checkout.id },
      },
    };
    await store.putOnce("events", receipt.event_id, receipt);
    await store.putOnce("events", "msg_2", {
      ...receipt,
      event_id: "msg_2",
      seller: "seller-us",
      disposition: "routed",
      received_at: "2026-10-06T13:00:00Z",
    });
    database.query.mockClear();
    provider.calls = [];
    const rows = await readWebhookActivity(store);
    expect(rows.map((row) => row.event_id)).toEqual(["msg_2", "msg_1"]);
    expect(rows[1]).toMatchObject({
      orderId: "order-1",
      receiptCount: 1,
      disposition: "quarantined",
      seller: null,
    });
    expect(rows[0]).toMatchObject({ seller: "seller-us", disposition: "routed" });
    expect(database.query.mock.calls.every(([sql]) => sql.startsWith("SELECT"))).toBe(true);
    expect(provider.calls).toHaveLength(0);
  });

  it("refuses to inspect a registry belonging to another platform", async () => {
    const database = new StorageFixture();
    configurePostgres(database);
    const store = createStore();
    await store.initialize({ platformAccountId: "biz_anotherplatform", environment: "production" });
    database.query.mockClear();
    await expect(readWebhookActivity(store)).rejects.toMatchObject({
      code: "environment_mismatch",
    });
    expect(database.query.mock.calls).toHaveLength(1);
    expect(database.query.mock.calls[0][0]).not.toContain("webhook_events");
  });
});
