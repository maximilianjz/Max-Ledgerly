import { PostgresStore, postgresClient } from "./postgres.ts";
import { IntegrationError, LocalStore, type Store } from "./store.ts";

export function configuredContext() {
  const platformAccountId = process.env.WHOP_PLATFORM_ACCOUNT_ID || "";
  const environment = process.env.WHOP_ENVIRONMENT || "production";
  if (
    !/^biz_[A-Za-z0-9]+$/.test(platformAccountId) ||
    (environment !== "production" && environment !== "sandbox")
  )
    throw new IntegrationError(
      "setup_required",
      "Configure the platform account and environment first.",
    );
  return { platformAccountId, environment } as const;
}

export function createStore(): Store {
  if (process.env.WHOP_WEBHOOK_MODE !== "local" && process.env.DATABASE_URL) {
    const context = configuredContext();
    const namespace = process.env.LEDGERLY_STORAGE_NAMESPACE || "ledgerly-v1";
    if (!/^[A-Za-z0-9:_-]{1,64}$/.test(namespace))
      throw new IntegrationError(
        "storage_configuration_required",
        "Configure a valid storage namespace.",
      );
    return new PostgresStore(
      postgresClient(process.env.DATABASE_URL),
      `${namespace}:${context.environment}:${context.platformAccountId}`,
    );
  }
  if (process.env.VERCEL)
    throw new IntegrationError(
      "persistent_storage_required",
      "Set DATABASE_URL and apply the PostgreSQL schema to enable seller onboarding and webhooks.",
    );
  return new LocalStore(undefined, process.env.WHOP_WEBHOOK_STORAGE_DIR);
}

export function storageIssue() {
  try {
    createStore();
    return null;
  } catch (error) {
    return error instanceof IntegrationError ? error.message : "Configure seller storage first.";
  }
}
