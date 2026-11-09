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

/**
 * Role decision, kept pure so it can be unit-tested without a session.
 *
 * Roles come from the verified session only — a client-supplied role is
 * never consulted. `roles` is the allow-list for the endpoint.
 */
export function isRoleAllowed(
  staff: Pick<SessionStaff, "role">,
  roles: readonly SessionStaff["role"][],
): boolean {
  return roles.includes(staff.role);
}

/**
 * Session + role gate for ADMIN-only (or role-restricted) endpoints.
 * Enforced here on the server — hiding a button in the UI is never the
 * permission check.
 *
 *   const guard = await requireRole(request, ["ADMIN"]);
 *   if (guard.response) return guard.response;
 */
export async function requireRole(
  request: Request,
  roles: readonly SessionStaff["role"][],
): Promise<StaffGuard> {
  const guard = await requireStaff(request);
  if (guard.response) return guard;
  if (!isRoleAllowed(guard.staff, roles)) {
    return {
      response: jsonError("FORBIDDEN", "You do not have permission to perform this action."),
    };
  }
  return guard;
}
