/**
 * GET /api/admin/settings — read-only clinic configuration (STAFF + ADMIN).
 *
 * Returns the SIGNED-IN staff member's own profile plus the database-owned
 * schedule rules the booking engine enforces (hours, slot interval, booking
 * policy). There is intentionally no write method in Phase B — editing these
 * values is a separately-approved future feature.
 *
 * Responses: 200 { settings } (no-store) · 401 · 403 · 405 · 503
 */

import { NextRequest, NextResponse } from "next/server";

import { handleRouteError, jsonError, jsonOk } from "@/lib/server/api";
import { getAdminSettings } from "@/lib/server/admin/settings";
import { AdminError } from "@/lib/server/admin/dashboard";
import { requireStaff } from "@/lib/server/guard";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const guard = await requireStaff(request);
  if (guard.response) return guard.response;

  try {
    const settings = await getAdminSettings(guard.staff);
    if (!settings) {
      return jsonError(
        "SERVICE_UNAVAILABLE",
        "Settings are temporarily unavailable — the database is not configured.",
      );
    }
    return jsonOk({ settings }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AdminError) {
      return jsonError(error.code, error.message, error.fields);
    }
    return handleRouteError(error, "admin/settings");
  }
}

export async function POST() {
  return NextResponse.json(
    { error: { code: "NOT_FOUND", message: "Use GET to read settings." } },
    { status: 405, headers: { Allow: "GET" } },
  );
}
