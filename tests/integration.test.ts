import { createHmac } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CheckoutInput, createCheckout } from "@/lib/integration/checkout";
import { projectLedger, routeSellers } from "@/lib/integration/ledger";
import { priceWithFee } from "@/lib/integration/money";
import { onboardSeller } from "@/lib/integration/onboarding";
import {
  API_VERSION,
  CHECKOUT_API_VERSION,
  listAll,
  WhopProvider,
} from "@/lib/integration/provider";
import { diffTransactions, reconcile } from "@/lib/integration/reconciliation";
import { type JsonObject, LocalStore, object, type SellerInput } from "@/lib/integration/store";
import { handleWebhook, listReceipts, type WebhookReceipt } from "@/lib/whop-webhooks";
import { FixtureProvider } from "../scripts/fixtures";

let store: LocalStore;
let provider: FixtureProvider;
const now = Date.now();
const date = new Date(now).toISOString();
const links = {
  returnUrl: "https://ledgerly.example/return",
  refreshUrl: "https://ledgerly.example/refresh",
};
const us = { externalId: "seller-us", email: "us@example.test", country: "US" };
const br = { externalId: "seller-br", email: "br@example.test", country: "BR" };
const input: CheckoutInput = {
  orderId: "order-1",
  sellerExternalId: us.externalId,
  title: "Acme Preset Pack",
  amount: "25.00",
  currency: "usd",
  flow: "direct",
  redirectUrl: "https://ledgerly.example/thanks",
};
const window = {
  from: new Date(now - 60_000).toISOString(),
  to: new Date(now + 60_000).toISOString(),
};

beforeEach(async () => {
  store = new LocalStore(await mkdtemp(join(tmpdir(), "ledgerly-integration-")));
  provider = new FixtureProvider();
  await store.initialize({ environment: "fixture", platformAccountId: provider.platformId });
  vi.stubEnv("WHOP_WEBHOOK_MODE", "local");
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await rm(store.directory, { recursive: true, force: true });
});

async function deliver(data: JsonObject, account: string, id: string, type = "payment.succeeded") {
  const secret = "ws_integration_fixture";
  const event = {
    id,
    type,
    api_version: "v1",
    api_version_date: API_VERSION,
    timestamp: date,
    account_id: account,
    data,
  };
  const body = JSON.stringify(event);
  const stamp = String(Math.floor(now / 1000));
  const signature = createHmac("sha256", secret).update(`${id}.${stamp}.${body}`).digest("base64");
  const response = await handleWebhook(
    new Request("http://localhost/api/webhooks/whop", {
      method: "POST",
      body,
      headers: {
        "webhook-id": id,
        "webhook-timestamp": stamp,
        "webhook-signature": `v1,${signature}`,
      },
    }),
    { secret, now, store, directory: store.eventsDirectory },
  );
  expect(response.status).toBe(200);
  return response.json();
}

