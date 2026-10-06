import "server-only";
import { z } from "zod";
import { getAccountId, getAppOrigin, getWhopKey } from "@/lib/config";
import { type FeeSnapshot, PAYOUT_SCOPES, type PayoutSession, TOKEN_TTL_MS } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { sellerQuery } from "@/lib/seller-contracts";

export const WHOP_API_BASE = "https://api.whop.com/api/v1";
export const WHOP_API_VERSION = "2026-09-29";

function cleanProviderMessage(message: string, key: string) {
  return message
    .split(key)
    .join("[redacted]")
    .replace(/apik_[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted]")
    .slice(0, 360);
}

async function whopRequest(path: string, init?: { method?: "POST" | "PATCH"; body?: unknown }) {
  const key = getWhopKey();
  let response: Response;
  try {
    response = await fetch(`${WHOP_API_BASE}${path}`, {
      method: init?.method || "GET",
      headers: {
        Authorization: `Bearer ${key}`,
        "Api-Version-Date": WHOP_API_VERSION,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new AppError(
      "Whop could not be reached. Try again in a moment.",
      502,
      "whop_unreachable",
    );
  }
  const requestId =
    response.headers.get("x-request-id") || response.headers.get("request-id") || undefined;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const providerError = z
      .object({ error: z.object({ message: z.string().optional(), code: z.string().optional() }) })
      .safeParse(data);
    const message =
      providerError.success && providerError.data.error.message
        ? cleanProviderMessage(providerError.data.error.message, key)
        : "Whop rejected the request. Check the account key and its permissions.";
    throw new AppError(
      message,
      response.status === 429 ? 429 : 502,
      "whop_request_failed",
      requestId,
    );
  }
  return { data, requestId };
}

export async function createPayoutSession(
  now = Date.now(),
  accountId = getAccountId(),
): Promise<PayoutSession> {
  const expiresAt = new Date(now + TOKEN_TTL_MS).toISOString();
  const { data, requestId } = await whopRequest("/access_tokens", {
    method: "POST",
    body: { account_id: accountId, scoped_actions: [...PAYOUT_SCOPES], expires_at: expiresAt },
  });
  const parsed = z
    .object({ token: z.string().min(1), expires_at: z.string().datetime({ offset: true }) })
    .safeParse(data);
  if (
    !parsed.success ||
    Date.parse(parsed.data.expires_at) <= now ||
    Date.parse(parsed.data.expires_at) > now + TOKEN_TTL_MS + 5000
  ) {
    throw new AppError(
      "Whop returned an invalid token expiry. Please try again.",
      502,
      "invalid_whop_response",
      requestId,
    );
  }
  return {
    accountId,
    token: parsed.data.token,
    issuedAt: new Date(now).toISOString(),
    expiresAt: parsed.data.expires_at,
    scopedActions: [...PAYOUT_SCOPES],
  };
}

export async function createPayoutPortal(accountId = getAccountId(), sellerId?: string) {
  const origin = getAppOrigin();
  const query = sellerQuery(sellerId);
  const { data, requestId } = await whopRequest("/account_links", {
    method: "POST",
    body: {
      account_id: accountId,
      use_case: "payouts_portal",
      return_url: `${origin}/payouts${query}`,
      refresh_url: `${origin}/payouts/refresh${query}`,
    },
  });
  const result = z
    .object({ url: z.string().url(), expires_at: z.string().datetime({ offset: true }) })
    .safeParse(data);
  if (result.success) {
    const url = new URL(result.data.url);
    if (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (url.hostname === "whop.com" || url.hostname.endsWith(".whop.com"))
    ) {
      return { url: result.data.url, expiresAt: result.data.expires_at };
    }
  }
  throw new AppError(
    "Whop returned an invalid portal link.",
    502,
    "invalid_whop_response",
    requestId,
  );
}

const money = z.object({
  amount: z.string().regex(/^-?\d+(\.\d+)?$/),
  currency: z.string().min(3),
});
const markup = z.object({
  percentage: z.number().finite(),
  fixed: money,
  adjustable: z.boolean(),
  maximum: z.object({ percentage: z.number().finite().nullable(), fixed: money.nullable() }),
  source: z.enum(["custom", "default"]).nullable(),
  unadjustable_reason: z.string().nullable(),
});

function feeSnapshot(data: unknown, accountId: string, requestId?: string): FeeSnapshot {
  const result = z
    .object({
      account_id: z.string(),
      markups: z.object({ payouts: z.object({ crypto: markup }) }),
    })
    .safeParse(data);
  if (!result.success || result.data.account_id !== accountId) {
    throw new AppError(
      "Whop did not return this seller's crypto markup settings.",
      502,
      "invalid_fee_response",
      requestId,
    );
  }
  const row = result.data.markups.payouts.crypto;
  return {
    accountId: result.data.account_id,
    rail: "crypto",
    retrievedAt: new Date().toISOString(),
    markup: {
      percentage: row.percentage,
      fixed: row.fixed,
      adjustable: row.adjustable,
      maximum: row.maximum,
      source: row.source,
      unadjustableReason: row.unadjustable_reason,
    },
  };
}

export async function getCryptoMarkup(accountId = getAccountId()) {
  const result = await whopRequest(`/accounts/${accountId}/fees`);
  return feeSnapshot(result.data, accountId, result.requestId);
}

export async function updateCryptoMarkup(percentage: number, accountId = getAccountId()) {
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    throw new AppError("Enter a percentage between 0 and 100.", 400, "invalid_percentage");
  }
  const before = await getCryptoMarkup(accountId);
  if (!before.markup.adjustable) {
    throw new AppError(
      "This key cannot change the seller's markup. It needs company:update_child_fees on Ledgerly.",
      403,
      "markup_not_adjustable",
    );
  }
  const maximum = before.markup.maximum.percentage;
  if (maximum === null) {
    throw new AppError(
      "Whop has not supplied an allowed percentage limit for this rail.",
      409,
      "markup_limit_unavailable",
    );
  }
  if (percentage > maximum) {
    throw new AppError(
      `Whop allows a maximum markup of ${maximum}% on this rail.`,
      400,
      "markup_above_maximum",
    );
  }
  await whopRequest(`/accounts/${accountId}/fees`, {
    method: "PATCH",
    body: { markups: { payouts: { crypto: { percentage } } } },
  });
  // Read back the persisted setting; a successful PATCH alone is not evidence.
  const after = await getCryptoMarkup(accountId);
  if (Math.abs(after.markup.percentage - percentage) > 0.000001) {
    throw new AppError(
      "The requested markup was not confirmed on read-back. Refresh the settings before trying again.",
      409,
      "markup_unconfirmed",
    );
  }
  return { before, after };
}
