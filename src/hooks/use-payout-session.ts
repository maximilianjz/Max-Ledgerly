"use client";

import { useCallback, useEffect, useState } from "react";
import { apiRequest, ClientApiError } from "@/lib/client-api";
import { type PayoutSession, TOKEN_REFRESH_BUFFER_MS } from "@/lib/contracts";
import { sellerQuery } from "@/lib/seller-contracts";

export function usePayoutSession(enabled: boolean, sellerId?: string) {
  const [session, setSession] = useState<PayoutSession | null>(null);
  const [pending, setPending] = useState(enabled);
  const [error, setError] = useState<ClientApiError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt intentionally restarts the connection after a manual retry.
  useEffect(() => {
    if (!enabled) return;
    setSession(null);
    setError(null);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let expiryTimer: ReturnType<typeof setTimeout>;
    let current: PayoutSession | null = null;
    let inFlight = false;

    async function refresh() {
      if (inFlight || controller.signal.aborted) return;
      inFlight = true;
      clearTimeout(timer);
      setPending(true);
      try {
        const result = await apiRequest<PayoutSession>(
          `/api/payout-token${sellerQuery(sellerId)}`,
          {
            signal: controller.signal,
          },
        );
        if (controller.signal.aborted) return;
        current = result;
        setSession(result);
        setError(null);
        clearTimeout(expiryTimer);
        const remaining = Date.parse(result.expiresAt) - Date.now();
        expiryTimer = setTimeout(
          () => {
            setSession(null);
            setError(
              new ClientApiError("Your payout connection expired. Reconnect to continue.", 408),
            );
          },
          Math.max(0, remaining),
        );
        timer = setTimeout(refresh, Math.max(1000, remaining - TOKEN_REFRESH_BUFFER_MS));
      } catch (caught) {
        if (controller.signal.aborted) return;
        const failure =
          caught instanceof ClientApiError
            ? caught
            : new ClientApiError(
                "Couldn’t connect to Whop. Check your connection and try again.",
                0,
              );
        setError(failure);
        if (failure.status === 401) {
          window.location.assign(
            `/login?next=${encodeURIComponent(`/payouts${sellerQuery(sellerId)}`)}`,
          );
          return;
        }
        if (current && Date.parse(current.expiresAt) > Date.now())
          timer = setTimeout(refresh, 15_000);
      } finally {
        inFlight = false;
        if (!controller.signal.aborted) setPending(false);
      }
    }

    const onVisibility = () => {
      if (
        document.visibilityState === "visible" &&
        (!current || Date.parse(current.expiresAt) - Date.now() < TOKEN_REFRESH_BUFFER_MS)
      ) {
        if (current && Date.parse(current.expiresAt) <= Date.now()) setSession(null);
        void refresh();
      }
    };
    void refresh();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      controller.abort();
      clearTimeout(timer);
      clearTimeout(expiryTimer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, sellerId, attempt]);

  return { session, pending, error, retry };
}