describe("seller and checkout identity", () => {
  it("creates one seller under concurrent requests, keeps its binding on restart, and refreshes links", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => onboardSeller(store, provider, us, links)),
    );
    expect(provider.accounts).toHaveLength(1);
    expect(new Set(results.map((row) => row.onboardingUrl)).size).toBe(5);
    const restarted = await onboardSeller(new LocalStore(store.directory), provider, us, links);
    expect(restarted.seller).toEqual(results[0].seller);
    expect(provider.accounts).toHaveLength(1);
    await expect(
      onboardSeller(store, provider, { ...us, country: "BR" }, links),
    ).rejects.toMatchObject({ code: "identity_conflict" });
  });

  it("recovers a create whose response was lost, even after the provider retry window expires", async () => {
    const request = provider.request.bind(provider);
    let fail = true;
    vi.spyOn(provider, "request").mockImplementation(async (method, path, options) => {
      const result = await request(method, path, options);
      if (fail && method === "POST" && path === "/accounts") {
        fail = false;
        throw new Error("connection lost after create");
      }
      return result;
    });
    await expect(onboardSeller(store, provider, us, links)).rejects.toThrow("connection lost");
    expect(await store.read("sellers", us.externalId)).toBeNull();
    const later = now + 25 * 60 * 60_000;
    vi.useFakeTimers();
    vi.setSystemTime(later);
    try {
      await onboardSeller(new LocalStore(store.directory), provider, us, links, later);
      expect(provider.accounts).toHaveLength(1);
      expect(
        provider.calls.filter((call) => call.method === "POST" && call.path === "/accounts"),
      ).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["expired", "credential changed"])(
    "does not recreate an unresolved seller when %s",
    async (reason) => {
      const request = provider.request.bind(provider);
      const spy = vi.spyOn(provider, "request").mockImplementation((method, path, options) => {
        if (method === "POST" && path === "/accounts") throw new Error("timeout");
        return request(method, path, options);
      });
      await expect(onboardSeller(store, provider, us, links, now)).rejects.toThrow("timeout");
      spy.mockRestore();
      if (reason === "credential changed") provider.credentialId = "rotated";
      await expect(
        onboardSeller(
          store,
          provider,
          us,
          links,
          reason === "expired" ? now + 24 * 60 * 60_000 : now,
        ),
      ).rejects.toMatchObject({
        code: reason === "expired" ? "outcome_unknown" : "credential_changed",
      });
      expect(provider.accounts).toHaveLength(0);
    },
  );

  it("rejects the wrong parent key and conflicting remote seller identity", async () => {
    provider.platformId = "biz_wrong";
    await expect(onboardSeller(store, provider, us, links)).rejects.toMatchObject({
      code: "wrong_platform",
    });
    provider.platformId = "biz_fixtureplatform";
    provider.accounts.push({
      id: "biz_existing",
      metadata: { external_id: us.externalId },
      parent_account: { id: provider.platformId },
      email: "other@example.test",
      country: "US",
    });
    await expect(onboardSeller(store, provider, us, links)).rejects.toMatchObject({
      code: "seller_identity_mismatch",
    });
    expect(await store.read("sellers", us.externalId)).toBeNull();
  });

  it("rejects malformed seller inputs before any provider call", async () => {
    await expect(
      onboardSeller(store, provider, { ...us, email: 5 } as unknown as SellerInput, links),
    ).rejects.toMatchObject({ code: "invalid_email" });
    expect(provider.calls).toHaveLength(0);
  });

  it("keeps a seller binding when link creation fails", async () => {
    const request = provider.request.bind(provider);
    const spy = vi.spyOn(provider, "request").mockImplementation((method, path, options) => {
      if (path === "/account_links") throw new Error("link unavailable");
      return request(method, path, options);
    });
    await expect(onboardSeller(store, provider, us, links)).rejects.toThrow("link unavailable");
    expect((await store.seller(us.externalId)).accountId).toBe(provider.accounts[0].id);
    spy.mockRestore();
    await onboardSeller(store, provider, us, links);
    expect(provider.accounts).toHaveLength(1);
  });

  it("creates the 8% direct fee once and keeps platform checkout and seller allocation separate", async () => {
    await onboardSeller(store, provider, us, links);
    const first = await createCheckout(store, provider, input);
    expect(first.order).toMatchObject({ amountMinor: 2500, feeMinor: 200, sellerShareMinor: 2300 });
    expect(first.checkout.purchaseUrl).toMatch(/^https:\/\/whop.com\/checkout\//);
    expect(await createCheckout(new LocalStore(store.directory), provider, input)).toMatchObject({
      checkout: first.checkout,
      reused: true,
    });
    expect(provider.checkouts).toHaveLength(1);
    await expect(
      createCheckout(store, provider, { ...input, amount: "30.00" }),
    ).rejects.toMatchObject({ code: "identity_conflict" });
    await createCheckout(store, provider, {
      ...input,
      orderId: "platform-order",
      flow: "platform",
    });
    const posts = provider.calls.filter(
      (call) => call.method === "POST" && call.path === "/checkout_configurations",
    );
    expect(posts[0].options.version).toBe(CHECKOUT_API_VERSION);
    expect(posts[0].options.body).toMatchObject({
      plan: {
        company_id: first.order.sellerAccountId,
        initial_price: 25,
        application_fee_amount: 2,
      },
    });
    expect(posts[1].options.body).toMatchObject({
      plan: { company_id: provider.platformId, initial_price: 25 },
    });
    expect(object(posts[1].options.body?.plan)).not.toHaveProperty("application_fee_amount");
  });

  it("recovers a checkout after a lost response without creating a second configuration", async () => {
    await onboardSeller(store, provider, us, links);
    const request = provider.request.bind(provider);
    const spy = vi.spyOn(provider, "request").mockImplementation(async (method, path, options) => {
      const result = await request(method, path, options);
      if (method === "POST" && path === "/checkout_configurations")
        throw new Error("lost response");
      return result;
    });
    await expect(createCheckout(store, provider, input)).rejects.toThrow("lost response");
    spy.mockRestore();
    expect(await createCheckout(new LocalStore(store.directory), provider, input)).toMatchObject({
      reused: true,
    });
    expect(provider.checkouts).toHaveLength(1);
  });
});

describe("money and provider boundaries", () => {
  it("rounds 8% in cents and rejects unsupported amounts and currencies", () => {
    expect(priceWithFee("25.00", "usd").feeMinor).toBe(200);
    expect(priceWithFee("0.07", "usd").feeMinor).toBe(1);
    expect(priceWithFee("10.19", "usd").feeMinor).toBe(82);
    for (const amount of ["0", "0.06", "-1", "0.001", "NaN", "1e2", "1000000.01"])
      expect(() => priceWithFee(amount, "usd")).toThrow();
    expect(() => priceWithFee("25.00", "eur")).toThrow();
  });

  it("never treats an incomplete or repeated cursor as a complete reconciliation", async () => {
    vi.spyOn(provider, "request").mockResolvedValue({
      data: [],
      page_info: { has_next_page: true, end_cursor: "same" },
    });
    await expect(listAll(provider, "/payments", {})).rejects.toMatchObject({
      code: "invalid_pagination",
    });
  });

  it("pins requests and suppresses provider errors containing secrets or customer data", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "forbidden", message: "private@example.test secret-key" },
        }),
        { status: 403 },
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const client = new WhopProvider("secret-key");
    await expect(
      client.request("POST", "/accounts", { key: "stable-key", body: { country: "US" } }),
    ).rejects.toThrow("Whop returned HTTP 403");
    expect(fetch.mock.calls[0][1]).toMatchObject({
      redirect: "error",
      headers: { "Api-Version-Date": API_VERSION, "Idempotency-Key": "stable-key" },
    });
  });
});

