import "server-only";
import { AppError } from "@/lib/errors";

export function getAccountId() {
  const id = process.env.WHOP_ACCOUNT_ID || "";
  if (!/^biz_[a-zA-Z0-9]+$/.test(id)) {
    throw new AppError(
      "The seller account is not configured correctly.",
      503,
      "configuration_required",
    );
  }
  return id;
}

export function getAppOrigin() {
  const configured =
    process.env.APP_URL || (process.env.NODE_ENV !== "production" ? "http://localhost:3000" : "");
  try {
    const url = new URL(configured);
    const local = ["localhost", "127.0.0.1"].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/")
      throw new Error("origin");
    if (
      url.protocol !== "https:" &&
      !(local && url.protocol === "http:" && process.env.NODE_ENV !== "production")
    )
      throw new Error("protocol");
    return url.origin;
  } catch {
    throw new AppError(
      "Set APP_URL to this app's HTTPS origin before deploying.",
      503,
      "configuration_required",
    );
  }
}

export function getAuthConfig() {
  const password = process.env.ASSESSMENT_PASSWORD || "";
  const secret = process.env.SESSION_SECRET || "";
  if (password.length < 20 || secret.length < 32) {
    throw new AppError(
      "Run npm run setup to configure the local assessment login.",
      503,
      "configuration_required",
    );
  }
  return {
    password,
    secret,
    accountId:
      process.env.WHOP_PLATFORM_ACCOUNT_ID || process.env.WHOP_ACCOUNT_ID || "unconfigured",
  };
}

export function getWhopKey() {
  const key = process.env.WHOP_API_KEY?.trim();
  if (!key) {
    throw new AppError(
      "Add Ledgerly's production API key to WHOP_API_KEY in .env.local, then restart the app.",
      503,
      "whop_not_configured",
    );
  }
  return key;
}

export function isWhopConfigured() {
  return Boolean(process.env.WHOP_API_KEY?.trim());
}
