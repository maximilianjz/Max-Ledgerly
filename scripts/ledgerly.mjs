import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createCheckout } from "../src/lib/integration/checkout.ts";
import { projectLedger } from "../src/lib/integration/ledger.ts";
import { onboardSeller } from "../src/lib/integration/onboarding.ts";
import { WhopProvider } from "../src/lib/integration/provider.ts";
import { reconcile } from "../src/lib/integration/reconciliation.ts";
import { createStore } from "../src/lib/integration/storage.ts";
import { IntegrationError, LocalStore } from "../src/lib/integration/store.ts";
import { handleWebhook, listReceipts } from "../src/lib/whop-webhooks.ts";
import { FixtureProvider } from "./fixtures.ts";

const usage = `Commands:
  npm run ledgerly -- demo
  npm run ledgerly -- ledger
  npm run ledgerly -- onboard --input seller.json --return-url https://your-app.example/onboarding/return --refresh-url https://your-app.example/onboarding/refresh --live
  npm run ledgerly -- checkout --input order.json --live
  npm run ledgerly -- reconcile --seller seller-123 --from 2026-10-01T00:00:00Z --to 2026-10-06T00:00:00Z --live

demo is offline. --live enables Whop requests in WHOP_ENVIRONMENT (production by default).
Onboarding links are refreshed by calling onboard again with the same seller input.
Checkout creates a purchase URL; it does not pay it or submit transfers.`;

