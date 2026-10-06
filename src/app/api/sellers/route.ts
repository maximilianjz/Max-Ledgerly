import { z } from "zod";
import { requireApiSession } from "@/lib/auth";
import { isCountryCode } from "@/lib/countries";
import { errorResponse, jsonResponse, readJson } from "@/lib/http";
import { createSeller } from "@/lib/sellers";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    await requireApiSession(request);
    const input = z
      .object({
        externalId: z.string().min(1).max(120),
        email: z.string().min(1).max(254),
        country: z.string().trim().toUpperCase().refine(isCountryCode),
      })
      .strict()
      .parse(await readJson(request));
    return jsonResponse({ seller: await createSeller(input) });
  } catch (error) {
    return errorResponse(error);
  }
}
