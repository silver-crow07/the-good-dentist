/**
 * Server-side session resolution for rendered pages and layouts.
 *
 * Route handlers read the session from an incoming `Request` (see
 * `readSessionCookie` / `getSessionFromRequest` in auth.ts); App Router
 * layouts and pages have no Request, so they read the cookie store instead.
 *
 * This is the SAME session system — same cookie name, same HMAC signature,
 * same database rows. There is deliberately no second auth mechanism.
 *
 * Lives in its own module (not auth.ts) so that offline scripts importing
 * auth.ts (scripts/create-staff.ts) never pull in `next/headers`.
 */

import { cookies } from "next/headers";

import { getSessionCookieName, getSessionStaff, type SessionStaff } from "./auth";

/**
 * The signed-in staff member for the current request context, or null.
 * Always read server-side — only `fullName` and `role` ever reach the client.
 */
export async function getCurrentStaff(): Promise<SessionStaff | null> {
  const store = await cookies();
  const value = store.get(getSessionCookieName())?.value;
  if (!value) return null;
  return getSessionStaff(value);
}
