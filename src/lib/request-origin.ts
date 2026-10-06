import "server-only";
import { getAppOrigin } from "@/lib/config";
import { AppError } from "@/lib/errors";

// Blocks cross-site browser mutations; this is not visitor authentication.
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (origin !== getAppOrigin() || (site && site !== "same-origin" && site !== "none")) {
    throw new AppError("This request must come from your Ledgerly page.", 403, "invalid_origin");
  }
}
