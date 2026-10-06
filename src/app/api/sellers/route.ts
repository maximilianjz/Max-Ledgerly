import { errorResponse, jsonResponse, readJson } from "@/lib/http";
import { sellerInputSchema } from "@/lib/integration/onboarding";
import { assertSameOrigin } from "@/lib/request-origin";
import { createSeller } from "@/lib/sellers";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const input = sellerInputSchema.strict().parse(await readJson(request));
    return jsonResponse({ seller: await createSeller(input) });
  } catch (error) {
    return errorResponse(error);
  }
}
