import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { routeSellers } from "./integration/ledger.ts";
import {
  canonical,
  IntegrationError,
  type JsonObject,
  LocalStore,
  object,
  putJsonOnce,
} from "./integration/store.ts";

export const WEBHOOK_EVENTS = [
  "payment.succeeded",
  "payment.failed",
  "refund.created",
  "dispute.created",
  "transfer.completed",
  "payout.created",
  "payout.updated",
  "account.updated",
] as const;

export type WebhookReceipt = {
  source: "local_fixture" | "signed_delivery";
  event_id: string;
  type: string;
  account_id: string;
  seller: string | null;
  disposition: "routed" | "quarantined";
  payload_hash: string;
  received_at: string;
  payload: JsonObject;
};
type WebhookOptions = {
  secret?: string;
  directory?: string;
  accounts?: Record<string, string>;
  store?: LocalStore;
  now?: number;
};

class WebhookError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function pick(value: JsonObject, fields: string[]) {
  return Object.fromEntries(
    fields.flatMap((field) => {
      const item = value[field];
      return item === null || ["string", "number", "boolean"].includes(typeof item)
        ? [[field, item]]
        : [];
    }),
  );
}

// The signed body is verified in memory. Only selected assessment fields reach disk.
export function sanitizeWebhook(event: JsonObject): JsonObject {
  const data = object(event.data);
  const selected: JsonObject = pick(data, [
    "id",
    "status",
    "amount",
    "currency",
    "fee_amount",
    "application_fee_amount",
    "net_amount",
    "created_at",
    "updated_at",
    "origin_ledger_account_id",
    "destination_ledger_account_id",
    "account_id",
    "company_id",
    "checkout_configuration_id",
    "final_amount",
  ]);
  for (const name of ["total", "amount_after_fees", "refunded_amount"]) {
    if (data[name] !== undefined) selected[name] = pick(object(data[name]), ["amount", "currency"]);
  }
  if (data.metadata !== undefined)
    selected.metadata = pick(object(data.metadata), [
      "ledgerly_order_id",
      "ledgerly_seller_external_id",
      "ledgerly_flow",
      "ledgerly_fee_minor",
    ]);
  for (const name of ["account", "company", "payment", "origin", "destination"]) {
    if (data[name] !== undefined) selected[name] = pick(object(data[name]), ["id"]);
  }
  if (data.verification !== undefined) {
    const verification = object(data.verification);
    selected.verification = Object.fromEntries(
      ["individual", "business"].flatMap((name) =>
        verification[name] === undefined
          ? []
          : [
              [
                name,
                verification[name] === null ? null : pick(object(verification[name]), ["status"]),
              ],
            ],
      ),
    );
  }
  return {
    ...pick(event, [
      "id",
      "type",
      "api_version",
      "api_version_date",
      "timestamp",
      "account_id",
      "company_id",
    ]),
    data: selected,
    ...(event.previous_attributes === undefined
      ? {}
      : { previous_attributes: pick(object(event.previous_attributes), ["status"]) }),
  };
}

