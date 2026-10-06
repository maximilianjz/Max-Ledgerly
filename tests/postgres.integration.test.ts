import { createHmac, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createCheckout } from "@/lib/integration/checkout";
import { projectLedger } from "@/lib/integration/ledger";
import { onboardSeller } from "@/lib/integration/onboarding";
import { PostgresStore, type SqlClient } from "@/lib/integration/postgres";
import { reconcile } from "@/lib/integration/reconciliation";
import * as schema from "@/lib/integration/schema";
import type { Operation, Order } from "@/lib/integration/store";
import { handleWebhook, listReceipts } from "@/lib/whop-webhooks";
import { FixtureProvider } from "../scripts/fixtures";

// No .env loading or access to DATABASE_URL. CI may opt into a disposable local
// PostgreSQL service; the default is an embedded PostgreSQL in a temporary folder.
const url = process.env.TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
    target.pathname !== "/ledgerly_test"
  ) {
    throw new Error("Database tests accept only a local ledgerly_test database.");
  }
}
let directory: string;
let embedded: PGlite | undefined;
let pool: Pool | undefined;
const client: SqlClient = {
  query: (text, values) => {
    if (pool) return pool.query(text, values);
    if (embedded) return embedded.query<{ record: unknown }>(text, values);
    throw new Error("The disposable database has not been started.");
  },
};
let store: PostgresStore;
let provider: FixtureProvider;
let scope: string;
const seller = { externalId: "seller-br", email: "seller@example.test", country: "BR" };
const links = {
  returnUrl: "https://ledgerly.example/return",
  refreshUrl: "https://ledgerly.example/refresh",
};
const secret = "ws_postgres_fixture_not_a_credential";

beforeAll(async () => {
  if (url) pool = new Pool({ connectionString: url, max: 8 });
  else {
    directory = await mkdtemp(join(tmpdir(), "ledgerly-postgres-test-"));
    embedded = new PGlite(join(directory, "postgres"));
  }
  // Generate DDL in memory from the same declarative schema used by db:push.
  // No SQL migration files are created or read.
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema));
  for (const statement of statements) await client.query(statement, []);
});

