import { IntegrationError, type JsonObject, object } from "./integration/store.ts";

export const API_VERSION = "2026-09-29";
export type RequestOptions = {
  body?: JsonObject;
  query?: Record<string, string>;
  key?: string;
  version?: string;
};

// Shared transport for the app and jobs. Callers decide how to expose HTTP errors.
export async function requestWhop(
  apiKey: string,
  method: "GET" | "POST",
  path: string,
  options: RequestOptions = {},
  environment: "production" | "sandbox" = "production",
) {
  if (!/^\/[a-z_]+(?:\/[A-Za-z0-9_]+)*$/.test(path))
    throw new IntegrationError("invalid_path", "Invalid API path.");
  const origin =
    environment === "sandbox" ? "https://sandbox-api.whop.com" : "https://api.whop.com";
  const url = new URL(`/api/v1${path}`, origin);
  for (const [key, value] of Object.entries(options.query || {})) url.searchParams.set(key, value);
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Api-Version-Date": options.version || API_VERSION,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(options.key ? { "Idempotency-Key": options.key } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  } catch {
    throw new IntegrationError(
      "whop_unreachable",
      "Whop could not be reached. Preserve the same operation ID when retrying.",
    );
  }
  return {
    data: object(await response.json().catch(() => null)),
    ok: response.ok,
    status: response.status,
    requestId:
      response.headers.get("x-request-id") || response.headers.get("request-id") || undefined,
  };
}
