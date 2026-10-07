import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { WebhookActivity } from "@/components/webhook-activity";
import { WorkspaceHeader } from "@/components/workspace-header";
import { isLocalOperator } from "@/lib/local-operator";
import { type ActivityReceipt, readWebhookActivity } from "@/lib/webhook-activity";

export const dynamic = "force-dynamic";

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string }>;
}) {
  if (!isLocalOperator(await headers())) notFound();
  let receipts: ActivityReceipt[] = [];
  let issue: string | null = null;
  try {
    receipts = await readWebhookActivity();
  } catch {
    issue =
      "Saved receipts could not be loaded. Check the database and platform configuration, then refresh.";
  }
  const query = await searchParams;
  return (
    <>
      <WorkspaceHeader />
      <WebhookActivity
        receipts={receipts}
        issue={issue}
        initialSearch={typeof query.search === "string" ? query.search : ""}
      />
    </>
  );
}
