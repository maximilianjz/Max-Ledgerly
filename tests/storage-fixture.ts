import { vi } from "vitest";
import * as postgres from "@/lib/integration/postgres";
import type { JsonObject } from "@/lib/integration/store";

// Unit-test substitute for the SQL client; never opens a database or network connection.
// Real constraints and concurrency are covered by postgres.integration.test.ts.
export class StorageFixture implements postgres.SqlClient {
  private readonly tables = new Map<string, Map<string, JsonObject>>();
  failAfterCommit = false;
  unavailable = false;

  query = vi.fn(async (sql: string, values: unknown[]) => {
    if (this.unavailable) throw new Error("fixture private database error");
    const table = sql.match(/(?:FROM|INTO) "?(ledgerly_\w+)"?/)?.[1];
    if (!table) throw new Error("Unexpected fixture query");
    const [scope, key, serialized] = values;
    const tableKey = JSON.stringify([scope, table]);
    const records = this.tables.get(tableKey) ?? new Map<string, JsonObject>();
    this.tables.set(tableKey, records);
    let rows: JsonObject[];
    if (sql.startsWith("INSERT")) {
      const created = !records.has(String(key));
      if (created) records.set(String(key), JSON.parse(String(serialized)));
      if (this.failAfterCommit) {
        this.failAfterCommit = false;
        throw new Error("Connection lost after commit");
      }
      rows = created ? [records.get(String(key)) as JsonObject] : [];
    } else if (sql.includes("account_id = ANY")) {
      rows = [...records.values()].filter((row) =>
        (key as string[]).includes(String(row.accountId)),
      );
    } else if (sql.includes("checkout_id = $2")) {
      rows = [...records.values()].filter((row) => row.id === key);
    } else if (values.length === 1) {
      rows = [...records.values()];
    } else {
      const record = records.get(String(key));
      rows = record ? [record] : [];
    }
    return { rows: rows.map((record) => ({ record: structuredClone(record) })) };
  });
}

export function clearStorageEnvironment() {
  for (const key of [
    "DATABASE_URL",
    "LEDGERLY_STORAGE_NAMESPACE",
    "WHOP_WEBHOOK_MODE",
    "WHOP_WEBHOOK_STORAGE_DIR",
    "VERCEL",
  ])
    vi.stubEnv(key, "");
}

export function configurePostgres(fixture?: StorageFixture) {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("DATABASE_URL", "postgresql://fixture:fixture@localhost:5432/ledgerly_test");
  vi.stubEnv("WHOP_PLATFORM_ACCOUNT_ID", "biz_fixtureplatform");
  vi.stubEnv("WHOP_ENVIRONMENT", "production");
  if (fixture) vi.spyOn(postgres, "postgresClient").mockReturnValue(fixture);
}
