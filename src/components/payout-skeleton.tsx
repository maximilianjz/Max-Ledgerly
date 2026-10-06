import { Skeleton } from "@/components/ui/skeleton";

export function PayoutSkeleton() {
  return (
    <div role="status" aria-label="Loading payout components" className="space-y-8 py-3">
      <div className="space-y-7">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-14 w-52" />
        <Skeleton className="h-48 w-full" />
      </div>
      <div className="flex flex-col gap-5 border-y py-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-3">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1].map((key) => (
            <div key={key} className="space-y-2">
              <Skeleton className="h-11 w-full lg:w-52" />
              <Skeleton className="h-3 w-36" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
