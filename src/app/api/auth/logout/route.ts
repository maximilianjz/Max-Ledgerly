import { requireApiSession, sessionCookieOptions } from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/auth-core";
import { errorResponse, jsonResponse } from "@/lib/http";

export async function POST(request: Request) {
  try {
    await requireApiSession(request);
    const response = jsonResponse({ ok: true });
    response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
