import { errorResponse, jsonResponse } from "@/lib/http";
import { readSellerStatus } from "@/lib/sellers";

export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ externalId: string }> }) {
  try {
    return jsonResponse(await readSellerStatus((await context.params).externalId));
  } catch (error) {
    return errorResponse(error);
  }
}