beforeEach(async () => {
  vi.stubEnv("WHOP_WEBHOOK_MODE", "local");
  vi.stubEnv("VERCEL", "");
  scope = `test-${randomUUID()}`;
  store = new PostgresStore(client, scope);
  provider = new FixtureProvider();
  await store.initialize({ platformAccountId: provider.platformId, environment: "fixture" });
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  await pool?.end();
  await embedded?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function sale() {
  const onboarded = await onboardSeller(store, provider, seller, links);
  const checkout = await createCheckout(store, provider, {
    orderId: "order-001",
    sellerExternalId: seller.externalId,
    title: "Preset pack",
    amount: "25.00",
    currency: "usd",
    flow: "platform",
    redirectUrl: "https://ledgerly.example/thanks",
  });
  return { onboarded, checkout };
}

function signedRequest(
  type: string,
  data: unknown,
  id = "msg_postgres",
  accountId: string | null = provider.platformId,
) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const event = {
    id,
    type,
    api_version: "v1",
    api_version_date: "2026-09-29",
    account_id: accountId,
    timestamp: new Date().toISOString(),
    data,
  };
  const body = JSON.stringify(event);
  const signature = createHmac("sha256", secret)
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  return new Request("http://localhost/api/webhooks/whop", {
    method: "POST",
    body,
    headers: {
      "webhook-id": id,
      "webhook-timestamp": timestamp,
      "webhook-signature": `v1,${signature}`,
    },
  });
}

function deliver(type: string, data: unknown, id = "msg_postgres") {
  return handleWebhook(signedRequest(type, data, id), { secret, store });
}

describe("PostgreSQL persistence and constraints", () => {
  it("keeps one seller across concurrent onboarding calls and indexes the account binding", async () => {
    const replies = await Promise.all(
      Array.from({ length: 8 }, () =>
        onboardSeller(new PostgresStore(client, scope), provider, seller, links),
      ),
    );
    expect(new Set(replies.map((r) => r.seller.accountId)).size).toBe(1);
    expect(provider.accounts).toHaveLength(1);
    expect(await store.sellersByAccount([replies[0].seller.accountId])).toEqual([
      replies[0].seller,
    ]);
    await expect(
      store.exact("sellers", "another-seller", {
        ...replies[0].seller,
        externalId: "another-seller",
      }),
    ).rejects.toMatchObject({ code: "identity_conflict" });
  });

  it("enforces seller and order relationships, unique checkout IDs, and the 8% fee", async () => {
    const { checkout } = await sale();
    const operation = await store.read<Operation<Order>>("orders", "order-001");
    if (!operation) throw new Error("The checkout did not persist its order.");
    await expect(
      store.put("orders", "bad-fee", {
        ...operation,
        input: { ...operation.input, orderId: "bad-fee", feeMinor: 100 },
      }),
    ).rejects.toMatchObject({ code: "invalid_record" });
    await expect(
      store.put("orders", "unknown-seller", {
        ...operation,
        input: { ...operation.input, orderId: "unknown-seller", sellerExternalId: "unknown" },
      }),
    ).rejects.toMatchObject({ code: "identity_conflict" });
    await store.put("orders", "order-002", {
      ...operation,
      input: { ...operation.input, orderId: "order-002" },
    });
    await expect(
      store.put("checkouts", "order-002", { ...checkout.checkout, orderId: "order-002" }),
    ).rejects.toMatchObject({ code: "identity_conflict" });
    expect(await store.checkoutById(checkout.checkout.id)).toEqual(checkout.checkout);
  });

  it("preserves the first record after an acknowledgement is lost", async () => {
    let loseResponse = true;
    const flaky: SqlClient = {
      query: async (text, values) => {
        const result = await client.query(text, values);
        if (loseResponse && text.startsWith("INSERT")) {
          loseResponse = false;
          throw new Error("private driver response");
        }
        return result;
      },
    };
    const operation = {
      input: seller,
      key: "original-operation",
      startedAt: new Date().toISOString(),
      credentialId: "fixture",
      apiVersion: "2026-09-29",
    };
    await expect(
      new PostgresStore(flaky, scope).putOnce("seller-inputs", seller.externalId, operation),
    ).rejects.toMatchObject({ code: "storage_unavailable" });
    expect(
      await store.putOnce("seller-inputs", seller.externalId, {
        ...operation,
        key: "different-operation",
      }),
    ).toEqual({ created: false, record: operation });
  });

  it("isolates deployment scopes and retains records after closing and reopening connections", async () => {
    const { onboarded } = await sale();
    const payment = provider.payment(
      provider.checkouts[0],
      "pay_restart",
      new Date().toISOString(),
    );
    const request = signedRequest("payment.succeeded", payment);
    expect(await (await handleWebhook(request.clone(), { secret, store })).json()).toMatchObject({
      duplicate: false,
      seller: seller.externalId,
    });
    expect(
      await new PostgresStore(client, `${scope}-other`).read("sellers", seller.externalId),
    ).toBeNull();
    if (pool) {
      await pool.end();
      pool = new Pool({ connectionString: url });
    } else {
      await embedded?.close();
      embedded = new PGlite(join(directory, "postgres"));
    }
    const restarted = new PostgresStore(client, scope);
    expect(await restarted.seller(seller.externalId)).toEqual(onboarded.seller);
    expect(await (await handleWebhook(request, { secret, store: restarted })).json()).toMatchObject(
      {
        duplicate: true,
        seller: seller.externalId,
      },
    );
    expect(await listReceipts(restarted)).toHaveLength(1);
  });

  it("retains an unresolved signed payout without creating a seller or ledger transaction", async () => {
    const request = signedRequest(
      "payout.updated",
      {
        id: "payout_unassigned",
        status: "pending",
        amount: 1240,
        currency: "eur",
      },
      "msg_unassigned",
      null,
    );
    const response = await handleWebhook(request, { secret, store });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      account_id: null,
      seller: null,
      disposition: "quarantined",
    });
    const receipts = await listReceipts(store);
    expect(receipts).toHaveLength(1);
    expect(await store.list("sellers")).toHaveLength(0);
    expect((await projectLedger(store, receipts)).transactions).toHaveLength(0);
  });

  it("routes a signed parent payment and reconciles its payment and transfer", async () => {
    const { onboarded } = await sale();
    const date = new Date().toISOString();
    const payment = provider.payment(provider.checkouts[0], "pay_postgres", date);
    const transfer = {
      id: "ctt_postgres",
      amount: 23,
      currency: "usd",
      status: "succeeded",
      created_at: date,
      origin: { id: provider.platformId },
      destination: { id: onboarded.seller.accountId },
    };
    provider.transfers.push(transfer);
    expect(await (await deliver("payment.succeeded", payment)).json()).toMatchObject({
      seller: seller.externalId,
      disposition: "routed",
    });
    expect(
      await (await deliver("transfer.completed", transfer, "msg_transfer")).json(),
    ).toMatchObject({ seller: seller.externalId });
    const receipts = await listReceipts(store);
    const { saveReceipt } = await import("@/lib/whop-webhooks");
    const duplicates = await Promise.all(
      Array.from({ length: 8 }, () => saveReceipt(new PostgresStore(client, scope), receipts[0])),
    );
    expect(duplicates.every(Boolean)).toBe(true);
    expect(await listReceipts(store)).toHaveLength(2);
    expect((await projectLedger(store, receipts)).transactions).toHaveLength(2);
    const window = {
      from: new Date(Date.parse(date) - 1000).toISOString(),
      to: new Date(Date.parse(date) + 1000).toISOString(),
    };
    expect(await reconcile(store, provider, seller.externalId, window, receipts)).toMatchObject({
      clean: true,
      localCount: 2,
      providerCount: 2,
    });
    transfer.amount = 22;
    expect(
      (await reconcile(store, provider, seller.externalId, window, receipts)).differences,
    ).toContainEqual({ kind: "mismatch", resourceId: transfer.id, fields: ["amountMinor"] });
    await expect(saveReceipt(store, { ...receipts[0], payload_hash: "changed" })).rejects.toThrow(
      "different content",
    );
  });
});
