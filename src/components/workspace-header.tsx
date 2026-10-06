import { Brand } from "@/components/brand";

export function WorkspaceHeader() {
  return (
    <header className="border-b border-border/80">
      <div className="mx-auto flex h-20 max-w-[1320px] items-center px-6 sm:px-10">
        <Brand />
      </div>
    </header>
  );
}
