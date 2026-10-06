import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, verifySession } from "@/lib/auth-core";
import { getAppOrigin, getAuthConfig } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { workspaceReturnPath } from "@/lib/seller-contracts";

export async function hasSession() {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!value) return false;
  return verifySession(value, getAuthConfig());
}

export async function requirePageSession(returnTo = "/sellers") {
  if (!(await hasSession()))
    redirect(`/login?next=${encodeURIComponent(workspaceReturnPath(returnTo))}`);
}

export async function requireApiSession(request: Request) {
  if (!(await hasSession()))
    throw new AppError("Your session has ended. Sign in again.", 401, "unauthorized");
  if (request.method !== "GET") assertSameOrigin(request);
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (origin !== getAppOrigin() || (site && site !== "same-origin" && site !== "none")) {
    throw new AppError("This request must come from your Ledgerly page.", 403, "invalid_origin");
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: getAppOrigin().startsWith("https://"),
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}
