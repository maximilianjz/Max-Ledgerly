import { execFile } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleWebhook, listReceipts, WEBHOOK_EVENTS } from "@/lib/whop-webhooks";
import { clearStorageEnvironment } from "./storage-fixture";
import { webhookContracts } from "./webhook-contracts";

const secret = "ws_assessment_test_secret_not_a_real_credential";
const now = Date.UTC(2026, 9, 5, 23);
const accounts = { biz_fixtureUS: "us", biz_fixtureGermany: "germany" };
let directory: string;
const base = {
  id: "msg_test001",
  type: "payment.succeeded",
  api_version: "v1",
  api_version_date: "2026-09-29",
  timestamp: "2026-10-05T23:00:00.000Z",
  account_id: "biz_fixtureUS",
  data: {
    id: "pay_test",
    status: "succeeded",
    amount: 25,
    currency: "usd",
    customer: { email: "private@example.com" },
  },
};

function request(
  event: unknown = base,
  options: { timestamp?: number; headerId?: string; tamper?: boolean; rotate?: boolean } = {},
) {
  const raw = JSON.stringify(event);
  const timestamp = String(options.timestamp ?? now / 1000);
  const id = options.headerId ?? base.id;
  const signature = createHmac("sha256", secret)
    .update(`${id}.${timestamp}.${raw}`)
    .digest("base64");
  return new Request("http://localhost/api/webhooks/whop", {
    method: "POST",
    body: options.tamper ? raw.replace('"amount":25', '"amount":26') : raw,
    headers: {
      "content-type": "application/json",
      "webhook-id": id,
      "webhook-timestamp": timestamp,
      "webhook-signature": `${options.rotate ? "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= " : ""}v1,${signature}`,
    },
  });
}

function receive(incoming = request()) {
  return handleWebhook(incoming, { secret, directory, now, accounts });
}

