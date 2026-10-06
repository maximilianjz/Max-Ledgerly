"use client";

import { Download, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { downloadEvidence } from "@/lib/client-api";
import type { PayoutSession } from "@/lib/contracts";

export function SessionDetails({ session }: { session: PayoutSession | null }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={!session}>
          <ShieldCheck className="size-4" />
          Access details
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Temporary seller access</DialogTitle>
          <DialogDescription>
            This connection is limited to the US seller and refreshes automatically before its
            10-minute expiry.
          </DialogDescription>
        </DialogHeader>
        {session && (
          <>
            <dl className="space-y-4 py-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Connected account</dt>
                <dd className="mt-1 break-all font-mono text-xs">{session.accountId}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Expires</dt>
                <dd className="mt-1">{new Date(session.expiresAt).toLocaleString()}</dd>
              </div>
            </dl>
            <div>
              <p className="mb-3 text-sm font-medium">Granted permissions</p>
              <ul className="space-y-2">
                {session.scopedActions.map((scope) => (
                  <li key={scope} className="break-all font-mono text-xs text-muted-foreground">
                    {scope}
                  </li>
                ))}
              </ul>
            </div>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => {
                const { token: _token, ...evidence } = session;
                downloadEvidence("ledgerly-token-evidence.json", {
                  ...evidence,
                  token: "[redacted]",
                });
              }}
            >
              <Download className="size-4" />
              Download redacted evidence
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
