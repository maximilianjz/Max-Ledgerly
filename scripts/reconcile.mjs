import { WhopProvider } from "../src/lib/integration/provider.ts";
import { reconcile } from "../src/lib/integration/reconciliation.ts";
import { configuredContext, createStore } from "../src/lib/integration/storage.ts";
import { IntegrationError } from "../src/lib/integration/store.ts";
import { listReceipts } from "../src/lib/whop-webhooks.ts";

// Read-only job: compare one seller and creation-time window, then emit a JSON report.
try {
  const [seller, from, to, ...extra] = process.argv.slice(2);
  if (!seller || !from || !to || extra.length)
    throw new IntegrationError(
      "invalid_arguments",
      "Usage: npm run reconcile -- <seller-id> <from-ISO-date> <to-ISO-date>",
    );
  const configured = configuredContext();
  const store = createStore();
  const saved = await store.context();
  if (
    saved.environment !== configured.environment ||
    saved.platformAccountId !== configured.platformAccountId
  )
    throw new IntegrationError(
      "environment_mismatch",
      "The registry does not match the configured environment and platform.",
    );
  const report = await reconcile(
    store,
    new WhopProvider(process.env.WHOP_API_KEY || "", configured.environment),
    seller,
    { from, to },
    await listReceipts(store),
  );
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.clean ? 0 : 2;
} catch (error) {
  console.error(
    error instanceof IntegrationError
      ? `${error.code}: ${error.message}`
      : "Reconciliation failed. Check inputs, storage, and configuration; no provider response was printed.",
  );
  process.exitCode = 1;
}
