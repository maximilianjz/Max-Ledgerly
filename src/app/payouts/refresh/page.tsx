import { PortalRefresh } from "@/components/portal-refresh";
import { WorkspaceHeader } from "@/components/workspace-header";

export const dynamic = "force-dynamic";

export default async function PortalRefreshPage({
  searchParams,
}: {
  searchParams: Promise<{ seller?: string }>;
}) {
  const { seller } = await searchParams;
  return (
    <>
      <WorkspaceHeader />
      <PortalRefresh sellerId={seller} />
    </>
  );
}
