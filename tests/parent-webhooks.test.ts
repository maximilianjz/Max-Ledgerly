import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as receiveParent } from "@/app/api/webhooks/whop/parent/route";
import { POST as receiveChild } from "@/app/api/webhooks/whop/route";
import { createCheckout } from "@/lib/integration/checkout";
import { projectLedger } from "@/lib/integration/ledger";
import { onboardSeller } from "@/lib/integration/onboarding";
import { createStore } from "@/lib/integration/storage";
import { listReceipts } from "@/lib/whop-webhooks";
import { FixtureProvider } from "../scripts/fixtures";
import { clearStorageEnvironment, configureRedis, RedisFixture } from "./redis-fixture";

const parentSecret = "ws_parent_fixture_not_a_credential";
const childSecret = "ws_child_fixture_not_a_credential";
const platformId = "biz_fixtureplatform";
const externalId = "seller-br";
const event = {
  id: "msg_parent001",
  type: "payment.succeeded",
  api_version: "v1",
  api_version_date: "2026-09-29",
  account_id: platformId,
  timestamp: "2026-10-06T15:00:00Z",
  data: {
    id: "pay_parent",
    account_id: platformId,
    status: "paid",
    total: { amount: "25.00", currency: "usd" },
    created_at: "2026-10-06T15:00:00Z",
  },
};
let redis: RedisFixture;

function signed(payload: unknown = event, secret = parentSecret) {
  const raw = JSON.stringify(payload);
  const stamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", secret)
    .update(`${event.id}.${stamp}.${raw}`)
    .digest("base64");
  return new Request("https://ledgerly.example/api/webhooks/whop/parent", {
    method: "POST",
    body: raw,
    headers: {
      "content-type": "application/json",
      "webhook-id": event.id,
      "webhook-timestamp": stamp,
      "webhook-signature": `v1,${signature}`,
    },
  });
}

beforeEach(() => {
  clearStorageEnvironment();
  configureRedis();
  vi.stubEnv("WHOP_WEBHOOK_SECRET", childSecret);
  vi.stubEnv("WHOP_PARENT_WEBHOOK_SECRET", parentSecret);
  redis = new RedisFixture();
  vi.stubGlobal("fetch", redis.fetch);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("parent-account webhook endpoint", () => {
  it("routes a platform payment through its saved order and projects it once after replay", async () => {
    const provider = new FixtureProvider();
    const store = createStore();
    await store.initialize({ platformAccountId: platformId, environment: "production" });
    await onboardSeller(
      store,
      provider,
      { externalId, email: "seller@example.test", country: "BR" },
      {
        returnUrl: "https://ledgerly.example/return",
        refreshUrl: "https://ledgerly.example/refresh",
      },
    );
    await createCheckout(store, provider, {
      orderId: "order-parent",
      sellerExternalId: externalId,
      title: "Preset pack",
      amount: "25.00",
      currency: "usd",
      flow: "platform",
      redirectUrl: "https://ledgerly.example/thanks",
    });
    const data = provider.payment(provider.checkouts[0], event.data.id, event.timestamp);
    const payment = { ...event, data };
    expect(await (await receiveParent(signed(payment))).json()).toMatchObject({
      received: true,
      duplicate: false,
      account_id: platformId,
      seller: externalId,
      disposition: "routed",
    });
    expect(await (await receiveParent(signed(payment))).json()).toMatchObject({ duplicate: true });
    const restarted = createStore();
    const receipts = await listReceipts(restarted);
    expect(receipts).toHaveLength(1);
    const ledger = await projectLedger(restarted, receipts);
    expect(ledger.issues).toEqual([]);
    expect(ledger.transactions).toHaveLength(1);
    expect(ledger.transactions[0]).toMatchObject({
      id: event.data.id,
      accountId: platformId,
      sellerExternalId: externalId,
      amountMinor: 2500,
    });
  });

  it("shares event deduplication between both endpoints", async () => {
    expect(await (await receiveParent(signed())).json()).toMatchObject({ duplicate: false });
    expect(await (await receiveChild(signed(event, childSecret))).json()).toMatchObject({
      duplicate: true,
    });
    expect(await listReceipts(createStore())).toHaveLength(1);
    const changed = { ...event, data: { ...event.data, status: "failed" } };
    expect((await receiveChild(signed(changed, childSecret))).status).toBe(409);
  });

  it("quarantines a platform payment without a saved order", async () => {
    expect(await (await receiveParent(signed())).json()).toMatchObject({
      received: true,
      account_id: platformId,
      seller: null,
      disposition: "quarantined",
    });
    const store = createStore();
    expect((await projectLedger(store, await listReceipts(store))).transactions).toEqual([]);
  });

  it.each([
    ["parent", receiveParent, childSecret],
    ["child", receiveChild, parentSecret],
  ] as const)("rejects the other hook's secret on the %s endpoint", async (_, receive, secret) => {
    expect((await receive(signed(event, secret))).status).toBe(401);
    expect(redis.fetch).not.toHaveBeenCalled();
  });

  it("fails closed when the parent secret is missing", async () => {
    vi.stubEnv("WHOP_PARENT_WEBHOOK_SECRET", undefined);
    expect((await receiveParent(signed(event, childSecret))).status).toBe(503);
    expect(redis.fetch).not.toHaveBeenCalled();
  });
});
