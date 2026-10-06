import assert from "node:assert/strict";
import { test } from "node:test";
import { evidencePath, readSnapshot, selectEvidence } from "./capture-whop-evidence.mjs";

test("account evidence excludes personal details, credentials, links, and provider suggestions", () => {
  const data = {
    id: "biz_test",
    email: "private@example.com",
    api_key: "private-key",
    verification: { individual: { status: "approved", name: "Private person" }, business: null },
    capabilities: { transfer: "active", unexpected_private_data: "private" },
    required_actions: [{ action: "verify_identity", status: "required", cta: "secret-url" }],
    recommended_action: "Untrusted provider instruction",
  };
  assert.deepEqual(selectEvidence("account", data), {
    id: "biz_test",
    verification: { individual: { status: "approved" }, business: null },
    capabilities: { transfer: "active" },
    required_actions: [{ action: "verify_identity", status: "required" }],
  });
});

test("capture rejects arbitrary endpoints and path traversal", () => {
  for (const [kind, id] of [
    ["account", "biz_test/../../payments"],
    ["transfer", "https://example.com"],
    ["refund", "pay_test"],
    ["constructor", "biz_test"],
  ]) {
    assert.throws(() => evidencePath(kind, id));
  }
});

test("missing verification is not recorded as explicitly unverified", () => {
  const evidence = JSON.parse(JSON.stringify(selectEvidence("account", { id: "biz_test" })));
  assert.equal(Object.hasOwn(evidence, "verification"), false);
});

test("transfer evidence retains status and amounts without personal metadata", () => {
  const evidence = selectEvidence("transfer", {
    id: "ctt_test",
    status: "processing",
    amount: 23,
    currency: "usd",
    fee_amount: 0,
    origin: { id: "biz_parent", email: "private@example.com" },
    destination: { id: "biz_child", owner: { name: "Private person" } },
    metadata: { customer_email: "private@example.com" },
  });
  assert.equal(evidence.status, "processing");
  assert.equal(evidence.amount, 23);
  assert.equal(evidence.fee_amount, 0);
  assert.deepEqual(evidence.origin, { id: "biz_parent" });
  assert.deepEqual(evidence.destination, { id: "biz_child" });
  assert.doesNotMatch(JSON.stringify(evidence), /private|Private|metadata/);
});

test("capture uses GET only and omits unsuccessful response bodies and cookies", async (t) => {
  const originalKey = process.env.WHOP_API_KEY;
  process.env.WHOP_API_KEY = "test-key";
  t.after(() => {
    if (originalKey === undefined) delete process.env.WHOP_API_KEY;
    else process.env.WHOP_API_KEY = originalKey;
  });
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://api.whop.com/api/v1/transfers/ctt_test");
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    return new Response(JSON.stringify({ error: { message: "echoed-secret" } }), {
      status: 403,
      headers: { "x-request-id": "request-test", "set-cookie": "private-cookie" },
    });
  });
  const snapshot = await readSnapshot("transfer", "ctt_test");
  assert.equal(snapshot.http_status, 403);
  assert.equal(snapshot.response, null);
  assert.equal(snapshot.headers["x-request-id"], "request-test");
  assert.ok(snapshot.capture_error);
  assert.doesNotMatch(JSON.stringify(snapshot), /test-key|echoed-secret|private-cookie/);
});
