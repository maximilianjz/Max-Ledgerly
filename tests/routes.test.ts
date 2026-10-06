import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSession, SESSION_COOKIE } from "@/lib/auth-core";

const cookieJar = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "ledgerly_session" && cookieJar.value ? { value: cookieJar.value } : undefined,
  }),
}));

import { POST as loginPost } from "@/app/api/auth/login/route";
import { POST as logoutPost } from "@/app/api/auth/logout/route";
import { GET as feesGet, PATCH as feesPatch } from "@/app/api/fees/route";
import { POST as portalPost } from "@/app/api/payout-portal/route";
import { POST as tokenPost } from "@/app/api/payout-token/route";

const config = {
  password: "test-long-assessment-password",
  secret: "test-secret-longer-than-thirty-two-characters",
  accountId: "biz_testUS",
};
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
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  });
}
beforeEach(() => {
  vi.stubEnv("ASSESSMENT_PASSWORD", config.password);
  vi.stubEnv("SESSION_SECRET", config.secret);
  vi.stubEnv("WHOP_ACCOUNT_ID", config.accountId);
  vi.stubEnv("APP_URL", origin);
  vi.stubEnv("WHOP_API_KEY", "apik_route_test");
  vi.stubGlobal("fetch", fetchMock);
  cookieJar.value = undefined;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("API authorization", () => {
  it.each([
    [tokenPost, "/api/payout-token", "POST"],
    [portalPost, "/api/payout-portal", "POST"],
    [feesGet, "/api/fees", "GET"],
    [feesPatch, "/api/fees", "PATCH"],
  ] as const)("requires a login before a provider call", async (route, path, method) => {
    const result = await route(request(path, {}, method));
    expect(result.status).toBe(401);
    expect(result.headers.get("cache-control")).toContain("no-store");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["https://evil.example", null])(
    "rejects cross-origin or missing-origin mutations",
    async (requestOrigin) => {
      cookieJar.value = createSession(config);
      const result = await tokenPost(request("/api/payout-token", {}, "POST", requestOrigin));
      expect(result.status).toBe(403);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it("rejects a caller trying to substitute another seller", async () => {
    cookieJar.value = createSession(config);
    const result = await tokenPost(request("/api/payout-token", { account_id: "biz_other" }));
    expect(result.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects fee updates with arbitrary rails or extra fields", async () => {
    cookieJar.value = createSession(config);
    const result = await feesPatch(
      request("/api/fees", { percentage: 1, rail: "bank_wire" }, "PATCH"),
    );
    expect(result.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("sets an HttpOnly, SameSite, Secure session only after a correct password", async () => {
    const wrong = await loginPost(request("/api/auth/login", { password: "wrong" }));
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get("set-cookie")).toBeNull();
    const right = await loginPost(request("/api/auth/login", { password: config.password }));
    const cookie = right.headers.get("set-cookie") || "";
    expect(right.status).toBe(200);
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("secure");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
    expect(cookie).not.toContain(config.password);
  });
  it("clears the cookie when signing out", async () => {
    cookieJar.value = createSession(config);
    const result = await logoutPost(request("/api/auth/logout"));
    expect(result.status).toBe(200);
    expect(result.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
