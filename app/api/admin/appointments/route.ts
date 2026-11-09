/**
 * GET /api/admin/appointments — staff appointment list (STAFF + ADMIN).
 *
 * Query (all optional):
 *   page, pageSize      — list mode pagination (default 20, max 100)
 *   q                   — patient name / phone digits / public id search
 *   status              — PENDING | CONFIRMED | CANCELLED | COMPLETED | NO_SHOW
 *   date                — one clinic-local day (list filter)
 *   from, to            — clinic-local range for the calendar views (no pagination)
 *   doctorSlug, serviceSlug — exact matches
 *
 * Responses:
 *   200 { appointments, pagination | range }  — never cacheable (patient PII)
 *   400 VALIDATION_ERROR  — malformed query
 *   401 UNAUTHORIZED      — no session cookie
 *   403 FORBIDDEN         — cross-origin request (CSRF defence)
 *   405                   — non-GET methods
 *   503 SERVICE_UNAVAILABLE — database not configured / schedule not seeded
 */

import { NextRequest, NextResponse } from "next/server";

import { handleRouteError, jsonError, jsonOk } from "@/lib/server/api";
import {
  AdminError,
  listAdminAppointments,
} from "@/lib/server/admin/appointments";
import { requireStaff } from "@/lib/server/guard";
import { adminAppointmentsQuerySchema, safeParseWith } from "@/lib/server/validation";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const guard = await requireStaff(request);
  if (guard.response) return guard.response;

  const query = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = safeParseWith(adminAppointmentsQuerySchema, query);
  if (!parsed.ok) {
    return jsonError("VALIDATION_ERROR", "Please review the highlighted fields.", parsed.fields);
  }

  try {
    const page = await listAdminAppointments(parsed.data);
    if (!page) {
      return jsonError(
        "SERVICE_UNAVAILABLE",
        "The appointment book is temporarily unavailable — the database is not configured.",
      );
    }
    return jsonOk(page, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AdminError) {
      return jsonError(error.code, error.message, error.fields);
    }
    return handleRouteError(error, "admin/appointments");
  }
}

// The list is read-only; mutations go through /api/appointments/[id].
export async function POST() {
  return NextResponse.json(
    { error: { code: "NOT_FOUND", message: "Use GET to list appointments." } },
    { status: 405, headers: { Allow: "GET" } },
  );
}