export function verifyWebhook(raw: string, headers: Headers, secret: string, now = Date.now()) {
  const id = headers.get("webhook-id") || "";
  const timestamp = headers.get("webhook-timestamp") || "";
  const signatures = headers.get("webhook-signature") || "";
  if (!/^[\w.-]{1,200}$/.test(id) || !/^\d{1,12}$/.test(timestamp)) {
    throw new WebhookError("Invalid webhook authentication", 401);
  }
  if (Math.abs(now / 1000 - Number(timestamp)) > 300) {
    throw new WebhookError("Expired webhook timestamp", 401);
  }
  // Whop's ws_ secret is the raw UTF-8 HMAC key, not a base64-encoded whsec_ key.
  const expected = createHmac("sha256", secret).update(`${id}.${timestamp}.${raw}`).digest();
  const valid = signatures.split(/\s+/).some((part) => {
    if (!/^v1,[A-Za-z0-9+/]{43}=$/.test(part)) return false;
    const candidate = Buffer.from(part.slice(3), "base64");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
  if (!valid) throw new WebhookError("Invalid webhook authentication", 401);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new WebhookError("Invalid JSON", 400);
  }
  const event = object(parsed);
  if (event.id !== id) throw new WebhookError("Event and signed header IDs disagree", 400);
  if (event.api_version !== "v1") throw new WebhookError("Unsupported webhook envelope", 400);
  if (!(WEBHOOK_EVENTS as readonly unknown[]).includes(event.type)) {
    throw new WebhookError("Unsubscribed event type", 400);
  }
  if (typeof object(event.data).id !== "string") throw new WebhookError("Missing resource ID", 400);
  return event;
}

function routeAccount(event: JsonObject) {
  const version = event.api_version_date;
  if (
    version != null &&
    (typeof version !== "string" || !/^\d{4}-\d{2}-\d{2}(?:-\d+)?$/.test(version))
  ) {
    throw new WebhookError("Invalid API version", 400);
  }
  if (event.account_id && event.company_id && event.account_id !== event.company_id) {
    throw new WebhookError("Conflicting account IDs", 400);
  }
  const account =
    typeof version === "string" && version >= "2026-08-14" ? event.account_id : event.company_id;
  if (typeof account !== "string" || !/^biz_[A-Za-z0-9]+$/.test(account)) {
    throw new WebhookError("Missing version-appropriate account ID", 400);
  }
  return account;
}

export async function saveReceipt(directory: string, receipt: WebhookReceipt) {
  const result = await putJsonOnce(
    directory,
    `event-${createHash("sha256").update(receipt.event_id).digest("hex")}.json`,
    receipt,
  );
  if (
    result.record.event_id !== receipt.event_id ||
    result.record.payload_hash !== receipt.payload_hash
  ) {
    throw new WebhookError("Event ID already has different content", 409);
  }
  return !result.created;
}

export async function listReceipts(directory: string): Promise<WebhookReceipt[]> {
  const names = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const rows = await Promise.all(
    names
      .filter((name) => /^event-[a-f0-9]{64}\.json$/.test(name))
      .map(
        async (name) => JSON.parse(await readFile(join(directory, name), "utf8")) as WebhookReceipt,
      ),
  );
  return rows.sort((a, b) => a.received_at.localeCompare(b.received_at));
}

async function boundedBody(request: Request) {
  const limit = 1024 * 1024;
  if (Number(request.headers.get("content-length")) > limit)
    throw new WebhookError("Body too large", 413);
  if (!request.body) throw new WebhookError("Missing body", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.length;
    if (size > limit) {
      await reader.cancel();
      throw new WebhookError("Body too large", 413);
    }
    chunks.push(next.value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function handleWebhook(request: Request, options: WebhookOptions = {}) {
  const respond = (body: JsonObject, status = 200) =>
    Response.json(body, {
      status,
      headers: { "Cache-Control": "no-store" },
    });
  try {
    if (request.method !== "POST") return respond({ error: "Method not allowed" }, 405);
    if (process.env.VERCEL)
      return respond(
        { error: "Configure persistent webhook storage before hosting this receiver on Vercel" },
        503,
      );
    const secret = options.secret ?? process.env.WHOP_WEBHOOK_SECRET;
    if (!secret?.startsWith("ws_"))
      return respond({ error: "Webhook signing secret is not configured" }, 503);
    const now = options.now ?? Date.now();
    const event = verifyWebhook(await boundedBody(request), request.headers, secret, now);
    const accountId = routeAccount(event);
    const store = options.store ?? new LocalStore();
    let seller: string | null = null;
    if (options.accounts) seller = options.accounts[accountId] ?? null;
    else {
      const context = await store.context();
      if ((context.environment === "fixture") !== (process.env.WHOP_WEBHOOK_MODE === "local")) {
        throw new WebhookError("The registry and webhook environments do not match", 503);
      }
      try {
        seller = (await routeSellers(store, event, accountId))[0]?.externalId ?? null;
      } catch (error) {
        if (!(error instanceof IntegrationError) || error.code !== "order_conflict") throw error;
      }
    }
    const receipt: WebhookReceipt = {
      source: process.env.WHOP_WEBHOOK_MODE === "local" ? "local_fixture" : "signed_delivery",
      event_id: event.id as string,
      type: event.type as string,
      account_id: accountId,
      seller,
      disposition: seller ? "routed" : "quarantined",
      payload_hash: createHash("sha256").update(canonical(event)).digest("hex"),
      received_at: new Date(now).toISOString(),
      payload: sanitizeWebhook(event),
    };
    const directory =
      options.directory ?? process.env.WHOP_WEBHOOK_STORAGE_DIR ?? store.eventsDirectory;
    const duplicate = await saveReceipt(directory, receipt);
    return respond({
      received: true,
      duplicate,
      event_id: receipt.event_id,
      account_id: accountId,
      seller,
      disposition: receipt.disposition,
    });
  } catch (error) {
    if (error instanceof WebhookError) return respond({ error: error.message }, error.status);
    if (error instanceof IntegrationError && error.code === "setup_required")
      return respond({ error: error.message }, 503);
    // Never acknowledge a storage failure or serialize signed payloads/secrets into errors.
    return respond({ error: "Webhook persistence failed; retry the delivery" }, 500);
  }
}
