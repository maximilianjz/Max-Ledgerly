import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { WelcomeLayout } from "@/components/welcome-layout";

export default function HomePage() {
  return (
    <WelcomeLayout>
      <p className="mb-3 text-sm text-muted-foreground">Seller workspace</p>
      <h1 className="font-display text-5xl leading-[1.1] tracking-[-1px]">Welcome to Ledgerly.</h1>
      <p className="mt-4 text-sm leading-6 text-muted-foreground">
        Manage your payouts, or take the first step toward getting paid.
      </p>
      <div className="mt-10 space-y-7">
        <div>
          <Button asChild className="h-12 w-full justify-between px-5">
            <Link href="/accounts">
              Manage your payouts <ArrowRight className="size-4" />
            </Link>
          </Button>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            Already connected? Open your balance, activity, and payouts.
          </p>
        </div>
        <div>
          <Button asChild variant="outline" className="h-12 w-full justify-between px-5">
            <Link href="/sellers">
              Create a new seller account <ArrowRight className="size-4" />
            </Link>
          </Button>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            Add your details, then complete verification with Whop.
          </p>
        </div>
      </div>
    </WelcomeLayout>
  );
}
