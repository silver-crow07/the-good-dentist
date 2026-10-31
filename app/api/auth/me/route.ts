/**
 * GET /api/auth/me — resolves the current staff session.
 *
 * 200 { staff: { fullName, role } } when a valid session cookie is present,
 * 401 otherwise. Never exposes ids or other accounts' data.
 */

import { jsonError, jsonOk } from "@/lib/server/api";
import { getSessionFromRequest } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const staff = await getSessionFromRequest(request);
  if (!staff) {
    return jsonError("UNAUTHORIZED", "Not signed in.");
  }
  return jsonOk({ staff: { fullName: staff.fullName, role: staff.role } });
}
