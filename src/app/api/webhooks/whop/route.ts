import { handleWebhook } from "@/lib/whop-webhooks";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleWebhook(request);
}