beforeEach(async () => {
  clearStorageEnvironment();
  directory = await mkdtemp(join(tmpdir(), "ledgerly-webhooks-test-"));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

describe("verified, persistent webhook receipts", () => {
  it("covers every subscribed event with a documented contract fixture", () => {
    expect(webhookContracts.map(({ type }) => type).sort()).toEqual([...WEBHOOK_EVENTS].sort());
  });

  it.each(webhookContracts)(
    "accepts $type without an envelope owner and deduplicates it",
    async ({ type, data, accountId }) => {
      const incoming = { ...base, type, account_id: undefined, data };
      const response = await receive(request(incoming));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        received: true,
        duplicate: false,
        account_id: accountId,
        seller: null,
        disposition: "quarantined",
      });
      expect(await (await receive(request(incoming))).json()).toMatchObject({ duplicate: true });
      expect(await listReceipts(directory)).toHaveLength(1);
    },
  );

  it.each(webhookContracts)(
    "accepts a legacy company_id envelope for $type",
    async ({ type, data }) => {
      const incoming = {
        ...base,
        type,
        api_version_date: "2026-06-01",
        account_id: undefined,
        company_id: "biz_xxxxxxxxxxxxxx",
        data,
      };
      const response = await receive(request(incoming));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ account_id: "biz_xxxxxxxxxxxxxx" });
    },
  );

  it("routes a signed event and retains selected fields without customer details", async () => {
    expect(await (await receive()).json()).toMatchObject({
      received: true,
      duplicate: false,
      seller: "us",
      disposition: "routed",
    });
    const rows = await listReceipts(directory);
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toMatchObject({ data: { id: "pay_test", amount: 25 } });
    expect(JSON.stringify(rows)).not.toMatch(/private@example|customer|ws_assessment/);
  });

  it("deduplicates concurrent requests without overwriting the original receipt", async () => {
    const replies = await Promise.all(
      Array.from({ length: 12 }, async () => (await receive()).json()),
    );
    expect(replies.filter((reply) => !reply.duplicate)).toHaveLength(1);
    expect(replies.filter((reply) => reply.duplicate)).toHaveLength(11);
    expect(await listReceipts(directory)).toHaveLength(1);
  });

  it.each([false, true])(
    "preserves the saved response when seller mappings change (initially routed: %s)",
    async (initiallyRouted) => {
      const first = await handleWebhook(request(), {
        secret,
        directory,
        now,
        accounts: initiallyRouted ? accounts : {},
      });
      expect(first.status).toBe(200);
      const original = await first.json();
      expect(original).toMatchObject({
        duplicate: false,
        seller: initiallyRouted ? "us" : null,
        disposition: initiallyRouted ? "routed" : "quarantined",
      });
      const saved = await listReceipts(directory);
      expect(saved).toHaveLength(1);

      const replay = await handleWebhook(request(), {
        secret,
        directory,
        now,
        accounts: initiallyRouted ? {} : accounts,
      });
      expect(replay.status).toBe(200);
      expect(await replay.json()).toEqual({ ...original, duplicate: true });
      expect(await listReceipts(directory)).toEqual(saved);
    },
  );

  it.each(
    webhookContracts.filter(
      ({ type }) => type === "payment.succeeded" || type === "refund.created",
    ),
  )("retains $type deduplication in a fresh Node process", async ({ type, data }) => {
    expect((await receive(request({ ...base, type, account_id: undefined, data }))).status).toBe(
      200,
    );
    const source = new URL("../src/lib/whop-webhooks.ts", import.meta.url).href;
    const code = `import {saveReceipt,listReceipts} from ${JSON.stringify(source)}; const d=process.argv[1];const [r]=await listReceipts(d);console.log(JSON.stringify({duplicate:!(await saveReceipt(d,r)).created,count:(await listReceipts(d)).length}));`;
    const result = await promisify(execFile)(process.execPath, [
      "--experimental-strip-types",
      "--input-type=module",
      "-e",
      code,
      directory,
    ]);
    expect(JSON.parse(result.stdout)).toEqual({ duplicate: true, count: 1 });
  });

  it.each(["tampered", "old", "future", "missing signature"])(
    "rejects %s authentication before writing",
    async (kind) => {
      const incoming = request(base, {
        tamper: kind === "tampered",
        timestamp:
          kind === "old" ? now / 1000 - 301 : kind === "future" ? now / 1000 + 301 : undefined,
      });
      if (kind === "missing signature") incoming.headers.delete("webhook-signature");
      expect((await receive(incoming)).status).toBe(401);
      expect(await listReceipts(directory)).toHaveLength(0);
    },
  );

  it("accepts one valid signature among multiple rotation signatures", async () => {
    expect((await receive(request(base, { rotate: true }))).status).toBe(200);
  });

  it("deduplicates equivalent JSON when property order changes", async () => {
    await receive();
    const { data, ...rest } = base;
    const reordered = { data: { ...data }, ...rest };
    expect(await (await receive(request(reordered))).json()).toMatchObject({ duplicate: true });
    expect(await listReceipts(directory)).toHaveLength(1);
  });

  it("rejects the local filesystem store on Vercel without acknowledging", async () => {
    vi.stubEnv("VERCEL", "1");
    expect((await receive()).status).toBe(503);
    expect(await listReceipts(directory)).toHaveLength(0);
  });

  it("rejects unsupported event types before writing", async () => {
    expect((await receive(request({ ...base, type: "payment.created" }))).status).toBe(400);
    expect(await listReceipts(directory)).toHaveLength(0);
  });

  it("rejects a signed-header and envelope ID mismatch", async () => {
    expect((await receive(request(base, { headerId: "msg_other" }))).status).toBe(400);
    expect(await listReceipts(directory)).toHaveLength(0);
  });

  it("detects changed content reused under an existing event ID", async () => {
    await receive();
    const changed = { ...base, data: { ...base.data, amount: 99 } };
    expect((await receive(request(changed))).status).toBe(409);
    expect((await listReceipts(directory))[0].payload).toMatchObject({ data: { amount: 25 } });
  });

  it("handles legacy company_id using the event's version pin", async () => {
    const legacy = {
      ...base,
      api_version_date: "2026-06-01",
      account_id: undefined,
      company_id: "biz_fixtureGermany",
    };
    expect(await (await receive(request(legacy))).json()).toMatchObject({ seller: "germany" });
  });

  it.each([null, undefined])(
    "accepts account_id on a webhook without a dated version (%s)",
    async (version) => {
      const incoming = { ...base, api_version_date: version };
      expect(await (await receive(request(incoming))).json()).toMatchObject({
        received: true,
        account_id: "biz_fixtureUS",
        seller: "us",
      });
      expect((await listReceipts(directory))[0].account_id).toBe("biz_fixtureUS");
    },
  );

  it.each([null, undefined])(
    "retains legacy company_id support without a dated version (%s)",
    async (version) => {
      const incoming = {
        ...base,
        api_version_date: version,
        account_id: undefined,
        company_id: "biz_fixtureGermany",
      };
      expect(await (await receive(request(incoming))).json()).toMatchObject({
        account_id: "biz_fixtureGermany",
        seller: "germany",
      });
    },
  );

  it("still enforces an explicit version pin's routing field", async () => {
    for (const incoming of [
      { ...base, api_version_date: "2026-06-01" },
      { ...base, account_id: undefined, company_id: "biz_fixtureUS" },
    ]) {
      expect((await receive(request(incoming))).status).toBe(400);
    }
    expect(await listReceipts(directory)).toHaveLength(0);
  });

  it.each(["payment.succeeded", "payment.failed"])(
    "routes %s by its signed payment account when the envelope has no account",
    async (type) => {
      const incoming = {
        ...base,
        type,
        account_id: null,
        company_id: null,
        data: { ...base.data, account_id: "biz_fixtureUS" },
      };
      expect(await (await receive(request(incoming))).json()).toMatchObject({
        received: true,
        account_id: "biz_fixtureUS",
        seller: "us",
        disposition: "routed",
      });
    },
  );

  it.each([null, undefined, "2026-06-01"])(
    "accepts a legacy payment owner with a compatible pin (%s)",
    async (version) => {
      const incoming = {
        ...base,
        api_version_date: version,
        account_id: undefined,
        data: { ...base.data, company_id: "biz_fixtureGermany" },
      };
      expect(await (await receive(request(incoming))).json()).toMatchObject({
        account_id: "biz_fixtureGermany",
        seller: "germany",
      });
    },
  );

  it("does not let a nested account bypass invalid or conflicting identity or version fields", async () => {
    const incoming = {
      ...base,
      account_id: undefined,
      data: { ...base.data, account_id: "biz_fixtureUS" },
    };
    for (const invalid of [
      { account_id: "not-a-business" },
      { company_id: "biz_fixtureUS" },
      { api_version_date: "2026-06-01" },
      { data: { ...incoming.data, company_id: "biz_fixtureGermany" } },
      { data: { ...incoming.data, account_id: "not-a-business" } },
    ]) {
      expect((await receive(request({ ...incoming, ...invalid }))).status).toBe(400);
    }
    expect(await listReceipts(directory)).toHaveLength(0);
  });

  it("rejects conflicting or malformed IDs on unpinned webhooks", async () => {
    for (const account of [
      { account_id: "biz_fixtureUS", company_id: "biz_fixtureGermany" },
      { account_id: "not-a-business", company_id: undefined },
    ]) {
      expect((await receive(request({ ...base, api_version_date: null, ...account }))).status).toBe(
        400,
      );
    }
    expect(await listReceipts(directory)).toHaveLength(0);
  });

  it("rejects conflicting routing identity instead of assigning a seller", async () => {
    expect((await receive(request({ ...base, company_id: "biz_other" }))).status).toBe(400);
    expect(await listReceipts(directory)).toHaveLength(0);
  });

  it("quarantines a payment with no owner instead of assigning it from metadata", async () => {
    const incoming = {
      ...base,
      account_id: undefined,
      data: { ...base.data, metadata: { ledgerly_seller_external_id: "us" } },
    };
    expect(await (await receive(request(incoming))).json()).toMatchObject({
      received: true,
      account_id: null,
      seller: null,
      disposition: "quarantined",
    });
  });

  it("reports only safe routing fields when a signed event cannot be attributed", async () => {
    const incoming = {
      ...base,
      type: "payout.updated",
      account_id: "private@example.com",
      data: { ...base.data, account_id: "biz_fixtureUS", company_id: "private@example.com" },
    };
    const response = await receive(request(incoming));
    expect(response.status).toBe(400);
    const body = await response.text();
    expect(body).toContain("data_account_id");
    expect(body).toContain("biz_fixtureUS");
    expect(body).not.toMatch(/private@example|customer|pay_test|ws_assessment/);
    expect(await listReceipts(directory)).toHaveLength(0);
  });

  it("quarantines a signed event for an unknown account", async () => {
    expect(
      await (await receive(request({ ...base, account_id: "biz_unknown" }))).json(),
    ).toMatchObject({ disposition: "quarantined", seller: null });
    expect((await listReceipts(directory))[0].disposition).toBe("quarantined");
  });

  it("fails without acknowledging when storage is unavailable", async () => {
    const file = join(directory, "not-a-directory");
    await writeFile(file, "occupied");
    const response = await handleWebhook(request(), { secret, directory: file, now, accounts });
    expect(response.status).toBe(500);
    expect(await readFile(file, "utf8")).toBe("occupied");
    expect(await readdir(directory)).toEqual(["not-a-directory"]);
  });
});
