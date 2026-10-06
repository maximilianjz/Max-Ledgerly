import { existsSync, writeFileSync } from "node:fs";

if (existsSync(".env.local")) {
  console.log(".env.local already exists; no values were changed.");
  process.exit(0);
}

writeFileSync(
  ".env.local",
  [
    "WHOP_API_KEY=",
    "WHOP_ACCOUNT_ID=",
    "WHOP_PLATFORM_ACCOUNT_ID=",
    "WHOP_ENVIRONMENT=production",
    "LEDGERLY_DATA_DIR=.data/ledgerly",
    "DATABASE_URL=",
    "LEDGERLY_STORAGE_NAMESPACE=ledgerly-v1",
    "APP_URL=http://localhost:3000",
    "",
  ].join("\n"),
  { mode: 0o600, flag: "wx" },
);
console.log("Created .env.local. Add your Whop account IDs and API key, then run npm run dev.");
