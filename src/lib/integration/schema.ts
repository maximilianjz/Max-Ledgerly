import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
} from "drizzle-orm/pg-core";

// Preserve the immutable operation/receipt exactly. Generated columns expose its
// identities for indexed lookups and constraints without a second mutable copy.
const columns = (keyName: string) => ({
  scope: text("scope").notNull(),
  key: text(keyName).notNull(),
  record: jsonb("record").notNull(),
});

export const contexts = pgTable("ledgerly_contexts", columns("context_id"), (t) => [
  primaryKey({ columns: [t.scope, t.key] }),
  unique().on(t.scope),
  check("context_key", sql`${t.key} = 'platform'`),
]);

export const sellerOperations = pgTable(
  "ledgerly_seller_operations",
  columns("external_id"),
  (t) => [
    primaryKey({ columns: [t.scope, t.key] }),
    foreignKey({ columns: [t.scope], foreignColumns: [contexts.scope] }),
    check(
      "seller_operation_key",
      sql`(${t.record}->'input'->>'externalId') IS NOT NULL AND ${t.record}->'input'->>'externalId' = ${t.key}`,
    ),
  ],
);

export const sellers = pgTable(
  "ledgerly_sellers",
  {
    ...columns("external_id"),
    accountId: text("account_id").generatedAlwaysAs(sql`record->>'accountId'`).notNull(),
    email: text("email").generatedAlwaysAs(sql`record->>'email'`).notNull(),
    country: text("country").generatedAlwaysAs(sql`record->>'country'`).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.scope, t.key] }),
    unique().on(t.scope, t.accountId),
    foreignKey({ columns: [t.scope], foreignColumns: [contexts.scope] }),
    check(
      "seller_key",
      sql`(${t.record}->>'externalId') IS NOT NULL AND ${t.record}->>'externalId' = ${t.key}`,
    ),
  ],
);

export const orders = pgTable(
  "ledgerly_orders",
  {
    ...columns("order_id"),
    sellerExternalId: text("seller_external_id")
      .generatedAlwaysAs(sql`record->'input'->>'sellerExternalId'`)
      .notNull(),
    chargeAccountId: text("charge_account_id")
      .generatedAlwaysAs(sql`record->'input'->>'chargeAccountId'`)
      .notNull(),
    amountMinor: integer("amount_minor")
      .generatedAlwaysAs(sql`(record->'input'->>'amountMinor')::integer`)
      .notNull(),
    feeMinor: integer("fee_minor")
      .generatedAlwaysAs(sql`(record->'input'->>'feeMinor')::integer`)
      .notNull(),
    currency: text("currency").generatedAlwaysAs(sql`record->'input'->>'currency'`).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.scope, t.key] }),
    foreignKey({
      name: "ledgerly_orders_seller_fk",
      columns: [t.scope, t.sellerExternalId],
      foreignColumns: [sellers.scope, sellers.key],
    }),
    index().on(t.scope, t.sellerExternalId),
    check(
      "order_key",
      sql`(${t.record}->'input'->>'orderId') IS NOT NULL AND ${t.record}->'input'->>'orderId' = ${t.key}`,
    ),
    check(
      "order_price",
      sql`${t.amountMinor} > 0 AND ${t.amountMinor} <= 100000000 AND ${t.currency} = 'usd'`,
    ),
    check(
      "order_fee",
      sql`${t.feeMinor} > 0 AND ${t.feeMinor} < ${t.amountMinor} AND ${t.feeMinor} = (${t.amountMinor} * 8 + 50) / 100`,
    ),
  ],
);

export const checkouts = pgTable(
  "ledgerly_checkouts",
  {
    ...columns("order_id"),
    checkoutId: text("checkout_id").generatedAlwaysAs(sql`record->>'id'`).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.scope, t.key] }),
    unique().on(t.scope, t.checkoutId),
    foreignKey({
      name: "ledgerly_checkouts_order_fk",
      columns: [t.scope, t.key],
      foreignColumns: [orders.scope, orders.key],
    }),
    check(
      "checkout_key",
      sql`(${t.record}->>'orderId') IS NOT NULL AND ${t.record}->>'orderId' = ${t.key}`,
    ),
  ],
);

export const events = pgTable(
  "ledgerly_webhook_events",
  {
    ...columns("event_id"),
    accountId: text("account_id").generatedAlwaysAs(sql`record->>'account_id'`),
    sellerExternalId: text("seller_external_id").generatedAlwaysAs(sql`record->>'seller'`),
    eventType: text("event_type").generatedAlwaysAs(sql`record->>'type'`).notNull(),
    disposition: text("disposition").generatedAlwaysAs(sql`record->>'disposition'`).notNull(),
    receivedAt: text("received_at").generatedAlwaysAs(sql`record->>'received_at'`).notNull(),
    payloadHash: text("payload_hash").generatedAlwaysAs(sql`record->>'payload_hash'`).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.scope, t.key] }),
    foreignKey({ columns: [t.scope], foreignColumns: [contexts.scope] }),
    foreignKey({
      name: "ledgerly_events_seller_fk",
      columns: [t.scope, t.sellerExternalId],
      foreignColumns: [sellers.scope, sellers.key],
    }),
    index().on(t.scope, t.accountId, t.receivedAt),
    index().on(t.scope, t.disposition, t.receivedAt),
    check(
      "event_key",
      sql`(${t.record}->>'event_id') IS NOT NULL AND ${t.record}->>'event_id' = ${t.key}`,
    ),
    check("event_disposition", sql`${t.disposition} IN ('routed', 'quarantined')`),
  ],
);

export const storageTables = {
  context: contexts,
  "seller-inputs": sellerOperations,
  sellers,
  orders,
  checkouts,
  events,
};
