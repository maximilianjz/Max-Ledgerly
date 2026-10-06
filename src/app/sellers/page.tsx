import { SellerOnboarding } from "@/components/seller-onboarding";
import { WorkspaceHeader } from "@/components/workspace-header";
import { requirePageSession } from "@/lib/auth";
import { listSellers, onboardingIssue } from "@/lib/sellers";

export const dynamic = "force-dynamic";
export default async function SellersPage() {
  await requirePageSession("/sellers");
  let issue = onboardingIssue();
  let sellers: Awaited<ReturnType<typeof listSellers>> = [];
  try {
    sellers = await listSellers();
  } catch {
    issue =
      "The saved sellers could not be loaded. Check the workspace configuration before continuing.";
  }
  return (
    <>
      <WorkspaceHeader />
      <SellerOnboarding sellers={sellers} issue={issue} />
    </>
  );
}
