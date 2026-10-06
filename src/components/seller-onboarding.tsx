"use client";

import { ArrowRight, ArrowUpRight, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState, useSyncExternalStore } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/client-api";
import type { Seller } from "@/lib/integration/store";
import { COUNTRIES, sellerPath } from "@/lib/seller-contracts";

const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

export function SellerOnboarding({ sellers, issue }: { sellers: Seller[]; issue: string | null }) {
  const router = useRouter();
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);
  const [country, setCountry] = useState("US");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const values = new FormData(event.currentTarget);
    try {
      const { seller } = await apiRequest<{ seller: Seller }>("/api/sellers", {
        body: {
          externalId: values.get("externalId"),
          email: values.get("email"),
          country,
        },
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
    <main className="page-enter mx-auto max-w-5xl px-6 py-10 sm:px-10 sm:py-14">
      <p className="mb-3 text-sm text-muted-foreground">Seller onboarding</p>
      <h1 className="font-display text-5xl leading-none tracking-[-1px] sm:text-6xl">
        Start selling with Ledgerly.
      </h1>
      <p className="mt-5 max-w-xl text-sm leading-7 text-muted-foreground">
        Connect a seller, complete verification with Whop, and give them a place to manage their
        earnings.
      </p>
      <div className="mt-10 grid gap-12 border-t pt-9 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
        <section aria-labelledby="seller-details-heading">
          <h2 id="seller-details-heading" className="mb-7 text-lg font-semibold">
            Seller details
          </h2>
          {issue && (
            <Alert className="mb-6">
              <AlertDescription>{issue}</AlertDescription>
            </Alert>
          )}
          <form method="post" action="/api/sellers" onSubmit={submit} className="space-y-6">
            <div className="space-y-2.5">
              <Label htmlFor="seller-id">Seller ID in Ledgerly</Label>
              <Input
                id="seller-id"
                name="externalId"
                placeholder="seller-123"
                autoComplete="off"
                maxLength={120}
                pattern="[A-Za-z0-9][A-Za-z0-9_.:\-]{0,119}"
                required
                disabled={!ready || pending || Boolean(issue)}
                aria-describedby="seller-id-help"
                className="h-12 bg-card"
              />
              <p id="seller-id-help" className="text-xs leading-5 text-muted-foreground">
                Use the same ID when returning. We’ll find the existing account.
              </p>
            </div>
            <div className="space-y-2.5">
              <Label htmlFor="seller-email">Seller email</Label>
              <Input
                id="seller-email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="seller@example.com"
                maxLength={254}
                required
                disabled={!ready || pending || Boolean(issue)}
                className="h-12 bg-card"
              />
            </div>
            <fieldset disabled={!ready || pending || Boolean(issue)}>
              <legend className="mb-3 text-sm font-medium">Country</legend>
              <div className="flex flex-wrap gap-2">
                {Object.entries(COUNTRIES).map(([code, name]) => (
                  <Button
                    key={code}
                    type="button"
                    variant={country === code ? "default" : "outline"}
                    aria-pressed={country === code}
                    onClick={() => setCountry(code)}
                    className="h-10 flex-1"
                  >
                    {name}
                  </Button>
                ))}
              </div>
            </fieldset>
            {error && (
              <p role="alert" className="text-sm leading-6 text-destructive">
                {error}
              </p>
            )}
            <Button
              type="submit"
              disabled={!ready || pending || Boolean(issue)}
              className="h-12 w-full justify-between px-5"
            >
              {pending ? "Finding or creating your account…" : "Create or find seller"}
              {pending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <ArrowRight className="size-4" />
              )}
            </Button>
            <p className="text-xs leading-5 text-muted-foreground">
              This connects a real seller account. Verification happens next on Whop.
            </p>
          </form>
        </section>
        <aside className="lg:border-l lg:pl-10" aria-labelledby="next-heading">
          <h2 id="next-heading" className="mb-6 text-lg font-semibold">
            A few steps to get started
          </h2>
          <ol className="space-y-7">
            {[
              ["01", "Connect the account", "Ledgerly links this seller ID to one Whop account."],
              ["02", "Verify with Whop", "Continue to Whop to provide the information they need."],
              [
                "03",
                "Manage earnings",
                "Return here to check verification and open seller payouts.",
              ],
            ].map(([number, title, description]) => (
              <li key={number} className="flex gap-4">
                <span className="pt-0.5 font-mono text-xs text-muted-foreground">{number}</span>
                <div>
                  <p className="text-sm font-semibold">{title}</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
                </div>
              </li>
            ))}
          </ol>
        </aside>
      </div>
      <section className="mt-12 border-t pt-8" aria-labelledby="saved-sellers-heading">
        <h2 id="saved-sellers-heading" className="text-lg font-semibold">
          Connected here
        </h2>
        {sellers.length ? (
          <ul className="mt-4 divide-y">
            {sellers.map((seller) => (
              <li key={seller.externalId}>
                <Link
                  href={sellerPath(seller.externalId)}
                  className="flex items-center justify-between gap-4 py-5 hover:text-primary"
                >
                  <div className="min-w-0">
                    <p className="break-all text-sm font-semibold">{seller.externalId}</p>
                    <p className="mt-1 break-all text-xs text-muted-foreground">
                      {seller.email} · {COUNTRIES[seller.country] || seller.country}
                    </p>
                  </div>
                  <ArrowUpRight className="size-4 shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Sellers connected through this flow appear here so you can pick up where you left off.
          </p>
        )}
      </section>
    </main>
  );
}
