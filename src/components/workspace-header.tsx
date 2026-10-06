"use client";

import { LogOut } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { apiRequest, ClientApiError } from "@/lib/client-api";
import { sellerQuery } from "@/lib/seller-contracts";

export function WorkspaceHeader({ sellerId }: { sellerId?: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  async function logout() {
    setPending(true);
    setError(false);
    try {
      await apiRequest("/api/auth/logout");
      window.location.replace("/login");
    } catch (caught) {
      if (caught instanceof ClientApiError && caught.status === 401)
        window.location.replace("/login");
      else {
        setError(true);
        setPending(false);
      }
    }
  }
  return (
    <header className="border-b border-border/80">
      <div className="mx-auto flex h-20 max-w-[1320px] items-center justify-between gap-4 px-6 sm:px-10">
        <div className="flex items-center gap-2 sm:gap-8">
          <Brand />
          <nav aria-label="Workspace" className="flex items-center gap-1">
            <Button asChild variant="ghost" size="sm">
              <Link href="/sellers">Sellers</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/payouts${sellerQuery(sellerId)}`}>Payouts</Link>
            </Button>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {error && (
            <span role="alert" className="text-xs text-destructive">
              Couldn’t sign out. Try again.
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={logout}
            aria-label="Sign out"
            disabled={pending}
            className="text-muted-foreground"
          >
            <LogOut className="size-4" />
            <span className="hidden sm:inline">{pending ? "Signing out…" : "Sign out"}</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
