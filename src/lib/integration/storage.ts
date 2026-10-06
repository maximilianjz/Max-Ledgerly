import {
  type Collection,
  type Context,
  digest,
  IntegrationError,
  LocalStore,
  Store,
  type Stored,
} from "./store.ts";

function unavailable() {
  return new IntegrationError(
    "storage_unavailable",
    "Seller storage is unavailable. Check the connection and retry; no success was acknowledged.",
  );
}

function decode<T>(value: unknown): T {
  try {
    if (typeof value !== "string") throw unavailable();
    return JSON.parse(value) as T;
  } catch {
    throw unavailable();
  }
}

// Immutable records need no migrations, expirations, or separate deduplication index.
export class RedisStore extends Store {
  readonly shared = true;
  private readonly url: string;
  private readonly token: string;
  private readonly prefix: string;
  private syncToken?: string;

  constructor(config: { url: string; token: string; prefix: string }) {
    super();
    const url = new URL(config.url);
    if (
      url.protocol !== "https:" ||
      !url.hostname.endsWith(".upstash.io") ||
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      !config.token ||
      !config.prefix
    )
      throw new Error("Invalid Redis connection");
    this.url = url.origin;
    this.token = config.token;
    this.prefix = config.prefix;
  }

  private key(collection: Collection) {
    return `${this.prefix}:${collection}`;
  }
  private async transaction(commands: string[][]): Promise<unknown[]> {
    try {
      const response = await fetch(`${this.url}/multi-exec`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
          ...(this.syncToken ? { "upstash-sync-token": this.syncToken } : {}),
        },
        body: JSON.stringify(commands),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(4000),
      });
      const rows: unknown = await response.json();
      if (!response.ok || !Array.isArray(rows) || rows.length !== commands.length)
        throw unavailable();
      const values = rows.map((row) => {
        if (!row || typeof row !== "object" || "error" in row || !("result" in row))
          throw unavailable();
        return row.result;
      });
      this.syncToken = response.headers.get("upstash-sync-token") || this.syncToken;
      return values;
    } catch {
      // Provider errors can contain commands, values, or credentials. Never expose them.
      throw unavailable();
    }
  }
  async read<T>(collection: Collection, key: string): Promise<T | null> {
    const [value] = await this.transaction([["HGET", this.key(collection), digest(key)]]);
    return value === null ? null : decode<T>(value);
  }
  async list<T>(collection: Collection): Promise<T[]> {
    const [values] = await this.transaction([["HVALS", this.key(collection)]]);
    if (!Array.isArray(values)) throw unavailable();
    return values.map((value) => decode<T>(value));
  }
  async putOnce<T>(collection: Collection, key: string, record: T): Promise<Stored<T>> {
    const hash = this.key(collection);
    const field = digest(key);
    // HSETNX and read-back are one atomic transaction. A lost response can be retried
    // using the same key without replacing the original operation or receipt.
    const [created, saved] = await this.transaction([
      ["HSETNX", hash, field, JSON.stringify(record)],
      ["HGET", hash, field],
    ]);
    if (created !== 0 && created !== 1) throw unavailable();
    return { created: created === 1, record: decode<T>(saved) };
  }
}

export function configuredContext(): Context {
  const platformAccountId = process.env.WHOP_PLATFORM_ACCOUNT_ID || "";
  const environment = process.env.WHOP_ENVIRONMENT || "production";
  if (
    !/^biz_[A-Za-z0-9]+$/.test(platformAccountId) ||
    !["production", "sandbox"].includes(environment)
  )
    throw new IntegrationError(
      "setup_required",
      "Configure the platform account and environment first.",
    );
  return { platformAccountId, environment: environment as Context["environment"] };
}

export function createStore(): Store {
  if (process.env.WHOP_WEBHOOK_MODE !== "local") {
    const direct = process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_REST_TOKEN;
    const url = direct ? process.env.UPSTASH_REDIS_REST_URL : process.env.KV_REST_API_URL;
    const token = direct ? process.env.UPSTASH_REDIS_REST_TOKEN : process.env.KV_REST_API_TOKEN;
    if (url || token) {
      const context = configuredContext();
      const namespace = process.env.LEDGERLY_STORAGE_NAMESPACE || "ledgerly-v1";
      try {
        if (!/^[A-Za-z0-9:_-]{1,64}$/.test(namespace)) throw new Error("Invalid namespace");
        return new RedisStore({
          url: url?.trim() || "",
          token: token?.trim() || "",
          prefix: `${namespace}:${context.environment}:${context.platformAccountId}`,
        });
      } catch {
        throw new IntegrationError(
          "storage_configuration_required",
          "Configure both Upstash Redis REST credentials and a valid storage namespace.",
        );
      }
    }
  }
  if (process.env.VERCEL)
    throw new IntegrationError(
      "persistent_storage_required",
      "Connect Upstash Redis in Vercel Storage to enable seller onboarding and webhooks.",
    );
  return new LocalStore(undefined, process.env.WHOP_WEBHOOK_STORAGE_DIR);
}

export function storageIssue() {
  try {
    createStore();
    return null;
  } catch (error) {
    return error instanceof IntegrationError ? error.message : "Configure seller storage first.";
  }
}
