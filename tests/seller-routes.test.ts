import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as portal } from "@/app/api/payout-portal/route";
import { POST as token } from "@/app/api/payout-token/route";
import { POST as onboard } from "@/app/api/sellers/[externalId]/onboarding/route";
import { GET as status } from "@/app/api/sellers/[externalId]/route";
import { POST as create } from "@/app/api/sellers/route";
import { LocalStore } from "@/lib/integration/store";
import { workspaceReturnPath } from "@/lib/seller-contracts";
import { FixtureProvider } from "../scripts/fixtures";
import { clearStorageEnvironment, configureRedis, RedisFixture } from "./redis-fixture";

let directory: string;
let provider: FixtureProvider;
let redis: RedisFixture;
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
  redis = new RedisFixture();
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
      if (url.hostname === "fixture.upstash.io") return redis.fetch(input, options);
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
  it("creates, lists, resumes onboarding, and selects the same seller on Vercel with Redis", async () => {
    configureRedis();
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
    configureRedis();
    redis.unavailable = true;
    const response = await create(request("/api/sellers", input));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("fixture private");
    expect(provider.calls).toHaveLength(0);
  });
  it("preserves legacy internal return paths and rejects external redirect targets", () => {
    expect(workspaceReturnPath("/accounts")).toBe("/accounts");
    expect(workspaceReturnPath("/sellers")).toBe("/sellers");
    expect(workspaceReturnPath("/sellers/seller-us?returned=1")).toBe(
      "/sellers/seller-us?returned=1",
    );
    for (const value of [
      "//evil.example",
      "https://evil.example",
      "javascript:alert(1)",
      "/api/payout-token",
      "/sellers/../../evil",
      "/accounts/../../evil",
    ])
      expect(workspaceReturnPath(value)).toBe("/sellers");
  });
});
