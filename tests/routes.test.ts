import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH as feesPatch } from "@/app/api/fees/route";
import { POST as portalPost } from "@/app/api/payout-portal/route";
import { POST as tokenPost } from "@/app/api/payout-token/route";
import { TOKEN_TTL_MS } from "@/lib/contracts";

const accountId = "biz_testUS";
const origin = "https://ledgerly.example";
const fetchMock = vi.fn();
function request(
  path: string,
  body: unknown = {},
  method = "POST",
  requestOrigin: string | null = origin,
) {
  return new Request(`${origin}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(requestOrigin ? { Origin: requestOrigin } : {}),
    },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.stubEnv("WHOP_ACCOUNT_ID", accountId);
  vi.stubEnv("APP_URL", origin);
  vi.stubEnv("WHOP_API_KEY", "apik_route_test");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("API request boundaries", () => {
  it("mints a payout token without a workspace password or session cookie", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        token: "fixture-token",
        expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
      }),
    );
    const result = await tokenPost(request("/api/payout-token"));
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ accountId, token: "fixture-token" });
    expect(result.headers.get("set-cookie")).toBeNull();
    expect(result.headers.get("cache-control")).toContain("no-store");
  });
  it.each([
    [tokenPost, "/api/payout-token", "POST"],
    [portalPost, "/api/payout-portal", "POST"],
    [feesPatch, "/api/fees", "PATCH"],
  ] as const)("rejects cross-origin or missing-origin mutations", async (route, path, method) => {
    for (const requestOrigin of ["https://evil.example", null]) {
      const result = await route(request(path, {}, method, requestOrigin));
      expect(result.status).toBe(403);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });
  it("rejects a cross-site request even with the expected origin header", async () => {
    const input = request("/api/payout-token");
    input.headers.set("sec-fetch-site", "cross-site");
    expect((await tokenPost(input)).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects a caller trying to substitute another seller", async () => {
    const result = await tokenPost(request("/api/payout-token", { account_id: "biz_other" }));
    expect(result.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects fee updates with arbitrary rails or extra fields", async () => {
    const result = await feesPatch(
      request("/api/fees", { percentage: 1, rail: "bank_wire" }, "PATCH"),
    );
    expect(result.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
