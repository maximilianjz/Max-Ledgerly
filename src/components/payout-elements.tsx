"use client";

import { loadWhop } from "@whop/elements";
import { BalanceElement, Balances, Wallet, WhopElements } from "@whop/elements-react";
import { RefreshCw } from "lucide-react";
import { Component, type ReactNode, useState } from "react";
import { PayoutActivity } from "@/components/payout-activity";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { WithdrawFunds } from "@/components/withdraw-funds";
import type { PayoutSession } from "@/lib/contracts";

const whop = loadWhop();

class ElementBoundary extends Component<
  { children: ReactNode; hostedPortal: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <Alert variant="destructive">
          <AlertTitle>The embedded portal couldn’t load</AlertTitle>
          <AlertDescription>
            <p>Refresh your connection, or continue on Whop.</p>
            <div className="mt-3 max-w-xs">{this.props.hostedPortal}</div>
          </AlertDescription>
        </Alert>
      );
    return this.props.children;
  }
}

export default function PayoutElements({
  session,
  onWithdrawalDone,
  hostedPortal,
}: {
  session: PayoutSession;
  onWithdrawalDone: () => void;
  hostedPortal: ReactNode;
}) {
  const [loadFailure, setLoadFailure] = useState<{ retry: () => void } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  function recordError(section: string) {
    return (error: { message: string }) =>
      setErrors((current) => ({ ...current, [section]: error.message.slice(0, 240) }));
  }
  function clearError(section: string) {
    return () =>
      setErrors((current) => {
        const next = { ...current };
        delete next[section];
        return next;
      });
  }

  return (
    <ElementBoundary hostedPortal={hostedPortal}>
      <WhopElements
        elements={whop}
        environment="production"
        appearance={{ theme: { appearance: "light", accentColor: "green", grayColor: "sage" } }}
        onLoadError={(_error, retry) => setLoadFailure({ retry })}
      >
        {loadFailure && (
          <Alert className="mb-8">
            <AlertTitle>Whop’s components couldn’t load</AlertTitle>
            <AlertDescription>
              <p>Check your connection or use “Open Whop portal” below.</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  loadFailure.retry();
                  setLoadFailure(null);
                }}
              >
                <RefreshCw className="size-3.5" />
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        )}
        <Wallet accountId={session.accountId} accessToken={session.token} currency="usd">
          <section className="min-w-0" aria-labelledby="balance-heading">
            <h2 id="balance-heading" className="sr-only">
              Your balance
            </h2>
            <Balances>
              <BalanceElement
                accessToken={session.token}
                onReady={clearError("balance")}
                onError={recordError("balance")}
              />
            </Balances>
            {errors.balance && (
              <p role="alert" className="mt-3 text-sm text-destructive">
                Balance: {errors.balance}
              </p>
            )}
          </section>
          <section
            className="my-8 flex flex-col gap-5 border-y py-6 sm:my-10 lg:flex-row lg:items-center lg:justify-between lg:gap-8"
            aria-labelledby="withdraw-heading"
          >
            <div>
              <h2 id="withdraw-heading" className="text-[15px] font-semibold">
                Move your money
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Choose where to withdraw. Review the fee before you confirm.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:shrink-0">
              <WithdrawFunds onDone={onWithdrawalDone} />
              {hostedPortal}
            </div>
          </section>
          <section className="min-w-0" aria-labelledby="activity-heading">
            <h2 id="activity-heading" className="sr-only">
              Recent activity
            </h2>
            <PayoutActivity />
          </section>
        </Wallet>
      </WhopElements>
    </ElementBoundary>
  );
}