describe("durable ledger projection and reconciliation", () => {
  async function sale(flow: "direct" | "platform" = "direct") {
    const { seller } = await onboardSeller(store, provider, us, links);
    await createCheckout(store, provider, { ...input, flow });
    const payment = provider.payment(provider.checkouts[0], "pay_fixture", date);
    return { seller, payment };
  }

  it("routes platform payments through saved orders and quarantines conflicting transfer owners", async () => {
    const { seller, payment } = await sale("platform");
    const { seller: brazil } = await onboardSeller(store, provider, br, links);
    expect(await deliver(payment, provider.platformId, "msg_platform")).toMatchObject({
      seller: us.externalId,
    });
    expect(
      await deliver(
        {
          ...payment,
          metadata: { ...object(payment.metadata), ledgerly_seller_external_id: br.externalId },
        },
        provider.platformId,
        "msg_wrong_seller",
      ),
    ).toMatchObject({ disposition: "quarantined", seller: null });
    expect(
      await deliver(
        { ...payment, checkout_configuration_id: "ch_wrong" },
        provider.platformId,
        "msg_wrong_checkout",
      ),
    ).toMatchObject({ disposition: "quarantined", seller: null });
    const transfer = {
      id: "ctt_fixture",
      amount: 23,
      currency: "usd",
      status: "succeeded",
      created_at: date,
      origin: { id: provider.platformId },
      destination: { id: brazil.accountId },
    };
    expect(
      await deliver(transfer, provider.platformId, "msg_transfer", "transfer.completed"),
    ).toMatchObject({ seller: br.externalId });
    expect(
      await routeSellers(store, { type: "transfer.completed", data: transfer }, seller.accountId),
    ).toEqual([]);
    expect(
      await deliver(
        { ...payment, metadata: {}, checkout_configuration_id: "ch_unknown" },
        provider.platformId,
        "msg_unknown",
      ),
    ).toMatchObject({ disposition: "quarantined" });
  });

  it("survives replay and orders resource updates by provider time, not delivery time", async () => {
    const { seller, payment } = await sale();
    await deliver(payment, seller.accountId, "msg_new");
    await deliver(
      { ...payment, status: "failed", updated_at: new Date(now - 1000).toISOString() },
      seller.accountId,
      "msg_old",
      "payment.failed",
    );
    expect(await deliver(payment, seller.accountId, "msg_new")).toMatchObject({ duplicate: true });
    await deliver(payment, seller.accountId, "msg_same_resource");
    const restarted = new LocalStore(store.directory);
    const ledger = await projectLedger(restarted, await listReceipts(restarted.eventsDirectory));
    expect(ledger.issues).toEqual([]);
    expect(ledger.transactions).toHaveLength(1);
    expect(ledger.transactions[0]).toMatchObject({ status: "paid", amountMinor: 2500 });
    await deliver(
      { ...payment, total: { amount: "99.00", currency: "usd" } },
      seller.accountId,
      "msg_conflict",
    );
    expect(
      (await projectLedger(store, await listReceipts(store.eventsDirectory))).issues,
    ).toContainEqual({ resourceId: payment.id, reason: "conflicting_observations" });
  });

  it("paginates both money flows, detects missing and changed transactions, and does not alter local files", async () => {
    const { seller, payment } = await sale("platform");
    const transfer = {
      id: "ctt_fixture",
      amount: 23,
      currency: "usd",
      status: "succeeded",
      created_at: date,
      origin: { id: provider.platformId },
      destination: { id: seller.accountId },
      origin_ledger_account_id: "ldgr_parent",
      destination_ledger_account_id: "ldgr_seller",
    };
    provider.transfers.push(transfer);
    await deliver(payment, provider.platformId, "msg_payment");
    await deliver(transfer, provider.platformId, "msg_transfer", "transfer.completed");
    const second = provider.payment(provider.checkouts[0], "pay_second", date);
    await deliver(second, provider.platformId, "msg_second");
    const receipts = await listReceipts(store.eventsDirectory);
    const snapshot = async () => {
      const paths = (await readdir(store.directory, { recursive: true }))
        .filter((path) => path.endsWith(".json"))
        .sort();
      return Promise.all(
        paths.map(async (path) => [path, await readFile(join(store.directory, path), "utf8")]),
      );
    };
    const before = await snapshot();
    provider.calls = [];
    const result = await reconcile(store, provider, us.externalId, window, receipts);
    expect(result).toMatchObject({
      clean: true,
      localCount: 3,
      providerCount: 3,
      coverage: { pages: { platformPayments: 2 } },
    });
    expect(provider.calls.every((call) => call.method === "GET")).toBe(true);
    transfer.amount = 22;
    const differences = (await reconcile(store, provider, us.externalId, window, receipts.slice(1)))
      .differences;
    expect(differences.some((difference) => difference.kind === "missing_local")).toBe(true);
    expect(await snapshot()).toEqual(before);
    const all = (await reconcile(store, provider, us.externalId, window, receipts)).differences;
    expect(all).toContainEqual({
      kind: "mismatch",
      resourceId: "ctt_fixture",
      fields: ["amountMinor"],
    });
    provider.transfers = [];
    expect(
      (await reconcile(store, provider, us.externalId, window, receipts)).differences,
    ).toContainEqual({ kind: "missing_provider", resourceId: "ctt_fixture" });
  });

  it("reports duplicate provider IDs and excludes another seller's valid ledger records", async () => {
    const { seller, payment } = await sale();
    await deliver(payment, seller.accountId, "msg_payment");
    const records = (await projectLedger(store, await listReceipts(store.eventsDirectory)))
      .transactions;
    expect(diffTransactions(records, [...records, ...records])).toContainEqual({
      kind: "duplicate_provider",
      resourceId: "pay_fixture",
    });
    await onboardSeller(store, provider, br, links);
    expect(
      await reconcile(
        store,
        provider,
        br.externalId,
        window,
        await listReceipts(store.eventsDirectory),
      ),
    ).toMatchObject({ clean: true, localCount: 0, providerCount: 0 });
  });

  it("keeps fixture receipts out of a production ledger", async () => {
    const { seller, payment } = await sale();
    await deliver(payment, seller.accountId, "msg_payment");
    const receipts = await listReceipts(store.eventsDirectory);
    receipts[0].source = "signed_delivery";
    expect((await projectLedger(store, receipts as WebhookReceipt[])).issues[0].reason).toBe(
      "environment_mismatch",
    );
  });
});
