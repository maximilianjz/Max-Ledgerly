import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { IntegrationError } from "@/lib/integration/store";

const privateHeaders = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };

export function jsonResponse<T>(body: T, status = 200) {
  return NextResponse.json(body, { status, headers: privateHeaders });
}

export function errorResponse(error: unknown) {
  if (error instanceof IntegrationError) {
    const status =
      error.code === "seller_not_found"
        ? 404
        : error.code.endsWith("_required") || error.code === "storage_unavailable"
          ? 503
          : error.code.startsWith("invalid_") || error.code.startsWith("unsupported_")
            ? 400
            : error.code.includes("conflict") || error.code === "seller_suspended"
              ? 409
              : 502;
    return jsonResponse({ error: { message: error.message, code: error.code } }, status);
  }
  if (error instanceof AppError) {
    return jsonResponse(
      { error: { message: error.message, code: error.code, requestId: error.requestId } },
      error.status,
    );
  }
  if (error instanceof z.ZodError) {
    return jsonResponse(
      { error: { message: "Check the submitted values and try again.", code: "invalid_request" } },
      400,
    );
  }
  // Never serialize unexpected provider errors or request objects: they may contain credentials.
  return jsonResponse(
    { error: { message: "Something went wrong. Please try again.", code: "internal_error" } },
    500,
  );
}

export async function readJson(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new AppError("Send an application/json request.", 415, "invalid_content_type");
  }
  const raw = await request.text();
  if (raw.length > 4096) throw new AppError("The request is too large.", 413, "request_too_large");
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError("The request must contain valid JSON.", 400, "invalid_json");
  }
}

export const emptyRequest = z.object({}).strict();
