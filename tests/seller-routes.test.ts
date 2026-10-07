import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as portal } from "@/app/api/payout-portal/route";
import { POST as token } from "@/app/api/payout-token/route";
import { POST as checkout } from "@/app/api/sellers/[externalId]/checkout/route";
import { POST as onboard } from "@/app/api/sellers/[externalId]/onboarding/route";
import { GET as status } from "@/app/api/sellers/[externalId]/route";
import { POST as create } from "@/app/api/sellers/route";
import { LocalStore, object } from "@/lib/integration/store";
import { clearStorageEnvironment, configurePostgres, StorageFixture } from "./storage-fixture";
import { FixtureProvider } from "./whop-fixture";

let directory: string;
let provider: FixtureProvider;
let database: StorageFixture;
const input = { externalId: "seller-us", email: "seller@example.test", country: "US" };
const context = { params: Promise.resolve({ externalId: input.externalId }) };
const origin = "https://ledgerly.example";
function request(path: string, body: unknown = {}, method = "POST", requestOrigin = origin) {
  return new Request(`${origin}${path}`, {
    method,
    headers: { origin: requestOrigin, "Content-Type": "application/json" },
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  });
}
const calls = () => provider.calls.filter((call) => call.method === "POST");

beforeEach(async () => {
  clearStorageEnvironment();
  database = new StorageFixture();
  directory = await mkdtemp(join(tmpdir(), "ledgerly-seller-routes-"));
  provider = new FixtureProvider();
  vi.stubEnv("LEDGERLY_DATA_DIR", directory);
  vi.stubEnv("WHOP_PLATFORM_ACCOUNT_ID", provider.platformId);
  vi.stubEnv("WHOP_ACCOUNT_ID", "biz_oldUS");
  vi.stubEnv("WHOP_ENVIRONMENT", "production");
  vi.stubEnv("WHOP_API_KEY", "apik_test_fixture");
  vi.stubEnv("APP_URL", origin);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | string, options: RequestInit) => {
      const url = new URL(String(input));
      const path = url.pathname.replace("/api/v1", "");
      const body = options.body ? JSON.parse(String(options.body)) : undefined;
      if (String(url).includes("/access_tokens"))
        return Response.json({ token: "fixture-token", expires_at: body.expires_at });
      const result = await provider.request(options.method as "GET" | "POST", path, {
        body,
        query: Object.fromEntries(url.searchParams),
        key: new Headers(options.headers).get("Idempotency-Key") || undefined,
        version: new Headers(options.headers).get("Api-Version-Date") || undefined,
      });
      return Response.json(result);
    }),
  );
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await rm(directory, { recursive: true, force: true });
});

