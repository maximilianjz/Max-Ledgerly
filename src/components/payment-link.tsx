"use client";

import { ArrowUpRight, Check, Copy, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, ClientApiError } from "@/lib/client-api";
import { decimal, priceWithFee } from "@/lib/integration/money";
import {
  EXTERNAL_ID,
  type PaymentLinkInput,
  type PaymentLink as Result,
  sellerPath,
} from "@/lib/seller-contracts";

const empty = { orderId: "", title: "", amount: "25.00" };

export function PaymentLinkForm({
  externalId,
  issue = null,
}: {
  externalId: string;
  issue?: string | null;
}) {
  const [draft, setDraft] = useState<PaymentLinkInput>(empty);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const submitting = useRef(false);
  const storageKey = `ledgerly:payment-link:${externalId}`;

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const input = JSON.parse(saved);
        if (
          typeof input.orderId !== "string" ||
          !EXTERNAL_ID.test(input.orderId) ||
          typeof input.title !== "string" ||
          typeof input.amount !== "string"
        )
          throw new Error();
        setDraft({ orderId: input.orderId, title: input.title, amount: input.amount });
      }
      setReady(true);
    } catch {
      setError(
        "This tab could not read its saved payment-link request. Check browser storage before continuing.",
      );
    }
  }, [storageKey]);

  let price: ReturnType<typeof priceWithFee> | null = null;
  let priceError = "";
  try {
    price = priceWithFee(draft.amount, "usd");
  } catch (caught) {
    priceError = caught instanceof Error ? caught.message : "Enter a valid USD price.";
  }
  const amounts = result?.order ?? price;
  const locked = !ready || busy || Boolean(draft.orderId);

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || issue || submitting.current || result || !price || !draft.title.trim()) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    const input = {
      ...draft,
      title: draft.title.trim(),
      orderId: draft.orderId || crypto.randomUUID(),
    };
    try {
      // Save the request before sending it. A retry or tab reload keeps the same order ID.
      sessionStorage.setItem(storageKey, JSON.stringify(input));
      setDraft(input);
      setResult(
        await apiRequest<Result>(`/api${sellerPath(externalId)}/checkout`, { body: input }),
      );
    } catch (caught) {
      if (caught instanceof ClientApiError && caught.status === 400) {
        sessionStorage.removeItem(storageKey);
        setDraft({ ...input, orderId: "" });
      }
      setError(
        caught instanceof Error
          ? caught.message
          : "Couldn’t create the payment link. Retry this request.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  function startAnother() {
    try {
      sessionStorage.removeItem(storageKey);
      setDraft(empty);
      setResult(null);
      setError(null);
      setCopied(false);
    } catch {
      setError("Browser storage is unavailable. Keep this link before starting another request.");
    }
  }

  return (
    <section
      id="payment-link"
      className="mt-8 border-t pt-7"
      aria-labelledby="payment-link-heading"
    >
      <div className="grid gap-8 md:grid-cols-[1.2fr_1fr] md:gap-14">
        <div>
          <h2 id="payment-link-heading" className="font-display text-3xl tracking-[-0.5px]">
            {result ? "Your payment link is ready." : "Payment link"}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {result
              ? "Share it with your customer to complete checkout on Whop."
              : "Create a checkout to share with your customer."}
          </p>
          {!result ? (
            <form method="post" onSubmit={submit} className="mt-5 space-y-4">
              <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
                <div className="space-y-2">
                  <Label htmlFor="checkout-title">Product name</Label>
                  <Input
                    id="checkout-title"
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    placeholder="Acme Preset Pack"
                    maxLength={120}
                    required
                    disabled={locked}
                    className="h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="checkout-amount">Price (USD)</Label>
                  <Input
                    id="checkout-amount"
                    value={draft.amount}
                    onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                    inputMode="decimal"
                    maxLength={30}
                    required
                    disabled={locked}
                    aria-invalid={!price}
                    aria-describedby={!price ? "checkout-price-error" : undefined}
                    className="h-11"
                  />
                  {!price && (
                    <p id="checkout-price-error" className="text-xs text-destructive">
                      {priceError}
                    </p>
                  )}
                </div>
              </div>
              <Button
                type="submit"
                disabled={!ready || Boolean(issue) || busy || !price || !draft.title.trim()}
                className="h-11"
              >
                {busy && <LoaderCircle className="size-4 animate-spin" />}
                {busy
                  ? "Creating link…"
                  : draft.orderId
                    ? "Retry payment link"
                    : "Create payment link"}
              </Button>
              {draft.orderId && !busy && (
                <p className="text-xs leading-5 text-muted-foreground">
                  This request is saved in your tab. Retrying retrieves the same checkout.
                </p>
              )}
            </form>
          ) : (
            <div className="mt-6 space-y-4">
              <Label htmlFor="checkout-url">Payment link</Label>
              <div className="flex gap-2">
                <Input
                  id="checkout-url"
                  readOnly
                  value={result.checkout.purchaseUrl}
                  onFocus={(e) => e.target.select()}
                  className="h-11"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="size-11 shrink-0"
                  aria-label="Copy payment link"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(result.checkout.purchaseUrl);
                      setCopied(true);
                    } catch {
                      setError("Select the payment link above to copy it manually.");
                    }
                  }}
                >
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                </Button>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button asChild className="h-11">
                  <a href={result.checkout.purchaseUrl} target="_blank" rel="noopener noreferrer">
                    Open checkout <ArrowUpRight className="size-4" />
                  </a>
                </Button>
                <Button variant="ghost" onClick={startAnother} className="h-11">
                  Create another link
                </Button>
              </div>
              <p role="status" className="text-xs leading-5 text-muted-foreground">
                {copied ? "Link copied. " : ""}Creating a link does not charge the customer.
              </p>
            </div>
          )}
        </div>
        <div className="md:pt-2">
          <p className="text-sm font-medium">{result ? "Confirmed checkout" : "Price breakdown"}</p>
          <dl aria-live="polite" aria-label="Price breakdown" className="mt-4 space-y-3">
            {(
              [
                ["Customer pays", amounts?.amountMinor],
                ["Ledgerly fee · 8%", amounts?.feeMinor],
                ["Seller allocation", amounts?.sellerShareMinor],
              ] as const
            ).map(([title, amount]) => (
              <div
                key={title}
                className={`flex items-baseline justify-between gap-5 ${title === "Seller allocation" ? "border-t pt-3" : ""}`}
              >
                <dt className="text-sm text-muted-foreground">{title}</dt>
                <dd
                  className={`font-medium tabular-nums ${title === "Seller allocation" ? "text-2xl" : "text-base"}`}
                >
                  {amount === undefined ? "—" : `$${decimal(amount)}`}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            Before processing fees and settlement.
          </p>
          {result && (
            <dl className="mt-6 space-y-3 text-xs">
              <div>
                <dt className="text-muted-foreground">Order reference</dt>
                <dd className="mt-1 break-all font-mono">{result.order.orderId}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Whop checkout</dt>
                <dd className="mt-1 break-all font-mono">{result.checkout.id}</dd>
              </div>
            </dl>
          )}
        </div>
      </div>
      {error && (
        <Alert variant="destructive" className="mt-6">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </section>
  );
}
