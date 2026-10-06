import { PayoutWorkspace } from "@/components/payout-workspace";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { WorkspaceHeader } from "@/components/workspace-header";
import { requirePageSession } from "@/lib/auth";
import { isWhopConfigured } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { IntegrationError } from "@/lib/integration/store";
import { sellerQuery } from "@/lib/seller-contracts";
import { payoutSeller } from "@/lib/sellers";

export const dynamic = "force-dynamic";

export default async function PayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ seller?: string }>;
}) {
  const { seller: externalId } = await searchParams;
  await requirePageSession(`/payouts${sellerQuery(externalId)}`);
  let seller: Awaited<ReturnType<typeof payoutSeller>>;
  try {
    seller = await payoutSeller(externalId);
  } catch (error) {
    return (
      <>
        <WorkspaceHeader />
        <main className="mx-auto max-w-3xl px-6 py-12">
          <Alert variant="destructive">
            <AlertDescription>
              {error instanceof AppError || error instanceof IntegrationError
                ? error.message
                : "This seller’s payouts could not be loaded. Return to Sellers and try again."}
            </AlertDescription>
          </Alert>
        </main>
      </>
    );
  }
  return (
    <>
      <WorkspaceHeader sellerId={externalId} />
      <PayoutWorkspace
        key={seller.accountId}
        accountId={seller.accountId}
        sellerId={seller.externalId}
        sellerLabel={seller.label}
        country={seller.country}
        configured={isWhopConfigured()}
      />
    </>
  );
}
