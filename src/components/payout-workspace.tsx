"use client";

import {
  ArrowUpRight,
  Check,
  Copy,
  Globe2,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Unplug,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { FeeSettings } from "@/components/fee-settings";
import { PayoutSkeleton } from "@/components/payout-skeleton";
import { SessionDetails } from "@/components/session-details";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePayoutSession } from "@/hooks/use-payout-session";
import { apiRequest, ClientApiError } from "@/lib/client-api";
import { COUNTRIES, sellerQuery } from "@/lib/seller-contracts";

const PayoutElements = dynamic(() => import("@/components/payout-elements"), {
  ssr: false,
  loading: () => <PayoutSkeleton />,
});

export function PayoutWorkspace({
  accountId,
  configured,
  sellerId,
  sellerLabel,
  country,
}: {
  accountId: string;
  configured: boolean;
  sellerId?: string;
  sellerLabel: string;
  country: string;
}) {
  const { session, pending, error, retry } = usePayoutSession(configured, sellerId);
  const query = sellerQuery(sellerId);
  const [portalPending, setPortalPending] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revision, setRevision] = useState(0);

  async function openPortal() {
    setPortalPending(true);
    setPortalError(null);
    try {
      const result = await apiRequest<{ url: string }>(`/api/payout-portal${query}`);
      window.location.assign(result.url);
    } catch (caught) {
      if (caught instanceof ClientApiError && caught.status === 401) {
        window.location.assign(`/login?next=${encodeURIComponent(`/payouts${query}`)}`);
        return;
      }
      setPortalError(caught instanceof Error ? caught.message : "Couldn’t open the portal.");
      setPortalPending(false);
    }
  }

  async function copyAccount() {
    try {
      await navigator.clipboard.writeText(accountId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <main className="page-enter mx-auto max-w-[1320px] px-6 pt-10 pb-8 sm:px-10 sm:pt-14">
      <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
        <div>
          <p className="mb-3 text-sm text-muted-foreground">Your seller workspace</p>
          <h1 className="font-display text-6xl leading-none tracking-[-1.5px] sm:text-7xl">
            Payouts<span className="text-[#839667]">.</span>
          </h1>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            A clear view of your money. A simple way to move it.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={openPortal}
          disabled={!configured || portalPending}
          className="h-11 w-fit gap-3 bg-card px-4"
        >
          {portalPending ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <ArrowUpRight className="size-4" />
          )}
          Open hosted portal
        </Button>
      </div>

      <div className="mt-9 flex flex-wrap items-center justify-between gap-x-6 gap-y-4 border-y py-5">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-full bg-secondary">
            <Globe2 className="size-[18px] text-primary" strokeWidth={1.6} />
          </span>
          <div>
            <p className="break-all text-sm font-semibold">{sellerLabel}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {COUNTRIES[country] ? `${COUNTRIES[country]} · ` : ""}USD
            </p>
          </div>
          <Badge
            variant="outline"
            className="ml-2 border-[#d8dcbc] bg-[#edf1df] font-normal text-[#596631]"
          >
            <span className="mr-1 size-1.5 rounded-full bg-[#7b893e]" />
            Production
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={copyAccount}
          className="max-w-full gap-2 px-0 font-mono text-[11px] text-muted-foreground"
          aria-label="Copy seller account ID"
        >
          <span className="truncate">{accountId}</span>
          {copied ? (
            <Check className="size-3.5 shrink-0" />
          ) : (
            <Copy className="size-3.5 shrink-0" />
          )}
        </Button>
      </div>

      <div className="py-8 sm:py-10">
        {portalError && (
          <Alert variant="destructive" className="mb-6">
            <AlertTitle>The hosted portal couldn’t open</AlertTitle>
            <AlertDescription>{portalError}</AlertDescription>
          </Alert>
        )}
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
          <section className="flex min-h-[340px] flex-col items-center justify-center px-5 py-10 text-center">
            <span className="mb-5 flex size-12 items-center justify-center rounded-full bg-secondary">
              <Unplug className="size-5 text-primary" />
            </span>
            <h2 className="font-display text-4xl">Connect your seller account.</h2>
            <p className="mt-4 max-w-md text-sm leading-6 text-muted-foreground">
              Add Ledgerly’s production API key to <code className="text-xs">WHOP_API_KEY</code> in{" "}
              <code className="text-xs">.env.local</code>, then restart the app. Your seller’s live
              balance and activity will appear here.
            </p>
          </section>
        )}
        {configured && pending && !session && <PayoutSkeleton />}
        {session && (
          <PayoutElements
            key={revision}
            session={session}
            onWithdrawalDone={() => setRevision((value) => value + 1)}
          />
        )}
        {configured && !session && !pending && error && (
          <div className="py-14 text-center">
            <ShieldCheck className="mx-auto mb-4 size-7 text-muted-foreground" strokeWidth={1.4} />
            <p className="text-sm text-muted-foreground">
              Reconnect to load your seller’s balance and payouts.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              The hosted portal is also available above.
            </p>
          </div>
        )}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-x-5 gap-y-4 border-t py-5 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span
            className={
              session ? "size-1.5 rounded-full bg-[#72905c]" : "size-1.5 rounded-full bg-border"
            }
          />
          {session
            ? "Temporary access active"
            : pending
              ? "Connecting to Whop…"
              : "No active payout connection"}
          <span className="mx-1 text-border">/</span>
          <span>Powered by Whop</span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <SessionDetails session={session} />
          <FeeSettings
            enabled={configured}
            apiPath={`/api/fees${query}`}
            onChanged={() => setRevision((value) => value + 1)}
          />
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
    </main>
  );
}
