import { redirect } from "next/navigation";
import { workspaceReturnPath } from "@/lib/seller-contracts";

// Preserve old bookmarks and callback URLs after removing workspace login.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = (await searchParams).next;
  redirect(next ? workspaceReturnPath(next) : "/");
}