async function demo() {
  process.env.WHOP_WEBHOOK_MODE = "local";
  const provider = new FixtureProvider();
  const directory = `.data/demo-${randomUUID()}`;
  const store = new LocalStore(directory);
  await store.initialize({ platformAccountId: provider.platformId, environment: "fixture" });
  const links = {
    returnUrl: "https://ledgerly.example/onboarding/return",
    refreshUrl: "https://ledgerly.example/onboarding/refresh",
  };
  const us = { externalId: "demo-us", email: "us@example.test", country: "US" };
  const first = await onboardSeller(store, provider, us, links);
  const repeat = await onboardSeller(new LocalStore(directory), provider, us, links);
  assert.equal(first.seller.accountId, repeat.seller.accountId);
  const brazil = await onboardSeller(
    store,
    provider,
    { externalId: "demo-br", email: "br@example.test", country: "BR" },
    links,
  );
  const order = {
    title: "Acme Preset Pack",
    amount: "25.00",
    currency: "usd",
    redirectUrl: "https://ledgerly.example/orders/thanks",
  };
  const direct = await createCheckout(store, provider, {
    ...order,
    orderId: "demo-direct",
    sellerExternalId: us.externalId,
    flow: "direct",
  });
  const platform = await createCheckout(store, provider, {
    ...order,
    orderId: "demo-platform",
    sellerExternalId: "demo-br",
    flow: "platform",
  });
  const date = new Date().toISOString();
  const directPayment = provider.payment(provider.checkouts[0], "pay_fixturedirect", date);
  const platformPayment = provider.payment(provider.checkouts[1], "pay_fixtureplatform", date);
  const transfer = {
    id: "ctt_fixturebrazil",
    amount: 23,
    currency: "usd",
    status: "succeeded",
    created_at: date,
    origin: { id: provider.platformId },
    destination: { id: brazil.seller.accountId },
    origin_ledger_account_id: "ldgr_fixtureplatform",
    destination_ledger_account_id: "ldgr_fixturebrazil",
  };
  provider.transfers.push(transfer);
  const secret = "ws_local_demo_fixture_not_a_credential";
  const events = [
    { type: "payment.succeeded", account: first.seller.accountId, data: directPayment },
    { type: "payment.succeeded", account: provider.platformId, data: platformPayment },
    { type: "transfer.completed", account: provider.platformId, data: transfer },
  ].map((event, index) => ({
    id: `msg_fixture${index}`,
    type: event.type,
    api_version: "v1",
    api_version_date: "2026-09-29",
    account_id: event.account,
    timestamp: date,
    data: event.data,
  }));
  async function receive(event) {
    const body = JSON.stringify(event);
    const stamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", secret)
      .update(`${event.id}.${stamp}.${body}`)
      .digest("base64");
    const response = await handleWebhook(
      new Request("http://localhost/api/webhooks/whop", {
        method: "POST",
        body,
        headers: {
          "webhook-id": event.id,
          "webhook-timestamp": stamp,
          "webhook-signature": `v1,${signature}`,
        },
      }),
      { secret, store: new LocalStore(directory), directory: store.eventsDirectory },
    );
    assert.equal(response.status, 200);
    return response.json();
  }
  for (const event of events) assert.equal((await receive(event)).duplicate, false);
  assert.equal((await receive(events[0])).duplicate, true);
  const receipts = await listReceipts(store.eventsDirectory);
  assert.equal(receipts.length, 3);
  const window = {
    from: new Date(Date.parse(date) - 60_000).toISOString(),
    to: new Date(Date.parse(date) + 60_000).toISOString(),
  };
  const clean = await reconcile(store, provider, "demo-br", window, receipts);
  assert.equal(clean.clean, true);
  transfer.amount = 22;
  const mismatch = await reconcile(store, provider, "demo-br", window, receipts);
  assert.equal(mismatch.clean, false);
  assert.ok(mismatch.differences.some((difference) => difference.fields?.includes("amountMinor")));
  const report = {
    source: "local_fixture",
    not_a_whop_delivery: true,
    observedAt: date,
    sameSellerOnRepeat: true,
    directFeeMinor: direct.order.feeMinor,
    platformSellerShareMinor: platform.order.sellerShareMinor,
    duplicateEventIgnored: true,
    ledger: await projectLedger(store, receipts),
    clean,
    intentionalMismatch: mismatch,
  };
  await mkdir("evidence/integration", { recursive: true });
  const file = `evidence/integration/${date.replace(/[:.]/g, "-")}-demo.json`;
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  console.log(
    JSON.stringify(
      {
        result: "passed",
        source: "offline_fixtures",
        evidence: file,
        dataDirectory: directory,
        fee: "$2.00 on $25.00",
        reconciliation: "clean comparison and intentional mismatch both verified",
      },
      null,
      2,
    ),
  );
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      input: { type: "string" },
      seller: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      "return-url": { type: "string" },
      "refresh-url": { type: "string" },
      live: { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  const command = positionals[0];
  if (values.help || !command) {
    console.log(usage);
    return;
  }
  if (positionals.length !== 1) throw new IntegrationError("usage", usage);
  if (command === "demo") return demo();
  const store = createStore();
  const receipts = () => listReceipts(store);
  if (command === "ledger") {
    console.log(JSON.stringify(await projectLedger(store, await receipts()), null, 2));
    return;
  }
  if (!["onboard", "checkout", "reconcile"].includes(command) || !values.live)
    throw new IntegrationError("usage", usage);
  const environment = process.env.WHOP_ENVIRONMENT || "production";
  if (!["production", "sandbox"].includes(environment))
    throw new IntegrationError("invalid_environment", "Use production or sandbox.");
  const provider = new WhopProvider(process.env.WHOP_API_KEY || "", environment);
  if (command === "onboard")
    await store.initialize({
      platformAccountId: process.env.WHOP_PLATFORM_ACCOUNT_ID || "",
      environment,
    });
  const context = await store.context();
  if (
    context.environment !== environment ||
    context.platformAccountId !== process.env.WHOP_PLATFORM_ACCOUNT_ID
  ) {
    throw new IntegrationError(
      "environment_mismatch",
      "The registry does not match the configured environment and platform.",
    );
  }
  let result;
  if (command === "reconcile") {
    result = await reconcile(
      store,
      provider,
      values.seller || "",
      { from: values.from || "", to: values.to || "" },
      await receipts(),
    );
    if (!result.clean) process.exitCode = 2;
  } else {
    if (!values.input)
      throw new IntegrationError("missing_input", "Provide a JSON file with --input.");
    const input = JSON.parse(await readFile(values.input, "utf8"));
    result =
      command === "checkout"
        ? await createCheckout(store, provider, input)
        : await onboardSeller(store, provider, input, {
            returnUrl: values["return-url"] || "",
            refreshUrl: values["refresh-url"] || "",
          });
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(
    error instanceof IntegrationError
      ? `${error.code}: ${error.message}`
      : "Command failed. Check inputs, local file permissions, and configuration; no provider response was printed.",
  );
  process.exitCode = 1;
});
