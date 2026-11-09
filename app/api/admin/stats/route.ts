/**
 * GET /api/admin/stats — dashboard aggregates (STAFF + ADMIN session required).
 *
 * Responses:
 *   200 { stats: { timezone, totals, today, byStatus, week, upcoming,
 *                  recentActivity } }
 *         — never cacheable: the upcoming list contains patient contact
 *           details (staff-authorized PII).
 *   401 UNAUTHORIZED        — no session cookie
 *   403 FORBIDDEN           — cross-origin request (CSRF defence)
 *   503 SERVICE_UNAVAILABLE — database not configured / schedule not seeded
 */

import { NextRequest, NextResponse } from "next/server";

import { AdminError, getAdminStats } from "@/lib/server/admin/dashboard";
import { handleRouteError, jsonError, jsonOk } from "@/lib/server/api";
import { requireStaff } from "@/lib/server/guard";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const guard = await requireStaff(request);
  if (guard.response) return guard.response;

  try {
    const stats = await getAdminStats();
    if (!stats) {
      return jsonError(
        "SERVICE_UNAVAILABLE",
        "The dashboard is temporarily unavailable — the database is not configured.",
      );
    }
    return jsonOk({ stats }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AdminError) {
      return jsonError(error.code, error.message);
    }
    return handleRouteError(error, "admin/stats");
  }
}

// Stats is read-only.
export async function POST() {
  return NextResponse.json(
    { error: { code: "NOT_FOUND", message: "Use GET to read dashboard stats." } },
    { status: 405, headers: { Allow: "GET" } },
  );
}
