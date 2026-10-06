import { SellerStatus } from "@/components/seller-status";
import { WorkspaceHeader } from "@/components/workspace-header";
import { verificationIssue } from "@/lib/sellers";

export const dynamic = "force-dynamic";
export default async function SellerPage({
  params,
  searchParams,
}: {
  params: Promise<{ externalId: string }>;
  searchParams: Promise<{ returned?: string; refresh?: string }>;
}) {
  const { externalId } = await params;
  const query = await searchParams;
  return (
    <>
      <WorkspaceHeader />
      <SellerStatus
        key={externalId}
        externalId={externalId}
        issue={verificationIssue()}
        returned={query.returned === "1"}
        refresh={query.refresh === "1"}
      />
    </>
  );
}
