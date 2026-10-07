import "server-only";

// No operator identity exists in this starter. Do not expose the platform inbox on a deployment.
export function isLocalOperator(headers: Headers) {
  if (process.env.NODE_ENV !== "development" || process.env.VERCEL) return false;
  const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/;
  const host = headers.get("host") || "";
  const forwarded = headers.get("x-forwarded-host") || host;
  return localHost.test(host) && localHost.test(forwarded) && !headers.has("forwarded");
}
