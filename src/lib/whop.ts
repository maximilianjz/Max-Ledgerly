import "server-only";
import { z } from "zod";
import { getAccountId, getAppOrigin, getWhopKey } from "@/lib/config";
import { PAYOUT_SCOPES, type PayoutSession, TOKEN_TTL_MS } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { trustedWhopUrl } from "@/lib/integration/provider";
import { sellerQuery } from "@/lib/seller-contracts";
import { requestWhop } from "@/lib/whop-api";

function cleanProviderMessage(message: string, key: string) {
  return message
    .split(key)
    .join("[redacted]")
    .replace(/apik_[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted]")
    .slice(0, 360);
}

async function whopRequest(path: string, body: Record<string, unknown>) {
  const key = getWhopKey();
  let result: Awaited<ReturnType<typeof requestWhop>>;
  try {
    result = await requestWhop(key, "POST", path, { body });
  } catch {
    throw new AppError(
      "Whop could not be reached. Try again in a moment.",
      502,
      "whop_unreachable",
    );
  }
  const { data, requestId, ok, status } = result;
  if (!ok) {
    const providerError = z
      .object({ error: z.object({ message: z.string().optional(), code: z.string().optional() }) })
      .safeParse(data);
    const message =
      providerError.success && providerError.data.error.message
        ? cleanProviderMessage(providerError.data.error.message, key)
        : "Whop rejected the request. Check the account key and its permissions.";
    throw new AppError(message, status === 429 ? 429 : 502, "whop_request_failed", requestId);
  }
  return { data, requestId };
}

export async function createPayoutSession(
  now = Date.now(),
  accountId = getAccountId(),
): Promise<PayoutSession> {
  const expiresAt = new Date(now + TOKEN_TTL_MS).toISOString();
  const { data, requestId } = await whopRequest("/access_tokens", {
    account_id: accountId,
    scoped_actions: [...PAYOUT_SCOPES],
    expires_at: expiresAt,
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
    account_id: accountId,
    use_case: "payouts_portal",
    return_url: `${origin}/payouts${query}`,
    refresh_url: `${origin}/payouts/refresh${query}`,
  });
  const result = z
    .object({ url: z.string().url(), expires_at: z.string().datetime({ offset: true }) })
    .safeParse(data);
  if (result.success) {
    try {
      return { url: trustedWhopUrl(result.data.url), expiresAt: result.data.expires_at };
    } catch {
      /* Keep an invalid provider URL out of the response. */
    }
  }
  throw new AppError(
    "Whop returned an invalid portal link.",
    502,
    "invalid_whop_response",
    requestId,
  );
}
