import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { LocalStore } from "../src/lib/integration/store.ts";
import { listReceipts, WEBHOOK_EVENTS } from "../src/lib/whop-webhooks.ts";

const endpoint = "http://127.0.0.1:3001/api/webhooks/whop";
const evidenceDirectory = resolve("evidence/part-5/local");
const secret = process.env.WHOP_WEBHOOK_SECRET;
const directory = process.env.WHOP_WEBHOOK_STORAGE_DIR;
assert.equal(process.env.WHOP_WEBHOOK_MODE, "local", "Use local fixture mode only.");
assert.ok(secret?.startsWith("ws_"), "Run npm run webhooks:setup first.");
assert.equal(resolve(directory || ""), resolve(".data/local-webhook-fixtures"));
const registry = new LocalStore();
assert.equal((await registry.context()).environment, "fixture");

async function deliver(event) {
  const raw = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", secret)
    .update(`${event.id}.${timestamp}.${raw}`)
    .digest("base64");
  const response = await fetch(endpoint, {
    method: "POST",
    redirect: "error",
    headers: {
      "content-type": "application/json",
      "webhook-id": event.id,
      "webhook-timestamp": timestamp,
      "webhook-signature": `v1,${signature}`,
    },
    body: raw,
    signal: AbortSignal.timeout(5000),
  });
  const result = {
    http_status: response.status,
    receiver_instance: response.headers.get("x-ledgerly-receiver-instance"),
    response: await response.json(),
  };
  assert.equal(result.http_status, 200);
  assert.ok(result.receiver_instance, "The receiver must be running in local fixture mode.");
  assert.equal(result.response.event_id, event.id);
  return result;
}

const [operation, previousFile, ...extra] = process.argv.slice(2);
assert.equal(extra.length, 0);
assert.ok(!operation || (operation === "--replay" && previousFile));
const report = {
  source: "local_fixture",
  not_a_whop_delivery: true,
  observed_at: new Date().toISOString(),
  endpoint,
};
const before = await listReceipts(directory);

if (operation === "--replay") {
  const previousPath = resolve(previousFile);
  assert.ok(previousPath.startsWith(`${evidenceDirectory}${sep}`));
  const previous = JSON.parse(await readFile(previousPath, "utf8"));
  assert.equal(previous.source, "local_fixture");
  const event = previous.deliveries[0].payload;
  assert.ok(event.id.startsWith("msg_local_"));
  const result = await deliver(event);
  assert.equal(result.response.duplicate, true);
  assert.notEqual(
    result.receiver_instance,
    previous.deliveries[0].receiver_instance,
    "Restart the local receiver before running the restart/replay check.",
  );
  const after = await listReceipts(directory);
  assert.equal(after.length, before.length);
  Object.assign(report, {
    check: "replay_after_receiver_restart",
    event_id: event.id,
    original_receiver_instance: previous.deliveries[0].receiver_instance,
    ...result,
    receipt_count_before: before.length,
    receipt_count_after: after.length,
    duplicate_receipt_written: false,
  });
} else {
  const suffix = randomUUID().replaceAll("-", "");
  const deliveries = [];
  for (const [index, type] of WEBHOOK_EVENTS.entries()) {
    const name =
      type === "account.updated" ? "germany" : type === "transfer.completed" ? "brazil" : "us";
    const account = (await registry.seller(`fixture-${name}`)).accountId;
    const payload = {
      id: `msg_local_${suffix}_${index}`,
      type,
      api_version: "v1",
      api_version_date: "2026-09-29",
      timestamp: report.observed_at,
      account_id: account,
      data:
        type === "account.updated"
          ? { id: account, status: "suspended" }
          : {
              id: `${type.startsWith("payment.") ? "pay" : type.startsWith("transfer.") ? "ctt" : "fixture"}_${suffix}${index}`,
              status:
                type === "payment.succeeded"
                  ? "paid"
                  : type === "transfer.completed"
                    ? "succeeded"
                    : type.split(".")[1],
              amount: type === "transfer.completed" ? 23 : 25,
              currency: "usd",
              created_at: report.observed_at,
              updated_at: report.observed_at,
              ...(type === "transfer.completed"
                ? { origin: { id: "biz_fixtureplatform" }, destination: { id: account } }
                : {}),
            },
      ...(type === "account.updated" ? { previous_attributes: { status: "active" } } : {}),
    };
    const result = await deliver(payload);
    assert.equal(result.response.duplicate, false);
    assert.equal(result.response.disposition, "routed");
    deliveries.push({ payload, ...result });
  }
  const after = await listReceipts(directory);
  assert.equal(after.length - before.length, WEBHOOK_EVENTS.length);
  for (const { payload } of deliveries) {
    assert.equal(after.find((receipt) => receipt.event_id === payload.id)?.source, "local_fixture");
  }
  Object.assign(report, {
    check: "eight_signed_local_event_types",
    receipt_count_before: before.length,
    receipt_count_after: after.length,
    deliveries,
  });
}
await mkdir(evidenceDirectory, { recursive: true });
const filename = `${report.observed_at.replace(/[:.]/g, "-")}-${operation ? "replay" : "events"}.json`;
const destination = resolve(evidenceDirectory, filename);
await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });
console.log(`Passed ${report.check}; saved ${destination}`);
