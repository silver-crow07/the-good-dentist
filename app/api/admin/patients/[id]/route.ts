/**
 * /api/admin/patients/[id] — patient profile (Phase C).
 *
 * GET   → 200 { profile } — ADMIN + STAFF. The SERVICE decides what the
 *         payload holds for the session role: ADMIN gets clinical notes and
 *         edit permissions; STAFF gets identity + appointment/treatment
 *         history with `clinicalNotes: null` (content never leaves the
 *         server for limited views).
 *         404 unknown id · 401 · 403 · 503
 * PATCH → 200 { patient } — ADMIN only (requireRole) — audited
 *         patient.update with the changed field names.
 * DELETE → 405 (patients are never deleted through the panel)
 *
 * All responses are Cache-Control: no-store (patient PII).
 */

import { NextRequest, NextResponse } from "next/server";

import { handleRouteError, jsonError, jsonOk } from "@/lib/server/api";
import { AdminError, getAdminPatient, updateAdminPatient } from "@/lib/server/admin/patients";
import { requireRole } from "@/lib/server/guard";
import { parseJsonBody, safeParseWith, updatePatientSchema } from "@/lib/server/validation";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

export async function GET(request: NextRequest, context: RouteContext) {
  const guard = await requireRole(request, ["ADMIN", "STAFF"]);
  if (guard.response) return guard.response;

  const { id } = await context.params;
  try {
    const profile = await getAdminPatient(id, guard.staff.role);
    if (!profile) {
      return jsonError(
        "SERVICE_UNAVAILABLE",
        "Patient records are temporarily unavailable — the database is not configured.",
      );
    }
    return jsonOk(profile, NO_STORE);
  } catch (error) {
    if (error instanceof AdminError) {
      return jsonError(error.code, error.message, error.fields);
    }
    return handleRouteError(error, "admin/patients/[id]/get");
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const guard = await requireRole(request, ["ADMIN"]);
  if (guard.response) return guard.response;

  const body = parseJsonBody(await request.text());
  if (body === undefined || body === null || typeof body !== "object") {
    return jsonError("VALIDATION_ERROR", "Invalid request body.");
  }
  const parsed = safeParseWith(updatePatientSchema, body);
  if (!parsed.ok) {
    return jsonError("VALIDATION_ERROR", "Please review the highlighted fields.", parsed.fields);
  }

  const { id } = await context.params;
  try {
    const patient = await updateAdminPatient(id, parsed.data, guard.staff.id);
    return jsonOk({ patient }, NO_STORE);
  } catch (error) {
    if (error instanceof AdminError) {
      return jsonError(error.code, error.message, error.fields);
    }
    return handleRouteError(error, "admin/patients/[id]/patch");
  }
}

export async function DELETE() {
  return NextResponse.json(
    { error: { code: "NOT_FOUND", message: "Patient records are managed through PATCH." } },
    { status: 405, headers: { Allow: "GET, PATCH" } },
  );
}
