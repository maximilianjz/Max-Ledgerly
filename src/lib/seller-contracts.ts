import type { Seller } from "./integration/store";

export type SellerStatus = {
  seller: Seller;
  status: string;
  verification: { individual: string | null; business: string | null };
  requiredActions: { title: string; description: string; status: string }[] | null;
  capabilities: Record<string, string>;
  checkedAt: string;
};

export { COUNTRIES } from "./countries";
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
      (url.pathname === "/accounts" ||
        /^\/sellers(?:\/[A-Za-z0-9_.:%-]+)?$/.test(url.pathname) ||
        /^\/payouts(?:\/refresh)?$/.test(url.pathname))
    )
      return `${url.pathname}${url.search}`;
  } catch {
    /* Invalid destinations return to seller setup. */
  }
  return "/sellers";
}
