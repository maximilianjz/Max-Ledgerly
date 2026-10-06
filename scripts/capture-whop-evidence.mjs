import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API_VERSION = "2026-09-29";
const capabilityNames = [
  "accept_bank_payments",
  "accept_bnpl_payments",
  "accept_card_payments",
  "bank_deposit",
  "card_deposit",
  "card_issuing",
  "crypto_deposit",
  "crypto_payout",
  "instant_payout",
  "run_ads",
  "standard_payout",
  "transfer",
];

function scalarFields(value, names) {
  return Object.fromEntries(
    names.flatMap((name) => {
      const item = value?.[name];
      return item === null || ["string", "number", "boolean"].includes(typeof item)
        ? [[name, item]]
        : [];
    }),
  );
}

export function evidencePath(kind, id) {
  const patterns = { account: /^biz_[A-Za-z0-9]+$/, transfer: /^ctt_[A-Za-z0-9]+$/ };
  if (!Object.hasOwn(patterns, kind) || !patterns[kind].test(id)) {
    throw new Error("Use account <biz_id> or transfer <ctt_id>.");
  }
  return `/${kind}s/${id}`;
}

export function selectEvidence(kind, data) {
  if (kind === "account") {
    return {
      ...scalarFields(data, ["id", "parent_company_id", "created_at"]),
      verification:
        data.verification == null
          ? data.verification
          : Object.fromEntries(
              ["individual", "business"].flatMap((name) => {
                const value = data.verification[name];
                if (value === undefined) return [];
                return [[name, value === null ? null : scalarFields(value, ["status"])]];
              }),
            ),
      required_actions: Array.isArray(data.required_actions)
        ? data.required_actions.map((action) => scalarFields(action, ["action", "status"]))
        : null,
      capabilities: scalarFields(data.capabilities, capabilityNames),
    };
  }
  return {
    ...scalarFields(data, [
      "id",
      "created_at",
      "amount",
      "currency",
      "fee_amount",
      "status",
      "origin_ledger_account_id",
      "destination_ledger_account_id",
    ]),
    origin: scalarFields(data.origin, ["id"]),
    destination: scalarFields(data.destination, ["id"]),
  };
}

export async function readSnapshot(kind, id) {
  const path = evidencePath(kind, id);
  const key = process.env.WHOP_API_KEY;
  if (!key) throw new Error("Set WHOP_API_KEY in .env.local first.");
  const response = await fetch(`https://api.whop.com/api/v1${path}`, {
    method: "GET",
    redirect: "error",
    headers: {
      Authorization: `Bearer ${key}`,
      "Api-Version-Date": API_VERSION,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => null);
  const matches = data?.id === id;
  return {
    source: "live_whop_api",
    observed_at: new Date().toISOString(),
    request: { method: "GET", path, api_version: API_VERSION },
    http_status: response.status,
    headers: Object.fromEntries(
      ["date", "api-version-date", "x-request-id"].map((name) => [
        name,
        response.headers.get(name),
      ]),
    ),
    response: response.ok && matches ? selectEvidence(kind, data) : null,
    ...(response.ok && matches
      ? {}
      : { capture_error: "No matching successful resource response; raw body omitted." }),
  };
}

async function main() {
  const [kind, id, ...extra] = process.argv.slice(2);
  if (extra.length) throw new Error("Use account <biz_id> or transfer <ctt_id>.");
  const snapshot = await readSnapshot(kind, id);
  const directory = fileURLToPath(new URL("../evidence/snapshots/", import.meta.url));
  await mkdir(directory, { recursive: true });
  const timestamp = snapshot.observed_at.replace(/[:.]/g, "-");
  const destination = resolve(directory, `${timestamp}-${id}-${randomUUID().slice(0, 8)}.json`);
  await writeFile(destination, `${JSON.stringify(snapshot, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  console.log(`Saved HTTP ${snapshot.http_status}: ${destination}`);
  if (snapshot.capture_error) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error(
      "Capture failed. Use account <biz_id> or transfer <ctt_id>; check .env.local and connectivity. No raw response was saved.",
    );
    process.exitCode = 1;
  });
}
