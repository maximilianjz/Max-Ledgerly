"use client";

import { ArrowLeft, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type SellerTab, sellerPath } from "@/lib/seller-contracts";

export function SellerWorkspace({
  externalId,
  tab,
  showActivity,
  children,
}: {
  externalId: string;
  tab: SellerTab;
  showActivity: boolean;
  children?: ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <main className="page-enter mx-auto max-w-[1320px] px-6 py-8 sm:px-10 sm:py-10">
      <div className="mb-5">
        <Button asChild variant="link" className="h-auto p-0 text-muted-foreground">
          <Link href="/accounts">
            <ArrowLeft className="size-4" /> All sellers
          </Link>
        </Button>
      </div>
      <h1 className="break-words font-display text-4xl leading-tight tracking-[-0.5px] sm:text-5xl">
        {externalId}
      </h1>
      <Tabs
        value={tab}
        activationMode="manual"
        onValueChange={(value) =>
          startTransition(() =>
            router.push(sellerPath(externalId, value === "payouts" ? "payouts" : "account"), {
              scroll: false,
            }),
          )
        }
        className="mt-5 gap-0"
      >
        <div className="flex items-center gap-5 border-b">
          <TabsList
            variant="line"
            aria-label="Seller workspace"
            className="gap-6 p-0 group-data-[orientation=horizontal]/tabs:h-12"
          >
            <TabsTrigger value="account" className="px-1 text-sm">
              Account
            </TabsTrigger>
            <TabsTrigger value="payouts" className="px-1 text-sm">
              Payouts
            </TabsTrigger>
          </TabsList>
          <span role="status" className="text-xs text-muted-foreground">
            {pending ? "Loading…" : ""}
          </span>
        </div>
        <TabsContent value={tab} className="mt-0 pt-6" aria-busy={pending}>
          {children}
        </TabsContent>
      </Tabs>
      {showActivity && (
        <div className="mt-8">
          <Button asChild variant="link" className="h-auto p-0 text-xs text-muted-foreground">
            <Link href={`/activity?search=${encodeURIComponent(externalId)}`}>
              Webhook activity <ArrowUpRight className="size-3.5" />
            </Link>
          </Button>
        </div>
      )}
    </main>
  );
}
