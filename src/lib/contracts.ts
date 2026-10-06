export const PAYOUT_SCOPES = [
  "company:balance:read",
  "stats:read",
  "payout:destination:read",
  "payout:withdrawal:read",
  "payout:create_destination",
  "payout:withdraw_funds",
] as const;

export const TOKEN_TTL_MS = 10 * 60 * 1000;
export const TOKEN_REFRESH_BUFFER_MS = 60 * 1000;

export type PayoutSession = {
  accountId: string;
  token: string;
  issuedAt: string;
  expiresAt: string;
  scopedActions: readonly string[];
};

export type Money = { amount: string; currency: string };

export type CryptoMarkup = {
  percentage: number;
  fixed: Money;
  adjustable: boolean;
  maximum: { percentage: number | null; fixed: Money | null };
  source: "custom" | "default" | null;
  unadjustableReason: string | null;
};

export type FeeSnapshot = {
  accountId: string;
  rail: "crypto";
  retrievedAt: string;
  markup: CryptoMarkup;
};

export type ApiFailure = {
  error: { message: string; code: string; requestId?: string };
};
