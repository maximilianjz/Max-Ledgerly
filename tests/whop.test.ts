import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOKEN_TTL_MS } from "@/lib/contracts";
import { CHECKOUT_API_VERSION, WhopProvider } from "@/lib/integration/provider";
import { createPayoutPortal, createPayoutSession } from "@/lib/whop";

const now = Date.UTC(2026, 9, 5, 12);
const accountId = "biz_testUS";
const key = "apik_test_private_credential";
const fetchMock = vi.fn<typeof fetch>();
function ok(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubEnv("WHOP_API_KEY", key);
  vi.stubEnv("WHOP_ACCOUNT_ID", accountId);
  vi.stubEnv("APP_URL", "https://ledgerly.example");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Whop server boundary", () => {
  it("keeps sandbox requests, query values, and checkout version overrides on the shared transport", async () => {
    fetchMock.mockResolvedValue(ok({ id: "ch_fixture" }));
    await new WhopProvider(key, "sandbox").request("POST", "/checkout_configurations", {
      version: CHECKOUT_API_VERSION,
      key: "order-fixture",
      query: { after: "cursor with / and &" },
      body: { plan: { company_id: accountId } },
    });
    const [url, request] = fetchMock.mock.calls[0];
    const destination = new URL(String(url));
    expect(destination.origin).toBe("https://sandbox-api.whop.com");
    expect(destination.pathname).toBe("/api/v1/checkout_configurations");
    expect(destination.searchParams.get("after")).toBe("cursor with / and &");
    expect(request).toMatchObject({
      method: "POST",
      cache: "no-store",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${key}`,
        "Api-Version-Date": CHECKOUT_API_VERSION,
        "Idempotency-Key": "order-fixture",
      },
    });
    expect(JSON.parse(String(request?.body))).toEqual({ plan: { company_id: accountId } });
  });
  it.each([
    "https://evil.example",
    "//evil.example",
    "/accounts/../payments",
    "/accounts?token=secret",
  ])("rejects an invalid request path before attaching credentials: %s", async (path) => {
    await expect(new WhopProvider(key).request("GET", path)).rejects.toMatchObject({
      code: "invalid_path",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("preserves rate-limit status and the alternate request ID header", async () => {
    fetchMock.mockResolvedValue(
      new Response("not JSON", {
        status: 429,
        headers: { "request-id": "request-limited" },
      }),
    );
    await expect(createPayoutSession(now)).rejects.toMatchObject({
      status: 429,
      requestId: "request-limited",
      code: "whop_request_failed",
    });
  });
  it("mints the required payout scopes for the configured seller with a ten-minute expiry", async () => {
    const expiresAt = new Date(now + TOKEN_TTL_MS).toISOString();
    fetchMock.mockResolvedValue(ok({ token: "scoped-token", expires_at: expiresAt }));
    const session = await createPayoutSession(now);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.whop.com/api/v1/access_tokens");
    expect(JSON.parse(request?.body as string)).toEqual({
      account_id: accountId,
      expires_at: expiresAt,
      scoped_actions: [
        "company:balance:read",
        "stats:read",
        "payout:destination:read",
        "payout:withdrawal:read",
        "payout:create_destination",
        "payout:withdraw_funds",
      ],
    });
    expect(request?.cache).toBe("no-store");
    expect(request?.redirect).toBe("error");
    expect(request?.headers).toMatchObject({
      Authorization: `Bearer ${key}`,
      "Api-Version-Date": "2026-09-29",
    });
    expect(session.scopedActions).not.toContain("company:update_child_fees");
    expect(JSON.stringify(session)).not.toContain(key);
  });
  it.each([now - 1, now + TOKEN_TTL_MS * 2])(
    "refuses expired or unexpectedly long-lived tokens",
    async (expiry) => {
      fetchMock.mockResolvedValue(
        ok({ token: "scoped-token", expires_at: new Date(expiry).toISOString() }),
      );
      await expect(createPayoutSession(now)).rejects.toMatchObject({
        code: "invalid_whop_response",
      });
    },
  );
  it("uses trusted return and refresh origins for hosted links", async () => {
    fetchMock.mockResolvedValue(
      ok({ url: "https://whop.com/payouts/session", expires_at: "2026-10-05T12:10:00Z" }),
    );
    await createPayoutPortal();
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
      account_id: accountId,
      use_case: "payouts_portal",
      return_url: "https://ledgerly.example/payouts",
      refresh_url: "https://ledgerly.example/payouts/refresh",
    });
  });
  it.each([
    "https://evil.example/session",
    "https://whop.com.evil.example/session",
    "http://whop.com/session",
    "https://user:pass@whop.com/session",
  ])("rejects untrusted portal destinations", async (url) => {
    fetchMock.mockResolvedValue(ok({ url, expires_at: "2026-10-05T12:10:00Z" }));
    await expect(createPayoutPortal()).rejects.toMatchObject({ code: "invalid_whop_response" });
  });
  it("redacts credentials from provider errors and preserves request IDs", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: `Invalid key ${key}` } }), {
        status: 403,
        headers: { "x-request-id": "request-test" },
      }),
    );
    await expect(createPayoutSession(now)).rejects.toMatchObject({
      message: "Invalid key [redacted]",
      requestId: "request-test",
    });
  });
  it("handles timeouts without exposing the upstream request", async () => {
    fetchMock.mockRejectedValue(new Error(`Fetch failed with ${key}`));
    await expect(createPayoutSession(now)).rejects.toMatchObject({
      code: "whop_unreachable",
      message: "Whop could not be reached. Try again in a moment.",
    });
  });
});
