/**
 * GET /api/admin/appointments/options — filter pickers (STAFF + ADMIN).
 *
 * Returns the ACTIVE clinicians and treatments so the appointment list
 * filters and the reschedule dialog never hardcode slugs, plus the clinic
 * timezone and today's clinic-local date key (calendar views must never
 * read the browser clock for clinic-local decisions). Read-only, no
 * patient data.
 *
 * Responses: 200 { doctors, services, timezone, today } · 401 · 403 · 405 · 503
 */

import { NextRequest, NextResponse } from "next/server";

import { handleRouteError, jsonError, jsonOk } from "@/lib/server/api";
import { getAdminAppointmentOptions } from "@/lib/server/admin/appointments";
import { requireStaff } from "@/lib/server/guard";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const guard = await requireStaff(request);
  if (guard.response) return guard.response;

  try {
    const options = await getAdminAppointmentOptions();
    if (!options) {
      return jsonError(
        "SERVICE_UNAVAILABLE",
        "Filters are temporarily unavailable — the database is not configured.",
      );
    }
    return jsonOk(options, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error, "admin/appointments/options");
  }
}

export async function POST() {
  return NextResponse.json(
    { error: { code: "NOT_FOUND", message: "Use GET to read filter options." } },
    { status: 405, headers: { Allow: "GET" } },
  );
}
