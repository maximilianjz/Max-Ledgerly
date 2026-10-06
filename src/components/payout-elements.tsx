"use client";

import { loadWhop } from "@whop/elements";
import {
  ActivityElement,
  BalanceElement,
  Balances,
  Wallet,
  WhopElements,
  WithdrawElement,
} from "@whop/elements-react";
import { ArrowDownLeft, ArrowUpRight, History, RefreshCw } from "lucide-react";
import { Component, type ReactNode, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { PayoutSession } from "@/lib/contracts";

const whop = loadWhop();

class ElementBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
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
            Refresh the connection above, or open the hosted portal.
          </AlertDescription>
        </Alert>
      );
    return this.props.children;
  }
}

export default function PayoutElements({
  session,
  onWithdrawalDone,
}: {
  session: PayoutSession;
  onWithdrawalDone: () => void;
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
    <ElementBoundary>
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
              <p>Check your connection or try the hosted portal.</p>
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
          <div className="grid gap-10 lg:grid-cols-[1.3fr_1fr] lg:gap-12">
            <section className="min-w-0" aria-labelledby="balance-heading">
              <h2
                id="balance-heading"
                className="mb-6 flex items-center gap-2 text-[15px] font-semibold"
              >
                <ArrowDownLeft className="size-4 text-muted-foreground" />
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
              className="min-w-0 border-t pt-8 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-12"
              aria-labelledby="withdraw-heading"
            >
              <h2
                id="withdraw-heading"
                className="mb-2 flex items-center gap-2 text-[15px] font-semibold"
              >
                <ArrowUpRight className="size-4 text-muted-foreground" />
                Move your money
              </h2>
              <p className="mb-6 text-sm leading-6 text-muted-foreground">
                Choose a destination and review the fee before you withdraw.
              </p>
              <WithdrawElement
                onDone={onWithdrawalDone}
                onReady={clearError("withdrawal")}
                onError={recordError("withdrawal")}
              />
              {errors.withdrawal && (
                <p role="alert" className="mt-3 text-sm text-destructive">
                  Withdrawals: {errors.withdrawal}
                </p>
              )}
            </section>
          </div>
          <section className="mt-12 min-w-0 border-t pt-8" aria-labelledby="activity-heading">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <h2
                id="activity-heading"
                className="flex items-center gap-2 text-[15px] font-semibold"
              >
                <History className="size-4 text-muted-foreground" />
                Recent activity
              </h2>
              <span className="text-xs text-muted-foreground">Reported by Whop</span>
            </div>
            <ActivityElement onReady={clearError("activity")} onError={recordError("activity")} />
            {errors.activity && (
              <p role="alert" className="mt-3 text-sm text-destructive">
                Activity: {errors.activity}
              </p>
            )}
          </section>
        </Wallet>
      </WhopElements>
    </ElementBoundary>
  );
}
