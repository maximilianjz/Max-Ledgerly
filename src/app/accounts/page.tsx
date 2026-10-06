import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { WorkspaceHeader } from "@/components/workspace-header";
import { COUNTRIES, sellerPath, sellerQuery } from "@/lib/seller-contracts";
import { listSellers, onboardingIssue } from "@/lib/sellers";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  let issue = onboardingIssue();
  let sellers: Awaited<ReturnType<typeof listSellers>> = [];
  if (!issue) {
    try {
      sellers = await listSellers();
    } catch {
      issue = "Your seller accounts could not be loaded. Refresh the page to try again.";
    }
  }

  return (
    <>
      <WorkspaceHeader />
      <main className="page-enter mx-auto max-w-3xl px-6 py-10 sm:px-10 sm:py-14">
        <p className="mb-3 text-sm text-muted-foreground">Existing accounts</p>
        <h1 className="font-display text-5xl leading-none tracking-[-1px] sm:text-6xl">
          Choose a seller.
        </h1>
        <p className="mt-5 text-sm leading-7 text-muted-foreground">
          Open payouts or pick up where you left off with verification.
        </p>
        {issue ? (
          <Alert className="mt-9">
            <AlertDescription>{issue}</AlertDescription>
          </Alert>
        ) : sellers.length ? (
          <ul className="mt-9 divide-y border-y">
            {sellers.map((seller) => (
              <li key={seller.externalId} className="py-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <h2 className="break-all text-base font-semibold">{seller.externalId}</h2>
                    <p className="mt-2 break-all text-xs leading-5 text-muted-foreground">
                      {seller.email} · {COUNTRIES[seller.country] || seller.country}
                    </p>
                  </div>
                  <Button asChild className="h-11 w-fit shrink-0">
                    <Link href={`/payouts${sellerQuery(seller.externalId)}`}>
                      Open payouts <ArrowRight className="size-4" />
                    </Link>
                  </Button>
                </div>
                <Button
                  asChild
                  variant="link"
                  className="mt-3 h-auto p-0 text-xs text-muted-foreground"
                >
                  <Link href={sellerPath(seller.externalId)}>View account and verification</Link>
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-9 border-y py-8 text-sm leading-6 text-muted-foreground">
            No seller accounts are connected yet. Create your first account to get started.
          </p>
        )}
        <Button asChild variant="link" className="mt-6 h-auto p-0">
          <Link href="/sellers">
            Create a new seller account <ArrowRight className="size-4" />
          </Link>
        </Button>
      </main>
    </>
  );
}
