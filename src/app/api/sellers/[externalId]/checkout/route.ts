import { z } from "zod";
import { errorResponse, jsonResponse, readJson } from "@/lib/http";
import { assertSameOrigin } from "@/lib/request-origin";
import { EXTERNAL_ID } from "@/lib/seller-contracts";
import { createSellerPaymentLink } from "@/lib/sellers";

export const runtime = "nodejs";

const input = z
  .object({
    orderId: z.string().regex(EXTERNAL_ID),
    title: z.string().trim().min(1).max(120),
    amount: z.string().max(30),
  })
  .strict();

export async function POST(request: Request, context: { params: Promise<{ externalId: string }> }) {
  try {
    assertSameOrigin(request);
    const externalId = z
      .string()
      .regex(EXTERNAL_ID)
      .parse((await context.params).externalId);
    const values = input.parse(await readJson(request));
    return jsonResponse(await createSellerPaymentLink(externalId, values));
  } catch (error) {
    return errorResponse(error);
  }
}
