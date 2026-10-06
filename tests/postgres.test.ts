import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PostgresStore } from "@/lib/integration/postgres";
import { createStore } from "@/lib/integration/storage";
import { LocalStore } from "@/lib/integration/store";
import { clearStorageEnvironment, configureRedis } from "./redis-fixture";

beforeEach(() => clearStorageEnvironment());
afterEach(() => vi.unstubAllEnvs());

describe("PostgreSQL configuration", () => {
  it("prefers PostgreSQL over legacy Redis without connecting during configuration", () => {
    configureRedis();
    vi.stubEnv("DATABASE_URL", "postgresql://fixture:fixture@localhost:5432/ledgerly_test");
    expect(createStore()).toBeInstanceOf(PostgresStore);
  });

  it("keeps the offline demo on files even when a database is configured", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://fixture:fixture@localhost:5432/ledgerly_test");
    vi.stubEnv("WHOP_WEBHOOK_MODE", "local");
    expect(createStore()).toBeInstanceOf(LocalStore);
  });

  it.each(["https://example.com/db", "postgresql://localhost/", "private-invalid-url"])(
    "rejects %s without falling back to Redis",
    (url) => {
      configureRedis();
      vi.stubEnv("DATABASE_URL", url);
      expect(() => createStore()).toThrow("Set DATABASE_URL");
    },
  );

  it("uses a separate statement to read a competing writer's committed record", async () => {
    const original = { platformAccountId: "biz_fixture", environment: "production" };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ record: original }] });
    const store = new PostgresStore({ query }, "fixture");
    expect(await store.putOnce("context", "platform", original)).toEqual({
      created: false,
      record: original,
    });
    expect(query.mock.calls[0][0]).toContain("DO NOTHING RETURNING");
    expect(query.mock.calls[1][0]).toMatch(/^SELECT/);
  });

  it("reports a safe failure when PostgreSQL cannot be reached", async () => {
    const query = vi.fn().mockRejectedValue(new Error("password=private database response"));
    const store = new PostgresStore({ query }, "fixture");
    await expect(store.context()).rejects.toMatchObject({ code: "storage_unavailable" });
    await expect(store.context()).rejects.not.toThrow("private");
  });

  it("passes account identifiers as query parameters", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const store = new PostgresStore({ query }, "fixture");
    const value = "biz_test'); DELETE FROM ledgerly_sellers; --";
    await store.sellersByAccount([value]);
    expect(query.mock.calls[0][0]).not.toContain(value);
    expect(query.mock.calls[0][1]).toEqual(["fixture", [value]]);
  });
});
