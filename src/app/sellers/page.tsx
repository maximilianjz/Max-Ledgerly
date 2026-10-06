import { SellerOnboarding } from "@/components/seller-onboarding";
import { WorkspaceHeader } from "@/components/workspace-header";
import { onboardingIssue } from "@/lib/sellers";

export const dynamic = "force-dynamic";
export default function SellersPage() {
  return (
    <>
      <WorkspaceHeader />
      <SellerOnboarding issue={onboardingIssue()} />
    </>
  );
}
