import { createHash } from "node:crypto";
import { link, mkdir, mkdtemp, open, readdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

export type JsonObject = Record<string, unknown>;
export type Environment = "fixture" | "production" | "sandbox";
export type Context = { platformAccountId: string; environment: Environment };
export type SellerInput = { externalId: string; email: string; country: string };
export type Seller = SellerInput & { accountId: string; platformAccountId: string };
export type Order = {
  orderId: string;
  sellerExternalId: string;
  sellerAccountId: string;
  chargeAccountId: string;
  flow: "direct" | "platform";
  title: string;
  amountMinor: number;
  feeMinor: number;
  sellerShareMinor: number;
  currency: "usd";
  redirectUrl: string;
};
export type Checkout = { orderId: string; id: string; planId: string; purchaseUrl: string };
export type Operation<T> = {
  input: T;
  key: string;
  startedAt: string;
  credentialId: string;
  apiVersion: string;
};
type Collection = "context" | "seller-inputs" | "sellers" | "orders" | "checkouts";

export class IntegrationError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function object(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function digest(value: unknown) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

async function syncDirectory(directory: string) {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function putJsonOnce<T>(directory: string, filename: string, record: T) {
  if (process.env.VERCEL)
    throw new IntegrationError(
      "persistent_storage_required",
      "This file store needs a persistent local filesystem.",
    );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = await mkdtemp(join(directory, ".pending-"));
  const destination = join(directory, filename);
  try {
    const path = join(temporary, "document.json");
    const handle = await open(path, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    let created = true;
    try {
      await link(path, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      created = false;
    }
    await syncDirectory(directory);
    return { created, record: JSON.parse(await readFile(destination, "utf8")) as T };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

// Documents are immutable. Atomic hard links publish fully written files once,
// without a lock that could be stranded by a crashed process.
export class LocalStore {
  readonly directory: string;
  constructor(directory = process.env.LEDGERLY_DATA_DIR || ".data/ledgerly") {
    this.directory = resolve(directory);
  }
  get eventsDirectory() {
    return join(this.directory, "events");
  }
  private file(collection: Collection, key: string) {
    return join(this.directory, collection, `${digest(key)}.json`);
  }
  async read<T>(collection: Collection, key: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(this.file(collection, key), "utf8")) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  async list<T>(collection: Collection): Promise<T[]> {
    const directory = join(this.directory, collection);
    const files = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    return Promise.all(
      files
        .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
        .map(async (name) => JSON.parse(await readFile(join(directory, name), "utf8")) as T),
    );
  }
  async put<T>(collection: Collection, key: string, record: T): Promise<T> {
    return (await putJsonOnce(join(this.directory, collection), `${digest(key)}.json`, record))
      .record;
  }
  async exact<T>(collection: Collection, key: string, record: T) {
    const saved = await this.put(collection, key, record);
    if (canonical(saved) !== canonical(record)) {
      throw new IntegrationError(
        "identity_conflict",
        "This ID already has different inputs. Use the original inputs or a new ID.",
      );
    }
    return saved;
  }
  async initialize(context: Context) {
    if (!/^biz_[A-Za-z0-9]+$/.test(context.platformAccountId)) {
      throw new IntegrationError(
        "invalid_platform",
        "Configure WHOP_PLATFORM_ACCOUNT_ID with the parent biz_ ID.",
      );
    }
    return this.exact("context", "platform", context);
  }
  async context() {
    const context = await this.read<Context>("context", "platform");
    if (!context)
      throw new IntegrationError(
        "setup_required",
        "Initialize the seller registry before receiving webhooks.",
      );
    return context;
  }
  async seller(externalId: string) {
    const seller = await this.read<Seller>("sellers", externalId);
    if (!seller) throw new IntegrationError("seller_not_found", "Onboard this seller first.");
    return seller;
  }
}
