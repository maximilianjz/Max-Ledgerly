import { vi } from "vitest";

// Independent in-memory service shared by fresh app/store instances. No network.
export class RedisFixture {
  readonly hashes = new Map<string, Map<string, string>>();
  failAfterCommit = false;
  unavailable = false;

  fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input) !== "https://fixture.upstash.io/multi-exec")
      throw new Error("Unexpected fixture destination");
    if (this.unavailable) return Response.json({ error: "fixture private error" }, { status: 503 });
    const commands: string[][] = JSON.parse(String(init?.body));
    // Run the entire transaction synchronously, so other requests cannot interleave.
    const results = commands.map(([command, key, field, value]) => {
      const hash = this.hashes.get(key) ?? new Map<string, string>();
      if (command === "HGET") return { result: hash.get(field) ?? null };
      if (command === "HVALS") return { result: [...hash.values()] };
      if (command !== "HSETNX") throw new Error("Unexpected fixture command");
      if (hash.has(field)) return { result: 0 };
      hash.set(field, value);
      this.hashes.set(key, hash);
      return { result: 1 };
    });
    if (this.failAfterCommit && commands.some(([command]) => command === "HSETNX")) {
      this.failAfterCommit = false;
      throw new Error("Connection lost after transaction committed");
    }
    return Response.json(results, { headers: { "upstash-sync-token": "fixture-sync" } });
  });
}

export function clearStorageEnvironment() {
  for (const key of [
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "KV_REST_API_URL",
    "KV_REST_API_TOKEN",
    "LEDGERLY_STORAGE_NAMESPACE",
    "WHOP_WEBHOOK_MODE",
    "VERCEL",
  ])
    vi.stubEnv(key, "");
}

export function configureRedis() {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://fixture.upstash.io");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "fixture-token-not-a-credential");
  vi.stubEnv("WHOP_PLATFORM_ACCOUNT_ID", "biz_fixtureplatform");
  vi.stubEnv("WHOP_ENVIRONMENT", "production");
}
