import { z } from "zod";
import { assertSameOrigin, sessionCookieOptions } from "@/lib/auth";
import { createSession, passwordMatches, SESSION_COOKIE } from "@/lib/auth-core";
import { getAuthConfig } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { errorResponse, jsonResponse, readJson } from "@/lib/http";
import { allowLoginAttempt } from "@/lib/login-throttle";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (!allowLoginAttempt())
      throw new AppError(
        "Too many sign-in attempts. Wait a minute and try again.",
        429,
        "rate_limited",
      );
    const { password } = z
      .object({ password: z.string().min(1).max(256) })
      .strict()
      .parse(await readJson(request));
    const config = getAuthConfig();
    if (!passwordMatches(password, config.password)) {
      throw new AppError("That password didn't match. Please try again.", 401, "invalid_password");
    }
    const response = jsonResponse({ ok: true });
    response.cookies.set(SESSION_COOKIE, createSession(config), sessionCookieOptions());
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
