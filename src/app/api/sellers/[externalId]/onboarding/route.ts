import { emptyRequest, errorResponse, jsonResponse, readJson } from "@/lib/http";
import { assertSameOrigin } from "@/lib/request-origin";
import { sellerOnboardingLink } from "@/lib/sellers";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ externalId: string }> }) {
  try {
    assertSameOrigin(request);
    emptyRequest.parse(await readJson(request));
    return jsonResponse(await sellerOnboardingLink((await context.params).externalId));
  } catch (error) {
    return errorResponse(error);
  }
}
