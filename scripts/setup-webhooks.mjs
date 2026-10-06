import { randomBytes } from "node:crypto";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { LocalStore } from "../src/lib/integration/store.ts";

const contents = [
  "# Local fixture signing key; not a Whop-issued credential.",
  "WHOP_WEBHOOK_MODE=local",
  `WHOP_WEBHOOK_SECRET=ws_${randomBytes(32).toString("hex")}`,
  "WHOP_WEBHOOK_STORAGE_DIR=.data/local-webhook-fixtures",
  "LEDGERLY_DATA_DIR=.data/local-webhook-fixtures/registry",
  "",
].join("\n");
try {
  await writeFile(".env.webhooks.local", contents, { mode: 0o600, flag: "wx" });
  console.log("Created private local fixture configuration. Start with npm run webhooks:dev.");
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  console.log("Preserved the existing .env.webhooks.local configuration.");
}

const saved = await readFile(".env.webhooks.local", "utf8");
if (!/^WHOP_WEBHOOK_MODE=local$/m.test(saved))
  throw new Error("Setup accepts local fixture mode only.");
const directory =
  saved.match(/^LEDGERLY_DATA_DIR=(.+)$/m)?.[1] || ".data/local-webhook-fixtures/registry";
if (!/^LEDGERLY_DATA_DIR=.+$/m.test(saved))
  await appendFile(".env.webhooks.local", `\nLEDGERLY_DATA_DIR=${directory}\n`);
const store = new LocalStore(directory);
await store.initialize({ environment: "fixture", platformAccountId: "biz_fixtureplatform" });
for (const [name, country] of [
  ["us", "US"],
  ["germany", "DE"],
  ["brazil", "BR"],
]) {
  await store.exact("sellers", `fixture-${name}`, {
    externalId: `fixture-${name}`,
    email: `${name}@example.test`,
    country,
    accountId: `biz_fixture${name}`,
    platformAccountId: "biz_fixtureplatform",
  });
}
console.log("Fixture seller registry ready; no Whop requests were made.");
