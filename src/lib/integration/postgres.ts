import { getTableName } from "drizzle-orm";
import { Pool } from "pg";
import { storageTables } from "./schema.ts";
import {
  type Checkout,
  type Collection,
  IntegrationError,
  type Seller,
  Store,
  type Stored,
} from "./store.ts";

export interface SqlClient {
  query(sql: string, values: unknown[]): Promise<{ rows: { record: unknown }[] }>;
}

const connections = globalThis as typeof globalThis & { ledgerlyPools?: Map<string, Pool> };

export function postgresClient(connectionString: string): Pool {
  try {
    const url = new URL(connectionString);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !url.hostname ||
      url.pathname.length < 2 ||
      url.hash
    )
      throw new Error();
  } catch {
    throw new IntegrationError(
      "storage_configuration_required",
      "Set DATABASE_URL to a PostgreSQL connection URL.",
    );
  }
  connections.ledgerlyPools ??= new Map();
  const pools = connections.ledgerlyPools;
  let pool = pools.get(connectionString);
  if (!pool) {
    pool = new Pool({
      connectionString,
      max: 3,
      connectionTimeoutMillis: 4000,
      idleTimeoutMillis: 10000,
      statement_timeout: 4000,
      allowExitOnIdle: true,
    });
    // Connection errors can contain credentials; expose only our safe storage error.
    pool.on("error", () => {});
    pools.set(connectionString, pool);
  }
  return pool;
}

export class PostgresStore extends Store {
  readonly shared = true;
  private readonly client: SqlClient;
  private readonly scope: string;

  constructor(client: SqlClient, scope: string) {
    super();
    this.client = client;
    this.scope = scope;
  }

  private async query<T>(sql: string, values: unknown[]): Promise<T[]> {
    try {
      const result = await this.client.query(sql, values);
      return result.rows.map((row) => row.record as T);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : null;
      if (code === "23505" || code === "23503")
        throw new IntegrationError(
          "identity_conflict",
          "The database rejected a conflicting seller, order, or checkout identity.",
        );
      if (["23502", "23514", "22P02"].includes(String(code)))
        throw new IntegrationError(
          "invalid_record",
          "The record does not satisfy the database's identity or amount constraints.",
        );
      throw new IntegrationError(
        "storage_unavailable",
        "PostgreSQL storage is unavailable. Check the connection and schema; no success was acknowledged.",
      );
    }
  }

  async read<T>(collection: Collection, key: string): Promise<T | null> {
    const table = storageTables[collection];
    const rows = await this.query<T>(
      `SELECT record FROM "${getTableName(table)}" WHERE scope = $1 AND "${table.key.name}" = $2`,
      [this.scope, key],
    );
    return rows[0] ?? null;
  }

  async list<T>(collection: Collection): Promise<T[]> {
    const table = storageTables[collection];
    return this.query<T>(
      `SELECT record FROM "${getTableName(table)}" WHERE scope = $1 ORDER BY "${table.key.name}"`,
      [this.scope],
    );
  }

  async putOnce<T>(collection: Collection, key: string, record: T): Promise<Stored<T>> {
    const table = storageTables[collection];
    const rows = await this.query<T>(
      `INSERT INTO "${getTableName(table)}" (scope, "${table.key.name}", record) VALUES ($1, $2, $3::jsonb) ON CONFLICT (scope, "${table.key.name}") DO NOTHING RETURNING record`,
      [this.scope, key, JSON.stringify(record)],
    );
    if (rows.length) return { created: true, record: rows[0] };
    // A separate statement gets a new READ COMMITTED snapshot after a competing
    // insert commits. A single INSERT/SELECT CTE can miss that winning row.
    const saved = await this.read<T>(collection, key);
    if (saved === null)
      throw new IntegrationError(
        "storage_unavailable",
        "The existing record could not be read; retry the same operation.",
      );
    return { created: false, record: saved };
  }

  async sellersByAccount(accountIds: string[]): Promise<Seller[]> {
    if (!accountIds.length) return [];
    return this.query<Seller>(
      "SELECT record FROM ledgerly_sellers WHERE scope = $1 AND account_id = ANY($2::text[]) ORDER BY external_id",
      [this.scope, accountIds],
    );
  }

  async checkoutById(checkoutId: string): Promise<Checkout | null> {
    const rows = await this.query<Checkout>(
      "SELECT record FROM ledgerly_checkouts WHERE scope = $1 AND checkout_id = $2",
      [this.scope, checkoutId],
    );
    return rows[0] ?? null;
  }
}
