import { SellerStatus } from "@/components/seller-status";
import { WorkspaceHeader } from "@/components/workspace-header";
import { requirePageSession } from "@/lib/auth";
import { sellerPath } from "@/lib/seller-contracts";
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
  await requirePageSession(
    `${sellerPath(externalId)}${query.returned ? "?returned=1" : query.refresh ? "?refresh=1" : ""}`,
  );
  return (
    <>
      <WorkspaceHeader sellerId={externalId} />
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
