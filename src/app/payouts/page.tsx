import { redirect } from "next/navigation";
import { EXTERNAL_ID, sellerPath } from "@/lib/seller-contracts";

// Preserve existing bookmarks and Whop return URLs in the unified workspace.
export default async function PayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ seller?: string }>;
}) {
  const { seller } = await searchParams;
  redirect(
    typeof seller === "string" && EXTERNAL_ID.test(seller)
      ? sellerPath(seller, "payouts")
      : "/accounts",
  );
}
