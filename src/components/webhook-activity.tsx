"use client";

import { ArrowLeft, ArrowUpRight, RefreshCw, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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
import { Input } from "@/components/ui/input";
import { sellerPath } from "@/lib/seller-contracts";
import type { ActivityReceipt } from "@/lib/webhook-activity";

function resourceId(receipt: ActivityReceipt) {
  const data = receipt.payload.data as { id?: unknown } | undefined;
  return typeof data?.id === "string" ? data.id : "Not supplied";
}

function receivedAt(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  }).format(new Date(value));
}

export function WebhookActivity({
  receipts,
  issue,
  initialSearch = "",
}: {
  receipts: ActivityReceipt[];
  issue: string | null;
  initialSearch?: string;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [search, setSearch] = useState(initialSearch);
  const query = search.trim().toLowerCase();
  const filtered = receipts.filter((receipt) =>
    [
      receipt.event_id,
      receipt.type,
      receipt.seller,
      receipt.account_id,
      receipt.orderId,
      resourceId(receipt),
    ].some((value) => value?.toLowerCase().includes(query)),
  );

  return (
    <main className="page-enter mx-auto max-w-6xl px-6 py-10 sm:px-10 sm:py-14">
      <Button asChild variant="link" className="mb-6 h-auto p-0 text-muted-foreground">
        <Link href="/accounts">
          <ArrowLeft className="size-4" /> All sellers
        </Link>
      </Button>
      <p className="mb-3 text-sm text-muted-foreground">Local operator view · Read-only</p>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="font-display text-5xl leading-none tracking-[-1px] sm:text-6xl">
            Webhook activity.
          </h1>
          <p className="mt-5 max-w-xl text-sm leading-7 text-muted-foreground">
            Follow an event to its seller and order. These are the original saved receipts;
            replaying a delivery keeps the same record.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => startRefresh(() => router.refresh())}
          disabled={refreshing}
          className="h-11"
        >
          <RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} />
          {refreshing ? "Refreshing…" : "Refresh receipts"}
        </Button>
      </div>
      {issue ? (
        <Alert variant="destructive" className="mt-8">
          <AlertDescription>{issue}</AlertDescription>
        </Alert>
      ) : (
        <>
          <div className="mt-9 flex flex-wrap items-center justify-between gap-4 border-b pb-5">
            <div className="relative w-full sm:max-w-md">
              <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground" />
              <Input
                aria-label="Search webhook receipts"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search seller, order, payment, or event ID"
                className="h-11 pl-10"
              />
            </div>
            <p aria-live="polite" className="text-xs text-muted-foreground">
              {filtered.length} of {receipts.length} saved receipts
            </p>
          </div>
          <ul className="divide-y">
            {filtered.map((receipt) => (
              <li key={receipt.event_id}>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button
                      variant="ghost"
                      className="h-auto w-full justify-start rounded-none px-0 py-6 text-left whitespace-normal hover:bg-transparent hover:text-primary"
                    >
                      <span className="grid w-full gap-3 sm:grid-cols-[1.5fr_1fr_auto] sm:items-center sm:gap-6">
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold">{receipt.type}</span>
                          <span className="mt-2 block break-all font-mono text-xs text-muted-foreground">
                            {resourceId(receipt)}
                          </span>
                        </span>
                        <span className="min-w-0">
                          <span className="block break-words text-sm">
                            {receipt.seller || "Unassigned seller"}
                          </span>
                          <span className="mt-2 block text-xs font-normal text-muted-foreground">
                            {receivedAt(receipt.received_at)}
                          </span>
                        </span>
                        <Badge
                          variant={receipt.disposition === "routed" ? "secondary" : "outline"}
                          className="w-fit"
                        >
                          {receipt.disposition === "routed" ? "Matched" : "Needs review"}
                          <ArrowUpRight className="ml-1 size-3" />
                        </Badge>
                      </span>
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
                    <DialogHeader>
                      <DialogTitle>{receipt.type}</DialogTitle>
                      <DialogDescription>
                        Received {receivedAt(receipt.received_at)}.{" "}
                        {receipt.source === "signed_delivery"
                          ? "Accepted after signature verification."
                          : "Local fixture; not a Whop delivery."}
                      </DialogDescription>
                    </DialogHeader>
                    <dl className="divide-y text-sm">
                      {(
                        [
                          ["Event ID", receipt.event_id],
                          ["Resource ID", resourceId(receipt)],
                          ["Account ID", receipt.account_id || "Not supplied"],
                          ["Order reference", receipt.orderId || "No saved order match"],
                          ["Stored receipts for this event", String(receipt.receiptCount)],
                          ["Routing result", receipt.disposition],
                        ] as const
                      ).map(([label, value]) => (
                        <div key={label} className="grid gap-2 py-3 sm:grid-cols-[180px_1fr]">
                          <dt className="text-muted-foreground">{label}</dt>
                          <dd className="break-all font-mono text-xs leading-5">{value}</dd>
                        </div>
                      ))}
                      <div className="grid gap-2 py-3 sm:grid-cols-[180px_1fr]">
                        <dt className="text-muted-foreground">Matched seller</dt>
                        <dd>
                          {receipt.seller ? (
                            <Link
                              className="text-primary underline underline-offset-4"
                              href={sellerPath(receipt.seller)}
                            >
                              {receipt.seller}
                            </Link>
                          ) : (
                            "Unassigned"
                          )}
                        </dd>
                      </div>
                    </dl>
                    <p className="text-xs leading-5 text-muted-foreground">
                      {receipt.disposition === "quarantined"
                        ? "Stored for review because ownership was not resolved when first received. It was not assigned to a seller."
                        : "The saved receipt identifies the seller above."}{" "}
                      Replay attempts are not separate receipts; check the delivery response in Whop
                      for duplicate: true.
                    </p>
                    <div className="min-w-0">
                      <h3 className="mb-3 text-sm font-semibold">
                        Saved payload · Selected fields
                      </h3>
                      <pre className="max-h-64 overflow-auto rounded-md bg-muted p-4 text-xs leading-6">
                        {JSON.stringify(receipt.payload, null, 2)}
                      </pre>
                    </div>
                  </DialogContent>
                </Dialog>
              </li>
            ))}
          </ul>
          {!filtered.length && (
            <p className="py-12 text-sm leading-6 text-muted-foreground">
              {receipts.length
                ? "No receipts match this search. Clear it to see all saved events."
                : "No webhook receipts have been saved for this platform yet."}
            </p>
          )}
        </>
      )}
    </main>
  );
}
