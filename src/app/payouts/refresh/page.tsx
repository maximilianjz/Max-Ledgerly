import { PortalRefresh } from "@/components/portal-refresh";
import { WorkspaceHeader } from "@/components/workspace-header";
import { requirePageSession } from "@/lib/auth";
import { sellerQuery } from "@/lib/seller-contracts";

export const dynamic = "force-dynamic";

export default async function PortalRefreshPage({
  searchParams,
}: {
  searchParams: Promise<{ seller?: string }>;
}) {
  const { seller } = await searchParams;
  await requirePageSession(`/payouts/refresh${sellerQuery(seller)}`);
  return (
    <>
      <WorkspaceHeader sellerId={seller} />
      <PortalRefresh sellerId={seller} />
    </>
  );
}
