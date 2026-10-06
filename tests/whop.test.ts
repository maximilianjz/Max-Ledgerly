import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOKEN_TTL_MS } from "@/lib/contracts";
import {
  createPayoutPortal,
  createPayoutSession,
  getCryptoMarkup,
  updateCryptoMarkup,
} from "@/lib/whop";

const now = Date.UTC(2026, 9, 5, 12);
const accountId = "biz_testUS";
const key = "apik_test_private_credential";
const money = { amount: "0.00", currency: "usd" };
const fetchMock = vi.fn<typeof fetch>();
function fees(percentage = 0, adjustable = true, maximum: number | null = 3) {
  return {
    account_id: accountId,
    markups: {
      payouts: {
        crypto: {
          percentage,
          adjustable,
          fixed: money,
          maximum: { percentage: maximum, fixed: money },
          source: "custom",
          unadjustable_reason: adjustable ? null : "not_permitted",
        },
      },
    },
  };
}
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

describe("crypto markup changes", () => {
  it("changes only the crypto percentage and confirms it with a separate read", async () => {
    fetchMock
      .mockResolvedValueOnce(ok(fees(0)))
      .mockResolvedValueOnce(ok(fees(1)))
      .mockResolvedValueOnce(ok(fees(1)));
    const result = await updateCryptoMarkup(1);
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(["GET", "PATCH", "GET"]);
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toEqual({
      markups: { payouts: { crypto: { percentage: 1 } } },
    });
    expect(result.before.markup.percentage).toBe(0);
    expect(result.after.markup.percentage).toBe(1);
  });
  it.each([NaN, Infinity, -1, 101])(
    "rejects invalid percentages without calling Whop",
    async (percentage) => {
      await expect(updateCryptoMarkup(percentage)).rejects.toMatchObject({
        code: "invalid_percentage",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it("does not attempt a write when the key lacks fee permissions", async () => {
    fetchMock.mockResolvedValue(ok(fees(0, false)));
    await expect(updateCryptoMarkup(1)).rejects.toMatchObject({ code: "markup_not_adjustable" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([0.5, null])("does not exceed a missing or lower provider limit", async (maximum) => {
    fetchMock.mockResolvedValue(ok(fees(0, true, maximum)));
    await expect(updateCryptoMarkup(1)).rejects.toBeInstanceOf(Error);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("never treats a different account's fees as the selected seller's", async () => {
    fetchMock.mockResolvedValue(ok({ ...fees(), account_id: "biz_other" }));
    await expect(getCryptoMarkup()).rejects.toMatchObject({ code: "invalid_fee_response" });
  });
  it("reports an unconfirmed write instead of claiming success", async () => {
    fetchMock.mockImplementation(async () => ok(fees(0)));
    await expect(updateCryptoMarkup(1)).rejects.toMatchObject({ code: "markup_unconfirmed" });
  });
});
