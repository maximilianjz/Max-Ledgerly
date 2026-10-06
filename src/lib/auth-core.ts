import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "ledgerly_session";
export const SESSION_TTL_SECONDS = 8 * 60 * 60;
export type AuthConfig = { password: string; secret: string; accountId: string };

export function passwordMatches(supplied: string, expected: string) {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(supplied), digest(expected));
}

function sign(payload: string, config: AuthConfig) {
  // Rotating either the password or the signing secret revokes existing sessions.
  return createHmac("sha256", config.secret)
    .update(config.password)
    .update("\0")
    .update(payload)
    .digest("base64url");
}

export function createSession(config: AuthConfig, now = Date.now()) {
  const payload = Buffer.from(
    JSON.stringify({
      v: 1,
      sub: "assessment-operator",
      accountId: config.accountId,
      iat: Math.floor(now / 1000),
      exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS,
    }),
  ).toString("base64url");
  return `${payload}.${sign(payload, config)}`;
}

export function verifySession(value: string | undefined, config: AuthConfig, now = Date.now()) {
  if (!value || value.length > 1024) return false;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra || !/^[A-Za-z0-9_-]+$/.test(signature)) return false;
  const expected = Buffer.from(sign(payload, config));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const seconds = Math.floor(now / 1000);
    return (
      claims.v === 1 &&
      claims.sub === "assessment-operator" &&
      claims.accountId === config.accountId &&
      Number.isInteger(claims.iat) &&
      Number.isInteger(claims.exp) &&
      claims.iat <= seconds &&
      claims.exp > seconds &&
      claims.exp - claims.iat === SESSION_TTL_SECONDS
    );
  } catch {
    return false;
  }
}
