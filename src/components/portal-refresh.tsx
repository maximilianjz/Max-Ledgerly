"use client";

import { ArrowLeft, LoaderCircle, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/client-api";
import { sellerPath, sellerQuery } from "@/lib/seller-contracts";

export function PortalRefresh({ sellerId }: { sellerId?: string }) {
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt intentionally creates a fresh link after a manual retry.
  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    apiRequest<{ url: string }>(`/api/payout-portal${sellerQuery(sellerId)}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) window.location.replace(result.url);
      })
      .catch((caught) => {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : "Couldn’t refresh the portal.");
      });
    return () => controller.abort();
  }, [attempt, sellerId]);
  return (
    <div className="mx-auto max-w-md px-6 py-24 text-center">
      {!error && <LoaderCircle className="mx-auto mb-6 size-6 animate-spin text-primary" />}
      <h1 className="font-display text-4xl">
        {error ? "Let’s reconnect." : "Reopening your portal…"}
      </h1>
      <p className="mt-4 text-sm leading-6 text-muted-foreground" role={error ? "alert" : "status"}>
        {error || "We’re creating a fresh, temporary link to your Whop payouts portal."}
      </p>
      <div className="mt-7 flex justify-center gap-3">
        {error && (
          <Button onClick={() => setAttempt((value) => value + 1)}>
            <RefreshCw className="size-4" />
            Try again
          </Button>
        )}
        <Button asChild variant="outline">
          <Link href={sellerId ? sellerPath(sellerId, "payouts") : "/accounts"}>
            <ArrowLeft className="size-4" />
            Back to payouts
          </Link>
        </Button>
      </div>
    </div>
  );
}
