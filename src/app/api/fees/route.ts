import { z } from "zod";
import { requireApiSession } from "@/lib/auth";
import { errorResponse, jsonResponse, readJson } from "@/lib/http";
import { payoutSeller, requestedSeller } from "@/lib/sellers";
import { getCryptoMarkup, updateCryptoMarkup } from "@/lib/whop";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireApiSession(request);
    return jsonResponse(
      await getCryptoMarkup((await payoutSeller(requestedSeller(request))).accountId),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    await requireApiSession(request);
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
