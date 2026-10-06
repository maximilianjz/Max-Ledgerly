import { ArrowUpRight, LockKeyhole } from "lucide-react";
import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { LoginForm } from "@/components/login-form";
import { hasSession } from "@/lib/auth";
import { getAuthConfig } from "@/lib/config";
import { workspaceReturnPath } from "@/lib/seller-contracts";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = workspaceReturnPath((await searchParams).next);
  let configured = true;
  try {
    getAuthConfig();
  } catch {
    configured = false;
  }
  if (configured && (await hasSession())) redirect(next);

  return (
    <main className="grid min-h-svh lg:grid-cols-[0.95fr_1.05fr]">
      <aside className="relative hidden min-h-svh flex-col overflow-hidden bg-primary px-12 py-10 text-white lg:flex xl:px-16">
        <Brand light />
        <div className="page-enter relative z-10 my-auto max-w-lg py-20">
          <p className="mb-7 flex items-center gap-2 text-sm text-[#d5dfcc]">
            <span className="size-1.5 rounded-full bg-[#d8e9a5]" /> A little more control. A lot
            more clarity.
          </p>
          <p className="font-display text-[clamp(4rem,6vw,6.4rem)] leading-[0.99] tracking-[-2px]">
            Your money.
            <br />
            <span className="text-[#d8e9a5] italic">Your next move.</span>
          </p>
          <p className="mt-8 max-w-[20rem] text-[15px] leading-7 text-[#c4d4c9]">
            One place to see what you’ve earned, follow your activity, and choose how you get paid.
          </p>
          <div
            aria-hidden="true"
            className="mt-14 flex w-64 items-end gap-3 border-b border-white/20 pb-4"
          >
            {[40, 65, 55, 95, 83, 125, 153].map((height, index) => (
              <div
                key={height}
                className={
                  index === 6 ? "w-6 rounded-t-sm bg-[#d8e9a5]" : "w-6 rounded-t-sm bg-white/15"
                }
                style={{ height }}
              />
            ))}
            <ArrowUpRight className="mb-28 ml-2 size-6 text-[#d8e9a5]" />
          </div>
        </div>
        <p className="text-xs text-[#bed0c4]">Ledgerly seller workspace · Powered by Whop</p>
      </aside>
      <section className="flex min-h-svh flex-col px-6 py-8 sm:px-12 lg:px-16">
        <div className="lg:hidden">
          <Brand />
        </div>
        <div className="page-enter mx-auto my-auto w-full max-w-[380px] py-16">
          <span className="mb-8 inline-flex size-11 items-center justify-center rounded-full bg-secondary">
            <LockKeyhole className="size-5 text-primary" strokeWidth={1.6} />
          </span>
          <p className="mb-3 text-sm text-muted-foreground">Seller workspace</p>
          <h1 className="font-display text-5xl leading-[1.1] tracking-[-1px]">
            Welcome to Ledgerly.
          </h1>
          <p className="mt-4 mb-9 text-sm leading-6 text-muted-foreground">
            Sign in to connect sellers, check verification, and manage payouts.
          </p>
          <LoginForm configured={configured} next={next} />
          <p className="mt-6 text-xs leading-5 text-muted-foreground">
            Private access for the Ledgerly assessment. Use the password provided by the workspace
            owner.
          </p>
        </div>
        <p className="text-center text-xs text-muted-foreground">
          Your account access stays private.
        </p>
      </section>
    </main>
  );
}
