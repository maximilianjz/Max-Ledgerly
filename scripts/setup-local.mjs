import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";

if (existsSync(".env.local")) {
  console.log(".env.local already exists; no values were changed.");
  process.exit(0);
}

const password = randomBytes(24).toString("base64url");
const secret = randomBytes(48).toString("base64url");
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
    `ASSESSMENT_PASSWORD=${password}`,
    `SESSION_SECRET=${secret}`,
    "",
  ].join("\n"),
  { mode: 0o600, flag: "wx" },
);
writeFileSync(
  "local-access.txt",
  [
    "Ledgerly local access",
    "",
    "URL: http://localhost:3000",
    `Assessment password: ${password}`,
    "",
    "This file and .env.local are ignored by Git. Keep them private.",
    "Add your Ledgerly production API key to WHOP_API_KEY in .env.local.",
    "Set WHOP_ACCOUNT_ID to your seller and WHOP_PLATFORM_ACCOUNT_ID to your parent account.",
    "Use separate credentials in Vercel when deploying.",
    "",
  ].join("\n"),
  { mode: 0o600, flag: "wx" },
);
console.log("Created .env.local and local-access.txt. Your local password is in local-access.txt.");
