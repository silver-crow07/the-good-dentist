/**
 * POST /api/auth/logout — ends the staff session and clears the cookie.
 * Idempotent: signing out without a session still succeeds (200).
 */

import { NextResponse } from "next/server";

import { handleRouteError, jsonOk } from "@/lib/server/api";
import {
  destroySession,
  getSessionCookieName,
  isSameOrigin,
  readSessionCookie,
  sessionCookieOptions,
} from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Invalid request origin." } },
      { status: 403 },
    );
  }

  try {
    const cookieValue = readSessionCookie(request);
    if (cookieValue) await destroySession(cookieValue);

    const response = jsonOk({ ok: true });
    response.cookies.set(getSessionCookieName(), "", {
      ...sessionCookieOptions(0),
      maxAge: 0,
    });
    return response;
  } catch (error) {
    return handleRouteError(error, "auth/logout");
  }
}
