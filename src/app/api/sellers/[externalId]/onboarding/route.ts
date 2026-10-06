import { requireApiSession } from "@/lib/auth";
import { emptyRequest, errorResponse, jsonResponse, readJson } from "@/lib/http";
import { sellerOnboardingLink } from "@/lib/sellers";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ externalId: string }> }) {
  try {
    await requireApiSession(request);
    emptyRequest.parse(await readJson(request));
    return jsonResponse(await sellerOnboardingLink((await context.params).externalId));
  } catch (error) {
    return errorResponse(error);
  }
}
