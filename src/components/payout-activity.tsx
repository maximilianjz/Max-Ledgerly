"use client";

import type { LedgerActivity } from "@whop/elements/wallet";
import { ActivityElement } from "@whop/elements-react";
import { ArrowDownLeft, ArrowUpRight, Check, Copy } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function label(value: string) {
  const text = value.replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function money(amount: string | null, currency = "usd", signed = false, decimals?: number) {
  if (!amount?.trim() || !Number.isFinite(Number(amount))) return "Unavailable";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    signDisplay: signed ? "exceptZero" : "auto",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number(amount));
}

function counterparty(activity: LedgerActivity) {
  const resource = activity.resource;
  return (
    activity.user_name ||
    activity.payment?.user?.name ||
    (resource && "name" in resource && resource.name) ||
    (resource && "title" in resource && resource.title) ||
    (resource && "nickname" in resource && resource.nickname) ||
    (resource && "institution_name" in resource && resource.institution_name) ||
    (resource && "merchant_name" in resource && resource.merchant_name) ||
    activity.source?.payout_destination?.payer_name ||
    activity.source?.payer_name ||
    "Not provided"
  );
}

function ActivityDetails({
  activity,
  onClose,
  onReturnFocus,
}: {
  activity: LedgerActivity;
  onClose: () => void;
  onReturnFocus: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const outgoing = activity.amount.startsWith("-");
  const title =
    activity.line_type === "payment_gross"
      ? "Payment"
      : activity.line_type === "payment_refund"
        ? "Refund"
        : label(activity.line_type);
  const currency = activity.currency.code.toUpperCase();
  const balance = `${currency} balance`;
  const party = counterparty(activity);
  const record = activity.source ?? { object: "activity", id: activity.id };
  const referenceLabel = `${label(record.object)} ID`;
  const originalPayment = activity.source?.payment_amount ?? activity.payment?.amount;
  const rows: [string, string | null | undefined | false][] = [
    ["From", outgoing ? balance : party],
    ["To", outgoing ? party : balance],
    ["Status", activity.source?.status && label(activity.source.status)],
    ["Product", activity.product_name || activity.payment?.product?.name],
    [
      "Original payment",
      title === "Refund" &&
        originalPayment &&
        money(
          originalPayment.amount,
          originalPayment.currency,
          false,
          originalPayment.display_decimals,
        ),
    ],
  ];
  const Direction = outgoing ? ArrowUpRight : ArrowDownLeft;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        ref={dialog}
        className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto rounded-2xl bg-card p-0 sm:max-w-md [&>[data-slot=dialog-close]]:p-2"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          dialog.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onReturnFocus();
        }}
      >
        <DialogHeader className="gap-3 px-6 pt-7 pb-6 text-left sm:px-8 sm:pt-8">
          <DialogTitle className="flex items-center gap-2 pr-5 text-sm font-medium text-muted-foreground">
            <Direction className="size-4" aria-hidden="true" />
            {title}
          </DialogTitle>
          <p
            className={`break-words font-display text-4xl leading-none tracking-tight sm:text-5xl ${outgoing ? "text-foreground" : "text-primary"}`}
          >
            {money(activity.usd_amount, "usd", true)}
          </p>
          <DialogDescription className="text-xs">
            {new Date(activity.posted_at).toLocaleString("en-US", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
            {currency !== "USD" && ` · USD value of ${currency} activity`}
          </DialogDescription>
        </DialogHeader>
        <dl className="mx-6 divide-y border-y text-sm sm:mx-8">
          {rows.map(
            ([name, value]) =>
              value && (
                <div key={name} className="flex items-start justify-between gap-6 py-3.5">
                  <dt className="shrink-0 text-muted-foreground">{name}</dt>
                  <dd className="min-w-0 break-words text-right font-medium">{value}</dd>
                </div>
              ),
          )}
        </dl>
        <div className="px-6 py-5 sm:px-8 sm:py-6">
          <p className="text-xs text-muted-foreground">{referenceLabel}</p>
          <div className="mt-1 flex items-center justify-between gap-3">
            <code className="min-w-0 select-all break-all text-xs">{record.id}</code>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Copy ${record.object.replaceAll("_", " ")} ID`}
              onClick={async () => {
                setCopied(false);
                try {
                  await navigator.clipboard.writeText(record.id);
                  setCopied(true);
                  setCopyError(false);
                } catch {
                  setCopyError(true);
                }
              }}
            >
              {copied ? (
                <Check className="size-3.5 text-primary" />
              ) : (
                <Copy className="size-3.5 text-muted-foreground" />
              )}
            </Button>
          </div>
          <span role="status" className="sr-only">
            {copied ? "ID copied" : ""}
          </span>
          {copyError && (
            <p role="alert" className="mt-2 text-xs text-destructive">
              Couldn’t copy. Select the ID to copy it.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PayoutActivity() {
  const [selected, setSelected] = useState<LedgerActivity | null>(null);
  const [error, setError] = useState<{ message: string } | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  return (
    <>
      <ActivityElement
        onReady={() => setError(null)}
        onError={setError}
        onActivitySelected={({ activity }) => {
          returnFocus.current = document.activeElement as HTMLElement | null;
          setError(null);
          setSelected(activity);
        }}
      />
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          Activity: {error.message.slice(0, 240)}
        </p>
      )}
      {selected && (
        <ActivityDetails
          key={selected.id}
          activity={selected}
          onClose={() => setSelected(null)}
          onReturnFocus={() => returnFocus.current?.isConnected && returnFocus.current.focus()}
        />
      )}
    </>
  );
}
