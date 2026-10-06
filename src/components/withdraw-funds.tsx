"use client";

import type { WithdrawElementOverlayHandle } from "@whop/elements/wallet";
import { useWallet } from "@whop/elements-react";
import { ArrowRight } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export function WithdrawFunds({ onDone }: { onDone: () => void }) {
  const wallet = useWallet();
  const overlay = useRef<WithdrawElementOverlayHandle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const complete = useEffectEvent(onDone);

  useEffect(() => {
    if (!wallet) return;
    // Inline frames shrink to their form and clip nested Plaid dialogs. Whop's
    // overlay gives the entire withdrawal flow a viewport-sized frame instead.
    const handle = wallet.createOverlay("withdraw", {
      onDone: () => {
        handle.close();
        complete();
      },
      onError: (failure) => setError(failure.message.slice(0, 240)),
    });
    overlay.current = handle;
    return () => {
      handle.destroy();
      overlay.current = null;
    };
  }, [wallet]);

  return (
    <div className="min-w-0">
      <Button
        className="h-11 w-full justify-between gap-4"
        disabled={!wallet}
        aria-haspopup="dialog"
        aria-describedby="embedded-withdrawal-description"
        onClick={() => {
          setError(null);
          overlay.current?.open();
        }}
      >
        Withdraw in Ledgerly <ArrowRight className="size-4" />
      </Button>
      <p id="embedded-withdrawal-description" className="mt-2 text-xs text-muted-foreground">
        Opens here, inside Ledgerly.
      </p>
      {error && (
        <p role="alert" className="mt-3 max-w-xs text-sm text-destructive">
          Withdrawals: {error}
        </p>
      )}
    </div>
  );
}
