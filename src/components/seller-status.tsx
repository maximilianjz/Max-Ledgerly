"use client";

import { ArrowLeft, ArrowRight, ArrowUpRight, LoaderCircle, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/client-api";
import {
  COUNTRIES,
  type SellerStatus as Status,
  sellerPath,
  sellerQuery,
} from "@/lib/seller-contracts";

function label(value: string | null) {
  return value ? value.replaceAll("_", " ") : "Not reported";
}
const capabilityNames: Record<string, string> = {
  accept_card_payments: "Card payments",
  accept_bank_payments: "Bank payments",
  transfer: "Transfers",
  standard_payout: "Standard payouts",
  instant_payout: "Instant payouts",
  crypto_payout: "Crypto payouts",
};

export function SellerStatus({
  externalId,
  issue,
  returned,
  refresh,
}: {
  externalId: string;
  issue: string | null;
  returned: boolean;
  refresh: boolean;
}) {
  const [state, setState] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const path = `/api${sellerPath(externalId)}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is an explicit manual status refresh.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setState(null);
    apiRequest<Status>(path, { method: "GET", signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setState(result);
      })
      .catch((caught) => {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : "Couldn’t read this account.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, attempt]);

  async function continueOnWhop() {
    setOpening(true);
    setError(null);
    try {
      const result = await apiRequest<{ onboardingUrl: string }>(`${path}/onboarding`);
      window.location.assign(result.onboardingUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn’t open verification.");
      setOpening(false);
    }
  }
  const suspended = state?.status === "suspended";
  return (
    <main className="page-enter mx-auto max-w-5xl px-6 py-10 sm:px-10 sm:py-14">
      <Button asChild variant="link" className="mb-6 h-auto p-0 text-muted-foreground">
        <Link href="/accounts">
          <ArrowLeft className="size-4" /> All sellers
        </Link>
      </Button>
      <p className="mb-3 text-sm text-muted-foreground">Seller account</p>
      <h1 className="break-words font-display text-5xl leading-none tracking-[-1px] sm:text-6xl">
        {externalId}
      </h1>
      {state && (
        <p className="mt-4 break-all text-sm text-muted-foreground">
          {state.seller.email} · {COUNTRIES[state.seller.country] || state.seller.country}
        </p>
      )}
      {returned && (
        <p role="status" className="mt-6 text-sm leading-6 text-muted-foreground">
          Welcome back. We’re checking Whop for the latest account status. Returning from
          verification does not necessarily mean the review is finished.
        </p>
      )}
      {refresh && (
        <p role="status" className="mt-6 text-sm leading-6 text-muted-foreground">
          Your previous verification link expired. Continue on Whop below to get a fresh link.
        </p>
      )}
      <div className="mt-8 flex flex-wrap gap-3 border-y py-5">
        <Button
          onClick={continueOnWhop}
          disabled={!state || suspended || opening || Boolean(issue)}
          className="h-11"
        >
          <span>{opening ? "Opening Whop…" : "Continue on Whop"}</span>
          {opening ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <ArrowUpRight className="size-4" />
          )}
        </Button>
        {state && !suspended && (
          <Button asChild variant="outline" className="h-11">
            <Link href={`/payouts${sellerQuery(externalId)}`}>
              Open seller payouts <ArrowRight className="size-4" />
            </Link>
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={() => setAttempt((value) => value + 1)}
          disabled={loading || opening}
          className="h-11"
        >
          <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} /> Refresh status
        </Button>
      </div>
      {issue && <p className="mt-5 text-sm leading-6 text-muted-foreground">{issue}</p>}
      {error && (
        <Alert variant="destructive" className="mt-6">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {loading && (
        <p role="status" className="flex items-center gap-3 py-12 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" /> Reading the seller account from Whop…
        </p>
      )}
      {state && (
        <>
          <div className="mt-9 flex flex-wrap items-center justify-between gap-3 text-sm">
            <p>
              Account status{" "}
              <Badge variant="outline" className="ml-2 capitalize">
                {label(state.status)}
              </Badge>
            </p>
            <p className="break-all font-mono text-xs text-muted-foreground">
              {state.seller.accountId}
            </p>
          </div>
          {suspended && (
            <Alert variant="destructive" className="mt-5">
              <AlertDescription>
                This account is suspended. Contact the platform administrator before continuing.
              </AlertDescription>
            </Alert>
          )}
          <div className="mt-9 grid gap-10 sm:grid-cols-2">
            <section aria-labelledby="verification-heading">
              <h2 id="verification-heading" className="mb-4 text-lg font-semibold">
                Verification
              </h2>
              <dl className="divide-y">
                {Object.entries(state.verification).map(([kind, value]) => (
                  <div key={kind} className="flex justify-between gap-4 py-3 text-sm">
                    <dt className="capitalize">{kind}</dt>
                    <dd className="text-right capitalize text-muted-foreground">{label(value)}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 text-xs leading-5 text-muted-foreground">
                Whop determines which checks apply to this account.
              </p>
            </section>
            <section aria-labelledby="capabilities-heading">
              <h2 id="capabilities-heading" className="mb-4 text-lg font-semibold">
                Payments and payouts
              </h2>
              <dl className="divide-y">
                {Object.entries(capabilityNames).map(([key, title]) => (
                  <div key={key} className="flex justify-between gap-4 py-3 text-sm">
                    <dt>{title}</dt>
                    <dd
                      className={`text-right capitalize ${state.capabilities[key] === "active" ? "text-primary" : "text-muted-foreground"}`}
                    >
                      {label(state.capabilities[key] || null)}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>
          <section className="mt-10 border-t pt-7" aria-labelledby="actions-heading">
            <h2 id="actions-heading" className="text-lg font-semibold">
              Required actions
            </h2>
            {state.requiredActions?.length ? (
              <ul className="mt-4 space-y-5">
                {state.requiredActions.map((action) => (
                  <li key={action.title}>
                    <p className="text-sm font-medium">
                      {action.title}{" "}
                      <span className="ml-2 font-normal capitalize text-muted-foreground">
                        {label(action.status)}
                      </span>
                    </p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {action.description}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                {state.requiredActions === null
                  ? "Whop did not return required actions for this account."
                  : "Whop is not requesting any additional actions right now."}
              </p>
            )}
          </section>
          <p className="mt-9 text-xs text-muted-foreground">
            Last checked {new Date(state.checkedAt).toLocaleString()}. Account availability can
            change as Whop reviews it.
          </p>
        </>
      )}
    </main>
  );
}
