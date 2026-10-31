/**
 * Shared authorization guard for protected route handlers.
 *
 * Every protected endpoint must call `requireStaff` and honour the returned
 * response when authorization fails. Client-supplied roles/ids are never
 * trusted — identity comes only from the verified session cookie.
 */

import type { NextResponse } from "next/server";

import { jsonError, type ApiErrorBody } from "./api";
import { getSessionFromRequest, isSameOrigin, type SessionStaff } from "./auth";

export type StaffGuard =
  | { staff: SessionStaff; response?: undefined }
  | { staff?: undefined; response: NextResponse<ApiErrorBody> };

export async function requireStaff(request: Request): Promise<StaffGuard> {
  if (!isSameOrigin(request)) {
    return { response: jsonError("FORBIDDEN", "Invalid request origin.") };
  }
  const staff = await getSessionFromRequest(request);
  if (!staff) {
    return { response: jsonError("UNAUTHORIZED", "Please sign in to manage appointments.") };
  }
  return { staff };
}
