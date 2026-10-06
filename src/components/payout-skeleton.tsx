import { Skeleton } from "@/components/ui/skeleton";

export function PayoutSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading payout components"
      className="grid gap-10 py-3 lg:grid-cols-[1.3fr_1fr]"
    >
      <div className="space-y-7">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-14 w-52" />
        <Skeleton className="h-48 w-full" />
      </div>
      <div className="space-y-6 lg:border-l lg:pl-10">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    </div>
  );
}
