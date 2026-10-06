import Link from "next/link";
import { cn } from "@/lib/utils";

export function Brand({ light = false }: { light?: boolean }) {
  return (
    <Link
      href="/sellers"
      aria-label="Ledgerly home"
      className={cn(
        "inline-flex w-fit items-center gap-2.5 text-[22px] font-semibold tracking-[-0.8px]",
        light && "text-white",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "relative flex size-8 items-center justify-center rounded-[9px] bg-primary",
          light && "bg-[#d8e9a5]",
        )}
      >
        <span
          className={cn(
            "absolute top-[8px] left-[9px] h-[11px] w-[5px] rounded-[1px] bg-[#e5eccd]",
            light && "bg-primary",
          )}
        />
        <span
          className={cn(
            "absolute top-[17px] left-[9px] h-[5px] w-[15px] rounded-[1px] bg-[#e5eccd]",
            light && "bg-primary",
          )}
        />
      </span>
      Ledgerly<span className="-ml-2 text-[#8b9b61]">.</span>
    </Link>
  );
}
