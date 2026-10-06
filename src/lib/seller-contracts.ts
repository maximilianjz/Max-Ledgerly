import type { Seller } from "./integration/store.ts";

// Patterns also work with HTML's pattern attribute, which uses Unicode set syntax.
export const EXTERNAL_ID_PATTERN = "[A-Za-z0-9][A-Za-z0-9_.:\\-]{0,119}";
export const EMAIL_PATTERN = "[^@\\s]+@[^@\\s]+\\.[^@\\s]+";
export const EXTERNAL_ID = new RegExp(`^${EXTERNAL_ID_PATTERN}$`);

export type SellerStatus = {
  seller: Seller;
  status: string;
  verification: { individual: string | null; business: string | null };
  requiredActions: { title: string; description: string; status: string }[] | null;
  capabilities: Record<string, string>;
  checkedAt: string;
};

export { COUNTRIES } from "./countries.ts";
export function sellerPath(externalId: string) {
  return `/sellers/${encodeURIComponent(externalId)}`;
}
export function sellerQuery(externalId?: string) {
  return externalId ? `?seller=${encodeURIComponent(externalId)}` : "";
}