describe("seller onboarding routes", () => {
  it("rejects cross-origin create and link requests", async () => {
    expect(
      (await create(request("/api/sellers", input, "POST", "https://evil.example"))).status,
    ).toBe(403);
    expect(
      (
        await onboard(
          request("/api/sellers/seller-us/onboarding", {}, "POST", "https://evil.example"),
          context,
        )
      ).status,
    ).toBe(403);
    expect(provider.calls).toHaveLength(0);
  });
  it("creates or finds the same seller locally without needing an HTTPS handoff", async () => {
    vi.stubEnv("APP_URL", "http://localhost:3000");
    const first = await create(request("/api/sellers", input, "POST", "http://localhost:3000"));
    expect(first.status).toBe(200);
    const repeat = await create(request("/api/sellers", input, "POST", "http://localhost:3000"));
    expect(await repeat.json()).toEqual(await first.json());
    expect(provider.accounts).toHaveLength(1);
    expect(calls().map((call) => call.path)).toEqual(["/accounts"]);
    const before = provider.calls.length;
    expect(
      (
        await onboard(
          request("/api/sellers/seller-us/onboarding", {}, "POST", "http://localhost:3000"),
          context,
        )
      ).status,
    ).toBe(503);
    expect(provider.calls).toHaveLength(before);
  });
  it("accepts and normalizes countries beyond the three assessment examples", async () => {
    const first = await create(request("/api/sellers", { ...input, country: " ca " }));
    expect(first.status).toBe(200);
    const saved = await first.json();
    expect(saved.seller.country).toBe("CA");
    const repeat = await create(request("/api/sellers", { ...input, country: "CA" }));
    expect(await repeat.json()).toEqual(saved);
    expect(provider.accounts).toHaveLength(1);
    expect(calls()[0].options.body?.country).toBe("CA");
  });
  it("rejects unknown country codes before calling Whop", async () => {
    for (const country of ["ZZ", "UK", "Canada", "", "__proto__"]) {
      expect((await create(request("/api/sellers", { ...input, country }))).status).toBe(400);
    }
    expect(provider.calls).toHaveLength(0);
  });
  it.each([
    { externalId: "../outside" },
    { externalId: "x".repeat(121) },
    { email: "missing-domain" },
    { email: `${"x".repeat(250)}@example.test` },
  ])("rejects invalid seller identity before any storage or Whop write: %j", async (invalid) => {
    configurePostgres(database);
    expect((await create(request("/api/sellers", { ...input, ...invalid }))).status).toBe(400);
    expect(database.query).not.toHaveBeenCalled();
    expect(provider.calls).toHaveLength(0);
  });
  it("uses normalized seller input for the registry and Whop", async () => {
    const response = await create(
      request("/api/sellers", {
        externalId: ` ${input.externalId} `,
        email: ` ${input.email.toUpperCase()} `,
        country: " us ",
      }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).seller).toMatchObject(input);
    expect(calls()[0].options.body).toMatchObject({
      email: input.email,
      country: input.country,
      metadata: { external_id: input.externalId },
    });
  });
  it("rejects changed identity and caller-provided Whop account IDs", async () => {
    await create(request("/api/sellers", input));
    expect(
      (await create(request("/api/sellers", { ...input, email: "another@example.test" }))).status,
    ).toBe(409);
    expect(
      (await create(request("/api/sellers", { ...input, account_id: "biz_other" }))).status,
    ).toBe(400);
    expect(provider.accounts).toHaveLength(1);
  });
  it("generates fresh links with server-controlled seller return and refresh URLs", async () => {
    await create(request("/api/sellers", input));
    const first = await (
      await onboard(request("/api/sellers/seller-us/onboarding"), context)
    ).json();
    const second = await (
      await onboard(request("/api/sellers/seller-us/onboarding"), context)
    ).json();
    expect(first.onboardingUrl).not.toBe(second.onboardingUrl);
    expect(calls().at(-1)?.options.body).toMatchObject({
      account_id: provider.accounts[0].id,
      return_url: `${origin}/sellers/seller-us?returned=1`,
      refresh_url: `${origin}/sellers/seller-us?refresh=1`,
    });
    expect(
      (
        await onboard(
          request("/api/sellers/seller-us/onboarding", { return_url: "https://evil.example" }),
          context,
        )
      ).status,
    ).toBe(400);
  });
  it("returns only selected live status fields and does not treat a return URL as approval", async () => {
    await create(request("/api/sellers", input));
    Object.assign(provider.accounts[0], {
      verification: {
        individual: { status: "pending", private_document: "private" },
        business: null,
      },
      required_actions: [
        {
          title: "Verify identity",
          status: "required",
          description: "Continue with Whop",
          cta: "private-url",
        },
      ],
      capabilities: { crypto_payout: "inactive" },
      business_address: "private-address",
    });
    const response = await status(request("/api/sellers/seller-us?returned=1", {}, "GET"), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    const data = await response.json();
    expect(data).toMatchObject({
      verification: { individual: "pending", business: null },
      capabilities: { crypto_payout: "inactive" },
    });
    expect(JSON.stringify(data)).not.toContain("private");
  });
  it("keeps missing status fields unknown instead of claiming there are no outstanding actions", async () => {
    await create(request("/api/sellers", input));
    const data = await (await status(request("/api/sellers/seller-us", {}, "GET"), context)).json();
    expect(data).toMatchObject({
      requiredActions: null,
      verification: { individual: null, business: null },
    });
  });
  it("reads a suspended account but blocks onboarding and payout access", async () => {
    await create(request("/api/sellers", input));
    provider.accounts[0].status = "suspended";
    expect((await status(request("/api/sellers/seller-us", {}, "GET"), context)).status).toBe(200);
    expect((await onboard(request("/api/sellers/seller-us/onboarding"), context)).status).toBe(409);
    expect((await token(request("/api/payout-token?seller=seller-us"))).status).toBe(403);
    expect(calls().some((call) => call.path === "/account_links")).toBe(false);
  });
  it("binds token and portal requests to the registered seller, never the old default account", async () => {
    await create(request("/api/sellers", input));
    const result = await token(request("/api/payout-token?seller=seller-us"));
    expect(await result.json()).toMatchObject({ accountId: provider.accounts[0].id });
    const tokenCall = vi
      .mocked(fetch)
      .mock.calls.find(([url]) => String(url).endsWith("/access_tokens"));
    expect(JSON.parse(String(tokenCall?.[1]?.body))).toMatchObject({
      account_id: provider.accounts[0].id,
    });
    expect((await portal(request("/api/payout-portal?seller=seller-us"))).status).toBe(200);
    expect(calls().at(-1)?.options.body).toMatchObject({
      account_id: provider.accounts[0].id,
      return_url: `${origin}/payouts?seller=seller-us`,
      refresh_url: `${origin}/payouts/refresh?seller=seller-us`,
    });
  });
  it("rejects unknown, ambiguous, foreign-parent, and fixture sellers before granting payout access", async () => {
    await create(request("/api/sellers", input));
    expect((await token(request("/api/payout-token?seller=unregistered"))).status).toBe(404);
    expect((await token(request("/api/payout-token?seller=seller-us&seller=other"))).status).toBe(
      400,
    );
    provider.accounts[0].parent_account = { id: "biz_foreign" };
    expect((await token(request("/api/payout-token?seller=seller-us"))).status).toBe(502);
    const foreignDirectory = join(directory, "fixtures");
    await new LocalStore(foreignDirectory).initialize({
      platformAccountId: provider.platformId,
      environment: "fixture",
    });
    vi.stubEnv("LEDGERLY_DATA_DIR", foreignDirectory);
    expect((await token(request("/api/payout-token?seller=seller-us"))).status).toBe(409);
  });
  it("does not run filesystem onboarding on Vercel", async () => {
    vi.stubEnv("VERCEL", "1");
    expect((await create(request("/api/sellers", input))).status).toBe(503);
    expect(provider.calls).toHaveLength(0);
  });
  it("creates, lists, resumes onboarding, and selects the same seller on Vercel with PostgreSQL", async () => {
    configurePostgres(database);
    const { listSellers, onboardingIssue } = await import("@/lib/sellers");
    expect(onboardingIssue()).toBeNull();
    expect(await listSellers()).toEqual([]);
    const created = await create(request("/api/sellers", input));
    expect(created.status).toBe(200);
    const { seller } = await created.json();
    expect(await listSellers()).toEqual([seller]);
    expect(await (await create(request("/api/sellers", input))).json()).toEqual({ seller });
    expect((await status(request("/api/sellers/seller-us", {}, "GET"), context)).status).toBe(200);
    expect((await onboard(request("/api/sellers/seller-us/onboarding"), context)).status).toBe(200);
    expect(await (await token(request("/api/payout-token?seller=seller-us"))).json()).toMatchObject(
      {
        accountId: seller.accountId,
      },
    );
    expect(provider.accounts).toHaveLength(1);
  });
  it("returns a retryable error without calling Whop when shared storage is unavailable", async () => {
    configurePostgres(database);
    database.unavailable = true;
    const response = await create(request("/api/sellers", input));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("fixture private");
    expect(provider.calls).toHaveLength(0);
  });
});

describe("seller payment links", () => {
  const order = { orderId: "order-ui-1", title: "Preset pack", amount: "25.00" };
  const path = "/api/sellers/seller-us/checkout";

  it("calculates the fee on the server, controls the destination, and recovers the same checkout", async () => {
    await create(request("/api/sellers", input));
    const first = await checkout(request(path, order), context);
    expect(first.status).toBe(200);
    expect(first.headers.get("Cache-Control")).toContain("no-store");
    const result = await first.json();
    expect(result.order).toMatchObject({
      amountMinor: 2500,
      feeMinor: 200,
      sellerShareMinor: 2300,
      sellerExternalId: input.externalId,
      flow: "direct",
      currency: "usd",
      redirectUrl: `${origin}/sellers/seller-us`,
    });
    const created = calls().filter((call) => call.path === "/checkout_configurations");
    expect(created).toHaveLength(1);
    expect(created[0].options.body).toMatchObject({
      plan: { company_id: provider.accounts[0].id, initial_price: 25, application_fee_amount: 2 },
      metadata: { ledgerly_order_id: order.orderId, ledgerly_seller_external_id: input.externalId },
    });
    expect(await (await checkout(request(path, order), context)).json()).toMatchObject({
      checkout: result.checkout,
      reused: true,
    });
    expect(provider.checkouts).toHaveLength(1);
    expect((await checkout(request(path, { ...order, amount: "50.00" }), context)).status).toBe(
      409,
    );
  });

  it.each([
    { application_fee_amount: 0 },
    { currency: "eur" },
    { flow: "platform" },
    { sellerExternalId: "someone-else" },
    { redirectUrl: "https://evil.example" },
    { account_id: "biz_other" },
    { amount: "0" },
    { amount: "25.001" },
  ])("rejects invalid prices and caller-controlled checkout fields: %j", async (invalid) => {
    configurePostgres(database);
    expect((await checkout(request(path, { ...order, ...invalid }), context)).status).toBe(400);
    expect(database.query).not.toHaveBeenCalled();
    expect(provider.calls).toHaveLength(0);
  });

  it("rejects cross-origin creation and insecure callbacks before writes", async () => {
    configurePostgres(database);
    expect(
      (await checkout(request(path, order, "POST", "https://evil.example"), context)).status,
    ).toBe(403);
    vi.stubEnv("APP_URL", "http://localhost:3000");
    expect(
      (await checkout(request(path, order, "POST", "http://localhost:3000"), context)).status,
    ).toBe(503);
    expect(database.query).not.toHaveBeenCalled();
    expect(provider.calls).toHaveLength(0);
  });

  it("does not issue checkout links for unknown or suspended sellers", async () => {
    await create(request("/api/sellers", input));
    expect(
      (await checkout(request(path, order), { params: Promise.resolve({ externalId: "unknown" }) }))
        .status,
    ).toBe(404);
    provider.accounts[0].status = "suspended";
    expect((await checkout(request(path, order), context)).status).toBe(502);
    expect(calls().filter((call) => call.path === "/checkout_configurations")).toHaveLength(0);
  });

  it("does not return a checkout whose provider fee differs from the calculated fee", async () => {
    await create(request("/api/sellers", input));
    const original = provider.request.bind(provider);
    vi.spyOn(provider, "request").mockImplementation(async (method, path, options) => {
      const result = await original(method, path, options);
      return method === "POST" && path === "/checkout_configurations"
        ? { ...result, plan: { ...object(result.plan), application_fee_amount: 1 } }
        : result;
    });
    const response = await checkout(request(path, order), context);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { code: "fee_mismatch" } });
    expect(await new LocalStore(directory).read("checkouts", order.orderId)).toBeNull();
  });
});
