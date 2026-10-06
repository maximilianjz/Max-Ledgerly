import { handleWebhook } from "@/lib/whop-webhooks";

export const runtime = "nodejs";

export async function POST(request: Request) {
  // An unset parent secret must never fall back to the connected-account secret.
  return handleWebhook(request, { secret: process.env.WHOP_PARENT_WEBHOOK_SECRET ?? "" });
}
