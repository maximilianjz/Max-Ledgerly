import type { Seller } from "./integration/store";

export type SellerStatus = {
  seller: Seller;
  status: string;
  verification: { individual: string | null; business: string | null };
  requiredActions: { title: string; description: string; status: string }[] | null;
  capabilities: Record<string, string>;
  checkedAt: string;
};

export const COUNTRIES: Record<string, string> = {
  US: "United States",
  DE: "Germany",
  BR: "Brazil",
};
export function sellerPath(externalId: string) {
  return `/sellers/${encodeURIComponent(externalId)}`;
}
export function sellerQuery(externalId?: string) {
  return externalId ? `?seller=${encodeURIComponent(externalId)}` : "";
}

export function workspaceReturnPath(value: unknown): string {
  if (typeof value !== "string") return "/sellers";
  try {
    const url = new URL(value, "https://ledgerly.invalid");
    if (
      url.origin === "https://ledgerly.invalid" &&
      (/^\/sellers(?:\/[A-Za-z0-9_.:%-]+)?$/.test(url.pathname) ||
        /^\/payouts(?:\/refresh)?$/.test(url.pathname))
    )
      return `${url.pathname}${url.search}`;
  } catch {
    /* Invalid destinations return to the seller list. */
  }
  return "/sellers";
}
