import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCheckout } from "@/lib/integration/checkout";
import { projectLedger } from "@/lib/integration/ledger";
import { onboardSeller } from "@/lib/integration/onboarding";
import { createStore, RedisStore, storageIssue } from "@/lib/integration/storage";
import { LocalStore } from "@/lib/integration/store";
import { handleWebhook, listReceipts } from "@/lib/whop-webhooks";
import { FixtureProvider } from "../scripts/fixtures";
import { clearStorageEnvironment, configureRedis, RedisFixture } from "./redis-fixture";

let redis: RedisFixture;
const input = { externalId: "seller-us", email: "seller@example.test", country: "US" };
const links = {
  returnUrl: "https://ledgerly.example/return",
  refreshUrl: "https://ledgerly.example/refresh",
};
const context = { platformAccountId: "biz_fixtureplatform", environment: "production" } as const;
const secret = "ws_fixture_not_a_real_webhook_secret";
const event = {
  id: "msg_shared001",
  type: "payment.succeeded",
  api_version: "v1",
  api_version_date: "2026-09-29",
  timestamp: "2026-10-06T15:00:00Z",
  account_id: "biz_unknown",
  data: { id: "pay_fixture", amount: 25, status: "paid" },
};
function signed(payload: unknown = event) {
  const raw = JSON.stringify(payload);
  const stamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret)
    .update(`${event.id}.${stamp}.${raw}`)
    .digest("base64");
  return new Request("https://ledgerly.example/api/webhooks/whop", {
    method: "POST",
    body: raw,
    headers: {
      "content-type": "application/json",
      "webhook-id": event.id,
      "webhook-timestamp": String(stamp),
      "webhook-signature": `v1,${signature}`,
    },
  });
}

beforeEach(() => {
  clearStorageEnvironment();
  configureRedis();
  vi.stubEnv("WHOP_WEBHOOK_SECRET", secret);
  redis = new RedisFixture();
  vi.stubGlobal("fetch", redis.fetch);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("persistent storage selection", () => {
  it("enables Vercel storage with either supported credential pair", () => {
    expect(storageIssue()).toBeNull();
    expect(createStore()).toBeInstanceOf(RedisStore);
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    vi.stubEnv("KV_REST_API_URL", "https://fixture.upstash.io");
    vi.stubEnv("KV_REST_API_TOKEN", "fixture-token");
    expect(createStore()).toBeInstanceOf(RedisStore);
  });
  it("keeps local demos on disk and refuses an unconfigured Vercel deployment", () => {
    clearStorageEnvironment();
    expect(createStore()).toBeInstanceOf(LocalStore);
    vi.stubEnv("VERCEL", "1");
    expect(storageIssue()).toContain("Connect Upstash Redis");
  });
  it.each([
    "",
    "http://fixture.upstash.io",
    "https://example.com",
    "https://fixture.upstash.io?token=private",
    "https://user:private@fixture.upstash.io",
    "https://fixture.upstash.io/other",
  ])("rejects an incomplete or unsafe Redis URL without falling back to disk", (url) => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", url);
    expect(() => createStore()).toThrow("Configure both Upstash");
    expect(redis.fetch).not.toHaveBeenCalled();
  });
  it("keeps offline webhook fixtures separate even when Redis credentials exist", () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("WHOP_WEBHOOK_MODE", "local");
    expect(createStore()).toBeInstanceOf(LocalStore);
    expect(redis.fetch).not.toHaveBeenCalled();
  });
  it("isolates platforms, environments, and deployment namespaces", async () => {
    await createStore().initialize(context);
    for (const [key, value] of [
      ["WHOP_PLATFORM_ACCOUNT_ID", "biz_other"],
      ["WHOP_ENVIRONMENT", "sandbox"],
      ["LEDGERLY_STORAGE_NAMESPACE", "preview"],
    ]) {
      const original = process.env[key];
      vi.stubEnv(key, value);
      expect(await createStore().read("context", "platform")).toBeNull();
      vi.stubEnv(key, original);
    }
  });
});

