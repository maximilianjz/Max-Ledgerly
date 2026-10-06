import { execFile } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleWebhook, listReceipts } from "@/lib/whop-webhooks";
import { clearStorageEnvironment } from "./redis-fixture";

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

  it("retains deduplication in a fresh Node process", async () => {
    await receive();
    const source = new URL("../src/lib/whop-webhooks.ts", import.meta.url).href;
    const code = `import {saveReceipt,listReceipts} from ${JSON.stringify(source)}; const d=process.argv[1];const [r]=await listReceipts(d);console.log(JSON.stringify({duplicate:await saveReceipt(d,r),count:(await listReceipts(d)).length}));`;
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

  it("rejects missing or conflicting routing identity instead of assigning a seller", async () => {
    expect((await receive(request({ ...base, company_id: "biz_other" }))).status).toBe(400);
    expect((await receive(request({ ...base, account_id: undefined }))).status).toBe(400);
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
