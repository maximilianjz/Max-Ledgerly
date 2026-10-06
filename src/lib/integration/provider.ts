import { digest, IntegrationError, type JsonObject, object } from "./store.ts";

export const API_VERSION = "2026-09-29";
// The assessment's inline product/application_fee_amount belongs to this legacy contract.
export const CHECKOUT_API_VERSION = "2025-01-01";
export type RequestOptions = {
  body?: JsonObject;
  query?: Record<string, string>;
  key?: string;
  version?: string;
};
export interface Provider {
  credentialId: string;
  request(method: "GET" | "POST", path: string, options?: RequestOptions): Promise<JsonObject>;
}

export class WhopProvider implements Provider {
  readonly credentialId: string;
  private key: string;
  private base: string;
  constructor(key: string, environment: "production" | "sandbox" = "production") {
    if (!key)
      throw new IntegrationError("missing_key", "Set WHOP_API_KEY in a private environment file.");
    this.key = key;
    this.credentialId = digest(key);
    this.base =
      environment === "sandbox"
        ? "https://sandbox-api.whop.com/api/v1"
        : "https://api.whop.com/api/v1";
  }
  async request(method: "GET" | "POST", path: string, options: RequestOptions = {}) {
    if (!/^\/[a-z_]+(?:\/[A-Za-z0-9_]+)*$/.test(path))
      throw new IntegrationError("invalid_path", "Invalid API path.");
    const url = new URL(`${this.base}${path}`);
    for (const [key, value] of Object.entries(options.query || {}))
      url.searchParams.set(key, value);
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
        headers: {
          Authorization: `Bearer ${this.key}`,
          "Api-Version-Date": options.version || API_VERSION,
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(options.key ? { "Idempotency-Key": options.key } : {}),
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      });
    } catch {
      throw new IntegrationError(
        "whop_unreachable",
        "Whop could not be reached. Preserve the same operation ID when retrying.",
      );
    }
    const data = object(await response.json().catch(() => null));
    if (!response.ok) {
      const code = object(data.error).code;
      const safeCode =
        typeof code === "string" && /^[a-z_]{1,90}$/.test(code) ? code : "whop_request_failed";
      throw new IntegrationError(
        safeCode,
        `Whop returned HTTP ${response.status}. No raw response or credential was logged.`,
      );
    }
    return data;
  }
}

export async function listAll(
  provider: Provider,
  path: string,
  query: Record<string, string>,
  version = API_VERSION,
) {
  const records: JsonObject[] = [];
  const cursors = new Set<string>();
  let after: string | undefined;
  for (let pages = 1; pages <= 1000; pages++) {
    const page = await provider.request("GET", path, {
      version,
      query: { ...query, first: "50", ...(after ? { after } : {}) },
    });
    const info = object(page.page_info);
    if (!Array.isArray(page.data) || typeof info.has_next_page !== "boolean") {
      throw new IntegrationError(
        "invalid_pagination",
        "Whop returned an incomplete list response.",
      );
    }
    records.push(...page.data.map(object));
    if (!info.has_next_page) return { records, pages };
    const cursor = info.end_cursor;
    if (typeof cursor !== "string" || !cursor || cursors.has(cursor)) {
      throw new IntegrationError(
        "invalid_pagination",
        "Whop repeated or omitted a pagination cursor.",
      );
    }
    cursors.add(cursor);
    after = cursor;
  }
  throw new IntegrationError(
    "pagination_limit",
    "The result exceeded 1,000 pages; no complete report can be produced.",
  );
}

export function trustedWhopUrl(value: unknown, base = "https://whop.com") {
  if (typeof value !== "string")
    throw new IntegrationError("invalid_url", "Whop omitted the result URL.");
  const url = new URL(value, base);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !(url.hostname === "whop.com" || url.hostname.endsWith(".whop.com"))
  ) {
    throw new IntegrationError("invalid_url", "Whop returned an unexpected URL host.");
  }
  return url.toString();
}
