import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL before applying the schema.");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/integration/schema.ts",
  dbCredentials: { url: process.env.DATABASE_URL },
  tablesFilter: ["ledgerly_*"],
  strict: true,
  verbose: false,
});
