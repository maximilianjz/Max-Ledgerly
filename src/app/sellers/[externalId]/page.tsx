import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { PayoutWorkspace } from "@/components/payout-workspace";
import { SellerStatus } from "@/components/seller-status";
import { SellerWorkspace } from "@/components/seller-workspace";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { WorkspaceHeader } from "@/components/workspace-header";
import { isWhopConfigured } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { IntegrationError } from "@/lib/integration/store";
import { isLocalOperator } from "@/lib/local-operator";
import { EXTERNAL_ID } from "@/lib/seller-contracts";
import { payoutSeller, verificationIssue } from "@/lib/sellers";

export const dynamic = "force-dynamic";
export default async function SellerPage({
  params,
  searchParams,
}: {
  params: Promise<{ externalId: string }>;
  searchParams: Promise<{ tab?: string; returned?: string; refresh?: string }>;
}) {
  const { externalId } = await params;
  if (!EXTERNAL_ID.test(externalId)) notFound();
  const query = await searchParams;
  const tab = query.tab === "payouts" ? "payouts" : "account";
  let content: ReactNode;
  if (tab === "payouts") {
    try {
      const seller = await payoutSeller(externalId);
      content = (
        <PayoutWorkspace
          key={seller.accountId}
          sellerId={externalId}
          configured={isWhopConfigured()}
        />
      );
    } catch (error) {
      content = (
        <Alert variant="destructive">
          <AlertDescription>
            {error instanceof AppError || error instanceof IntegrationError
              ? error.message
              : "This seller’s payouts could not be loaded. Open the Account tab to check its status."}
          </AlertDescription>
        </Alert>
      );
    }
  } else {
    content = (
      <SellerStatus
        key={externalId}
        externalId={externalId}
        issue={verificationIssue()}
        returned={query.returned === "1"}
        refresh={query.refresh === "1"}
      />
    );
  }
  return (
    <>
      <WorkspaceHeader />
      <SellerWorkspace
        key={externalId}
        externalId={externalId}
        tab={tab}
        showActivity={isLocalOperator(await headers())}
      >
        {content}
      </SellerWorkspace>
    </>
  );
}
