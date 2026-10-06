import { emptyRequest, errorResponse, jsonResponse, readJson } from "@/lib/http";
import { assertSameOrigin } from "@/lib/request-origin";
import { payoutSeller, requestedSeller } from "@/lib/sellers";
import { createPayoutSession } from "@/lib/whop";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    emptyRequest.parse(await readJson(request));
    const seller = await payoutSeller(requestedSeller(request));
    return jsonResponse(await createPayoutSession(Date.now(), seller.accountId));
  } catch (error) {
    return errorResponse(error);
  }
}
