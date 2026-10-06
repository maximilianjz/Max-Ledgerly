import { describe, expect, it } from "vitest";
import {
  createSession,
  passwordMatches,
  SESSION_TTL_SECONDS,
  verifySession,
} from "@/lib/auth-core";

const config = {
  password: "a-random-assessment-password",
  secret: "unit-test-secret-at-least-thirty-two-characters",
  accountId: "biz_us",
};
const now = Date.UTC(2026, 9, 5, 12);

describe("operator sessions", () => {
  it("accepts a signed session only within its eight-hour lifetime", () => {
    const session = createSession(config, now);
    expect(verifySession(session, config, now)).toBe(true);
    expect(verifySession(session, config, now + SESSION_TTL_SECONDS * 1000 - 1)).toBe(true);
    expect(verifySession(session, config, now + SESSION_TTL_SECONDS * 1000)).toBe(false);
    expect(verifySession(session, config, now - 1000)).toBe(false);
  });
  it("rejects tampering with the authorized seller", () => {
    const [payload, signature] = createSession(config, now).split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    claims.accountId = "biz_another_seller";
    const tampered = `${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${signature}`;
    expect(verifySession(tampered, config, now)).toBe(false);
    expect(
      verifySession(createSession(config, now), { ...config, accountId: "biz_other" }, now),
    ).toBe(false);
  });
  it("revokes sessions when either credential rotates", () => {
    const session = createSession(config, now);
    expect(verifySession(session, { ...config, password: "a-different-long-password" }, now)).toBe(
      false,
    );
    expect(verifySession(session, { ...config, secret: "a-different-signing-secret" }, now)).toBe(
      false,
    );
  });
  it.each([undefined, "", "garbage", "a.b.c", "a.b", "a".repeat(2000)])(
    "rejects malformed credentials",
    (value) => {
      expect(verifySession(value, config, now)).toBe(false);
    },
  );
  it("compares complete passwords without accepting prefixes", () => {
    expect(passwordMatches(config.password, config.password)).toBe(true);
    expect(passwordMatches(config.password.slice(0, -1), config.password)).toBe(false);
    expect(passwordMatches("", config.password)).toBe(false);
  });
});
