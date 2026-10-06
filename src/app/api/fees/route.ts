import { z } from "zod";
import { errorResponse, jsonResponse, readJson } from "@/lib/http";
import { assertSameOrigin } from "@/lib/request-origin";
import { payoutSeller, requestedSeller } from "@/lib/sellers";
import { getCryptoMarkup, updateCryptoMarkup } from "@/lib/whop";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    return jsonResponse(
      await getCryptoMarkup((await payoutSeller(requestedSeller(request))).accountId),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const { percentage } = z
      .object({ percentage: z.number().finite().min(0).max(100) })
      .strict()
      .parse(await readJson(request));
    return jsonResponse(
      await updateCryptoMarkup(
        percentage,
        (await payoutSeller(requestedSeller(request))).accountId,
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
