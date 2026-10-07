"use client";

import type { ActivityDetailElementOverlayHandle } from "@whop/elements/wallet";
import { ActivityElement, useWallet } from "@whop/elements-react";
import { useEffect, useRef, useState } from "react";

export function PayoutActivity() {
  const wallet = useWallet();
  const overlay = useRef<ActivityDetailElementOverlayHandle | null>(null);
  const [error, setError] = useState<{ message: string } | null>(null);

  useEffect(() => {
    if (!wallet) return;
    return () => {
      overlay.current?.destroy();
      overlay.current = null;
    };
  }, [wallet]);

  return (
    <>
      <ActivityElement
        onReady={() => setError(null)}
        onError={setError}
        onActivitySelected={({ activity }) => {
          if (!wallet) return;
          setError(null);
          overlay.current?.destroy();
          const handle = wallet.createOverlay("activityDetail", {
            activity,
            onError: (failure) => {
              handle.close();
              setError(failure);
            },
          });
          overlay.current = handle;
          handle.open();
        }}
      />
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          Activity: {error.message.slice(0, 240)}
        </p>
      )}
    </>
  );
}