describe("immutable shared operations", () => {
  it("retains the same seller across concurrent requests and fresh app instances", async () => {
    const provider = new FixtureProvider();
    await createStore().initialize(context);
    const results = await Promise.all(
      Array.from({ length: 8 }, () => onboardSeller(createStore(), provider, input, links)),
    );
    expect(new Set(results.map((result) => result.seller.accountId)).size).toBe(1);
    expect(provider.accounts).toHaveLength(1);
    expect(await createStore().seller(input.externalId)).toEqual(results[0].seller);
    await expect(
      onboardSeller(createStore(), provider, { ...input, email: "changed@example.test" }, links),
    ).rejects.toMatchObject({ code: "identity_conflict" });
    expect(provider.accounts).toHaveLength(1);
  });
  it("recovers a committed operation after its HTTP response is lost", async () => {
    const store = createStore();
    const original = { key: "original-key", startedAt: "2026-10-06T15:00:00Z" };
    redis.failAfterCommit = true;
    await expect(store.put("seller-inputs", "us", original)).rejects.toMatchObject({
      code: "storage_unavailable",
    });
    expect(await createStore().put("seller-inputs", "us", { key: "replacement-key" })).toEqual(
      original,
    );
  });
  it("allows only one identity when different inputs race for the same seller", async () => {
    const provider = new FixtureProvider();
    await createStore().initialize(context);
    const results = await Promise.allSettled([
      onboardSeller(createStore(), provider, input, links),
      onboardSeller(createStore(), provider, { ...input, email: "another@example.test" }, links),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(provider.accounts).toHaveLength(1);
    expect(await createStore().list("sellers")).toHaveLength(1);
  });
  it("shares checkout recovery and ledger projection with the webhook receipt store", async () => {
    const provider = new FixtureProvider();
    await createStore().initialize(context);
    const { seller } = await onboardSeller(createStore(), provider, input, links);
    const order = {
      orderId: "order-001",
      sellerExternalId: seller.externalId,
      title: "Preset pack",
      amount: "25.00",
      currency: "usd",
      flow: "direct" as const,
      redirectUrl: "https://ledgerly.example/thanks",
    };
    const first = await createCheckout(createStore(), provider, order);
    expect((await createCheckout(createStore(), provider, order)).checkout).toEqual(first.checkout);
    expect(provider.checkouts).toHaveLength(1);
    const data = provider.payment(provider.checkouts[0], "pay_fixture", event.timestamp);
    const delivery = { ...event, account_id: seller.accountId, data };
    expect(await (await handleWebhook(signed(delivery))).json()).toMatchObject({
      duplicate: false,
      seller: input.externalId,
    });
    const restarted = createStore();
    const projected = await projectLedger(restarted, await listReceipts(restarted));
    expect(projected.transactions).toHaveLength(1);
    expect(projected.transactions[0]).toMatchObject({ id: "pay_fixture", amountMinor: 2500 });
  });
  it("passes sync tokens to subsequent reads and never exposes provider errors", async () => {
    const store = createStore();
    await store.initialize(context);
    await store.context();
    const headers = new Headers(redis.fetch.mock.calls.at(-1)?.[1]?.headers);
    expect(headers.get("upstash-sync-token")).toBe("fixture-sync");
    redis.unavailable = true;
    await expect(store.context()).rejects.toMatchObject({ code: "storage_unavailable" });
    await expect(store.context()).rejects.not.toThrow("fixture private");
  });
});

describe("Vercel webhook handling", () => {
  it("persists and deduplicates an unpinned current-format event", async () => {
    const incoming = { ...event, api_version_date: null };
    expect(await (await handleWebhook(signed(incoming))).json()).toMatchObject({
      received: true,
      duplicate: false,
      account_id: event.account_id,
      disposition: "quarantined",
    });
    expect(await (await handleWebhook(signed(incoming))).json()).toMatchObject({
      duplicate: true,
    });
    expect(await listReceipts(createStore())).toHaveLength(1);
  });

  it("deduplicates simultaneous deliveries and replays after fresh store instances", async () => {
    const replies = await Promise.all(
      Array.from({ length: 12 }, async () => (await handleWebhook(signed())).json()),
    );
    expect(replies.filter((reply) => reply.duplicate === false)).toHaveLength(1);
    expect(replies.filter((reply) => reply.duplicate === true)).toHaveLength(11);
    expect(await listReceipts(createStore())).toHaveLength(1);
    expect(await (await handleWebhook(signed())).json()).toMatchObject({ duplicate: true });
    expect(await createStore().context()).toEqual(context);
  });
  it("does not change the original receipt when an event ID is reused with different content", async () => {
    await handleWebhook(signed());
    expect(
      (await handleWebhook(signed({ ...event, data: { ...event.data, amount: 99 } }))).status,
    ).toBe(409);
    expect((await listReceipts(createStore()))[0].payload.data).toMatchObject({ amount: 25 });
  });
  it("returns a retryable failure on storage outage, then accepts the retried delivery once", async () => {
    redis.unavailable = true;
    expect((await handleWebhook(signed())).status).toBe(500);
    redis.unavailable = false;
    expect(await (await handleWebhook(signed())).json()).toMatchObject({ duplicate: false });
    expect(await (await handleWebhook(signed())).json()).toMatchObject({ duplicate: true });
    expect(await listReceipts(createStore())).toHaveLength(1);
  });
  it("does not double-post when a receipt commits but its acknowledgement is lost", async () => {
    const store = createStore();
    await store.initialize(context);
    redis.failAfterCommit = true;
    expect((await handleWebhook(signed(), { store })).status).toBe(500);
    expect(await listReceipts(createStore())).toHaveLength(1);
    expect(await (await handleWebhook(signed())).json()).toMatchObject({ duplicate: true });
    expect(await listReceipts(createStore())).toHaveLength(1);
  });
  it("rejects unsigned input before storing context or receipts", async () => {
    const request = signed();
    request.headers.delete("webhook-signature");
    expect((await handleWebhook(request)).status).toBe(401);
    expect(redis.fetch).not.toHaveBeenCalled();
  });
});
