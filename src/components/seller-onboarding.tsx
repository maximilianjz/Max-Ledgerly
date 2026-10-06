"use client";

import { ArrowLeft, ArrowRight, Check, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CountrySelector } from "@/components/country-selector";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/client-api";
import type { Seller } from "@/lib/integration/store";
import { EMAIL_PATTERN, EXTERNAL_ID_PATTERN, sellerPath } from "@/lib/seller-contracts";
import { cn } from "@/lib/utils";

const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;
const steps = ["Seller ID", "Email", "Country"];
const headings = [
  "Start with a seller ID.",
  "What’s their email?",
  "Where is their business based?",
];

export function SellerOnboarding({ issue }: { issue: string | null }) {
  const router = useRouter();
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);
  const form = useRef<HTMLFormElement>(null);
  const [step, setStep] = useState(0);
  const [details, setDetails] = useState({ externalId: "", email: "", country: "" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabled = !ready || pending || Boolean(issue);

  useEffect(() => {
    if (ready && !issue) {
      form.current?.querySelector<HTMLElement>(step === 2 ? "[role=combobox]" : "input")?.focus();
    }
  }, [step, ready, issue]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || !event.currentTarget.reportValidity()) return;
    setError(null);
    if (step < steps.length - 1) {
      setStep(step + 1);
      return;
    }
    if (!details.country) {
      setError("Choose the seller’s country to continue.");
      return;
    }
    setPending(true);
    try {
      const { seller } = await apiRequest<{ seller: Seller }>("/api/sellers", {
        body: details,
      });
      router.push(sellerPath(seller.externalId));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Couldn’t create this seller. Try again with the same details.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <main className="page-enter mx-auto max-w-2xl px-6 py-10 sm:px-10 sm:py-14">
      <p className="mb-3 text-sm text-muted-foreground">Seller onboarding</p>
      <h1 className="font-display text-5xl leading-none tracking-[-1px] sm:text-6xl">
        Connect a seller.
      </h1>
      <p className="mt-5 max-w-xl text-sm leading-7 text-muted-foreground">
        Three quick details, then verification with Whop.
      </p>
      <section className="mt-9" aria-labelledby="seller-details-heading">
        <ol aria-label="Seller setup progress" className="grid grid-cols-3 gap-4">
          {steps.map((label, index) => (
            <li key={label} aria-current={index === step ? "step" : undefined}>
              <div
                className={cn(
                  "mb-3 flex items-center gap-2 text-xs",
                  index <= step ? "font-semibold text-primary" : "text-muted-foreground",
                )}
              >
                <span aria-hidden="true" className="flex size-4 items-center justify-center">
                  {index < step ? <Check className="size-3.5" /> : index + 1}
                </span>
                {label}
              </div>
              <div
                aria-hidden="true"
                className={cn(
                  "h-0.5 rounded-full transition-colors",
                  index <= step ? "bg-primary" : "bg-border",
                )}
              />
            </li>
          ))}
        </ol>
        <p role="status" className="sr-only">
          Step {step + 1} of {steps.length}: {steps[step]}
        </p>
        <div className="mt-9">
          {issue && (
            <Alert className="mb-6">
              <AlertDescription>{issue}</AlertDescription>
            </Alert>
          )}
          <form ref={form} method="post" action="/api/sellers" onSubmit={submit}>
            <div key={step} className="page-enter min-h-52 space-y-6">
              <h2 id="seller-details-heading" className="font-display text-3xl sm:text-4xl">
                {headings[step]}
              </h2>
              {step === 0 && (
                <div className="space-y-2.5">
                  <Label htmlFor="seller-id">Seller ID in Ledgerly</Label>
                  <Input
                    id="seller-id"
                    name="externalId"
                    value={details.externalId}
                    onChange={(event) => setDetails({ ...details, externalId: event.target.value })}
                    placeholder="seller-123"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    maxLength={120}
                    pattern={EXTERNAL_ID_PATTERN}
                    required
                    disabled={disabled}
                    aria-describedby="seller-id-help"
                    className="h-12 bg-card"
                  />
                  <p id="seller-id-help" className="text-xs leading-5 text-muted-foreground">
                    Use the same ID when returning. We’ll find the existing account.
                  </p>
                </div>
              )}
              {step === 1 && (
                <div className="space-y-2.5">
                  <Label htmlFor="seller-email">Seller email</Label>
                  <Input
                    id="seller-email"
                    name="email"
                    type="email"
                    value={details.email}
                    onChange={(event) => setDetails({ ...details, email: event.target.value })}
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="seller@example.com"
                    pattern={EMAIL_PATTERN}
                    maxLength={254}
                    required
                    disabled={disabled}
                    aria-describedby="seller-email-help"
                    className="h-12 bg-card"
                  />
                  <p id="seller-email-help" className="text-xs leading-5 text-muted-foreground">
                    Use the email associated with this seller.
                  </p>
                </div>
              )}
              {step === 2 && (
                <div className="space-y-2.5">
                  <Label htmlFor="seller-country">Country</Label>
                  <CountrySelector
                    value={details.country}
                    onChange={(country) => setDetails({ ...details, country })}
                    disabled={disabled}
                  />
                  <p id="seller-country-help" className="text-xs leading-5 text-muted-foreground">
                    Select the seller’s business location. Whop confirms eligibility during account
                    setup.
                  </p>
                </div>
              )}
            </div>
            {error && (
              <p role="alert" className="mb-5 text-sm leading-6 text-destructive">
                {error}
              </p>
            )}
            <div className="flex gap-3">
              {step > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={disabled}
                  className="h-12 px-4"
                  onClick={() => {
                    setError(null);
                    setStep(step - 1);
                  }}
                >
                  <ArrowLeft className="size-4" />
                  Back
                </Button>
              )}
              <Button
                type="submit"
                disabled={disabled || (step === 2 && !details.country)}
                className="h-12 flex-1 justify-between px-5"
              >
                {pending ? "Connecting…" : step === 2 ? "Connect seller" : "Continue"}
                {pending ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <ArrowRight className="size-4" />
                )}
              </Button>
            </div>
            <p className="mt-4 text-center text-xs leading-5 text-muted-foreground">
              {step === 2 ? (
                "Verification happens next on Whop."
              ) : (
                <span className="hidden sm:inline">You can also press Enter to continue.</span>
              )}
            </p>
          </form>
        </div>
      </section>
    </main>
  );
}
