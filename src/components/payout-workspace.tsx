"use client";

import { ExternalLink, LoaderCircle, RefreshCw } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { PayoutSkeleton } from "@/components/payout-skeleton";
import { SessionDetails } from "@/components/session-details";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { usePayoutSession } from "@/hooks/use-payout-session";
import { apiRequest } from "@/lib/client-api";
import { sellerQuery } from "@/lib/seller-contracts";

const PayoutElements = dynamic(() => import("@/components/payout-elements"), {
  ssr: false,
  loading: () => <PayoutSkeleton />,
});

export function PayoutWorkspace({
  configured,
  sellerId,
}: {
  configured: boolean;
  sellerId?: string;
}) {
  const { session, pending, error, retry } = usePayoutSession(configured, sellerId);
  const query = sellerQuery(sellerId);
  const [portalPending, setPortalPending] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  async function openPortal() {
    setPortalPending(true);
    setPortalError(null);
    try {
      const result = await apiRequest<{ url: string }>(`/api/payout-portal${query}`);
      window.location.assign(result.url);
    } catch (caught) {
      setPortalError(caught instanceof Error ? caught.message : "Couldn’t open the portal.");
      setPortalPending(false);
    }
  }

  const hostedPortal = (
    <div className="min-w-0">
      <Button
        variant="outline"
        onClick={openPortal}
        disabled={!configured || portalPending}
        className="h-11 w-full justify-between gap-4 bg-card px-4"
        aria-describedby="hosted-portal-description"
      >
        {portalPending ? "Opening Whop…" : "Open Whop portal"}
        {portalPending ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <ExternalLink className="size-4" />
        )}
      </Button>
      <p id="hosted-portal-description" className="mt-2 text-xs text-muted-foreground">
        Continue on Whop’s website.
      </p>
      {portalError && (
        <p role="alert" className="mt-3 max-w-xs text-sm text-destructive">
          {portalError}
        </p>
      )}
    </div>
  );

  return (
    <div>
      <div className="pb-8">
        {error && (
          <Alert className="mb-8 border-[#dbc9ac] bg-[#faf4e7]">
            <AlertTitle>
              {session ? "Your connection needs a refresh" : "Couldn’t connect to Whop"}
            </AlertTitle>
            <AlertDescription>
              <p>{error.message}</p>
              {error.requestId && (
                <p className="break-all font-mono text-[11px]">Request: {error.requestId}</p>
              )}
              <Button
                variant="outline"
                size="sm"
                className="mt-1 w-fit"
                onClick={retry}
                disabled={pending}
              >
                <RefreshCw className={pending ? "size-3.5 animate-spin" : "size-3.5"} />
                {pending ? "Connecting…" : "Reconnect"}
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {!configured && (
          <section className="py-10">
            <h2 className="font-display text-3xl">Payouts aren’t available yet.</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Contact your workspace owner to finish connecting Whop.
            </p>
          </section>
        )}
        {configured && pending && !session && <PayoutSkeleton />}
        {session && (
          <PayoutElements
            key={revision}
            session={session}
            onWithdrawalDone={() => setRevision((value) => value + 1)}
            hostedPortal={hostedPortal}
          />
        )}
        {configured && !session && <div className="mt-6 max-w-xs">{hostedPortal}</div>}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-x-5 gap-y-4 border-t py-5 text-xs text-muted-foreground">
        <p>Live payouts · USD · Powered by Whop</p>
        <div className="flex flex-wrap items-center gap-1">
          <SessionDetails session={session} />
          {session && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Refresh payout connection"
              disabled={pending}
              onClick={() => {
                setRevision((value) => value + 1);
                retry();
              }}
            >
              <RefreshCw className={pending ? "size-3.5 animate-spin" : "size-3.5"} />
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}
