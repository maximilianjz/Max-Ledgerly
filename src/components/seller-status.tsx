"use client";

import { ArrowUpRight, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { PaymentLinkForm } from "@/components/payment-link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { apiRequest } from "@/lib/client-api";
import { COUNTRIES, type SellerStatus as Status, sellerPath } from "@/lib/seller-contracts";

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
  const verificationButton = (
    <Button
      variant="outline"
      onClick={continueOnWhop}
      disabled={!state || suspended || opening || Boolean(issue)}
      className="w-fit shrink-0"
    >
      {opening ? "Opening Whop…" : "Continue on Whop"}
      {opening ? (
        <LoaderCircle className="size-4 animate-spin" />
      ) : (
        <ArrowUpRight className="size-4" />
      )}
    </Button>
  );
  return (
    <div className="max-w-5xl">
      {returned && (
        <p role="status" className="mb-5 text-sm leading-6 text-muted-foreground">
          Welcome back. The status below reflects Whop’s latest review.
        </p>
      )}
      {refresh && (
        <p role="status" className="mb-5 text-sm leading-6 text-muted-foreground">
          Your previous verification link expired. Continue on Whop for a new one.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {state && (
          <>
            <p className="min-w-0 break-words text-sm text-muted-foreground">
              {state.seller.email} · {COUNTRIES[state.seller.country] || state.seller.country}
            </p>
            <Badge variant="outline" className="font-normal capitalize">
              <span className="sr-only">Account status: </span>
              {label(state.status)}
            </Badge>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="ghost" size="sm" className="sm:ml-auto">
                  Account details
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[85dvh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Account details</DialogTitle>
                  <DialogDescription>
                    Verification and availability reported by Whop.
                  </DialogDescription>
                </DialogHeader>
                <dl className="text-sm">
                  <dt className="text-muted-foreground">Connected account</dt>
                  <dd className="mt-1 break-all font-mono text-xs">{state.seller.accountId}</dd>
                </dl>
                <section aria-labelledby="verification-heading">
                  <h2 id="verification-heading" className="mb-2 text-sm font-semibold">
                    Verification
                  </h2>
                  <dl>
                    {Object.entries(state.verification).map(([kind, value]) => (
                      <div key={kind} className="flex justify-between gap-4 py-2 text-sm">
                        <dt className="capitalize">{kind}</dt>
                        <dd className="text-right capitalize text-muted-foreground">
                          {label(value)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
                <section aria-labelledby="capabilities-heading" className="border-t pt-4">
                  <h2 id="capabilities-heading" className="mb-2 text-sm font-semibold">
                    Payments and payouts
                  </h2>
                  <dl>
                    {Object.entries(capabilityNames).map(([key, title]) => (
                      <div key={key} className="flex justify-between gap-4 py-2 text-sm">
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
                {!state.requiredActions?.length && (
                  <p className="text-sm text-muted-foreground">
                    {state.requiredActions === null
                      ? "Whop did not return required actions for this account."
                      : "No additional actions requested."}
                  </p>
                )}
                {verificationButton}
                {issue && <p className="text-xs leading-5 text-muted-foreground">{issue}</p>}
                <p className="text-xs text-muted-foreground">
                  Last checked {new Date(state.checkedAt).toLocaleString()}.
                </p>
              </DialogContent>
            </Dialog>
          </>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setAttempt((value) => value + 1)}
          disabled={loading || opening}
          className="size-8 text-muted-foreground"
          aria-label="Refresh status"
          title="Refresh status"
        >
          <RefreshCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} />
        </Button>
      </div>
      {issue && <p className="mt-3 text-xs leading-5 text-muted-foreground">{issue}</p>}
      {error && (
        <Alert variant="destructive" className="mt-6">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {loading && (
        <p role="status" className="flex items-center gap-3 py-12 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" /> Loading account…
        </p>
      )}
      {state && (
        <>
          {suspended && (
            <Alert variant="destructive" className="mt-5">
              <AlertDescription>
                This account is suspended. Contact the platform administrator before continuing.
              </AlertDescription>
            </Alert>
          )}
          {(Boolean(state.requiredActions?.length) || refresh) && (
            <section
              className="mt-6 flex flex-col gap-4 border-l-2 border-amber-600/50 pl-4 sm:flex-row sm:items-start sm:justify-between sm:gap-8"
              aria-label="Required actions"
            >
              <ul className="space-y-4">
                {state.requiredActions?.map((action) => (
                  <li key={action.title}>
                    <h2 className="text-sm font-medium">
                      {action.title}{" "}
                      <span className="ml-2 text-xs font-normal capitalize text-muted-foreground">
                        {label(action.status)}
                      </span>
                    </h2>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {action.description}
                    </p>
                  </li>
                ))}
              </ul>
              {verificationButton}
            </section>
          )}
          {!suspended && <PaymentLinkForm key={externalId} externalId={externalId} issue={issue} />}
        </>
      )}
    </div>
  );
}
