import type { Checkout, Order, Seller } from "./integration/store.ts";

// Patterns also work with HTML's pattern attribute, which uses Unicode set syntax.
export const EXTERNAL_ID_PATTERN = "[A-Za-z0-9][A-Za-z0-9_.:\\-]{0,119}";
export const EMAIL_PATTERN = "[^@\\s]+@[^@\\s]+\\.[^@\\s]+";
export const EXTERNAL_ID = new RegExp(`^${EXTERNAL_ID_PATTERN}$`);

export type PaymentLinkInput = { orderId: string; title: string; amount: string };
export type PaymentLink = { order: Order; checkout: Checkout; reused: boolean };

export type SellerStatus = {
  seller: Seller;
  status: string;
  verification: { individual: string | null; business: string | null };
  requiredActions: { title: string; description: string; status: string }[] | null;
  capabilities: Record<string, string>;
  checkedAt: string;
};

export { COUNTRIES } from "./countries.ts";
export type SellerTab = "account" | "payouts";
export function sellerPath(externalId: string, tab: SellerTab = "account") {
  return `/sellers/${encodeURIComponent(externalId)}${tab === "payouts" ? "?tab=payouts" : ""}`;
}
export function sellerQuery(externalId?: string) {
  return externalId ? `?seller=${encodeURIComponent(externalId)}` : "";
}
