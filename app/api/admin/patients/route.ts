/**
 * /api/admin/patients — patient directory (Phase C).
 *
 * GET  → 200 { patients, pagination }  — ADMIN + STAFF (limited fields are
 *        identical for both roles; the profile route differs by role)
 *        400 invalid query · 401 no session · 403 cross-origin · 503 no DB
 * POST → 201 { patient } — ADMIN only (requireRole) — audited patient.create
 * DELETE → 405 (patients are never deleted through the panel)
 *
 * All responses are Cache-Control: no-store (patient PII).
 */

import { NextRequest, NextResponse } from "next/server";

import { handleRouteError, jsonCreated, jsonError, jsonOk } from "@/lib/server/api";
import { AdminError, listAdminPatients, createAdminPatient } from "@/lib/server/admin/patients";
import { requireRole, requireStaff } from "@/lib/server/guard";
import {
  adminPatientsQuerySchema,
  createPatientSchema,
  parseJsonBody,
  safeParseWith,
} from "@/lib/server/validation";

export const runtime = "nodejs";

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

export async function GET(request: NextRequest) {
  // Both roles may browse the directory; STAFF needs it for appointment
  // management. Deeper data (clinical notes) is stripped by the service.
  const guard = await requireStaff(request);
  if (guard.response) return guard.response;

  const query = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = safeParseWith(adminPatientsQuerySchema, query);
  if (!parsed.ok) {
    return jsonError("VALIDATION_ERROR", "Please review the highlighted fields.", parsed.fields);
  }

  try {
    const page = await listAdminPatients(parsed.data);
    if (!page) {
      return jsonError(
        "SERVICE_UNAVAILABLE",
        "Patient records are temporarily unavailable — the database is not configured.",
      );
    }
    return jsonOk(page, NO_STORE);
  } catch (error) {
    if (error instanceof AdminError) {
      return jsonError(error.code, error.message, error.fields);
    }
    return handleRouteError(error, "admin/patients");
  }
}

export async function POST(request: NextRequest) {
  const guard = await requireRole(request, ["ADMIN"]);
  if (guard.response) return guard.response;

  const body = parseJsonBody(await request.text());
  if (body === undefined) return jsonError("VALIDATION_ERROR", "Invalid request body.");
  const parsed = safeParseWith(createPatientSchema, body);
  if (!parsed.ok) {
    return jsonError("VALIDATION_ERROR", "Please review the highlighted fields.", parsed.fields);
  }

  try {
    const patient = await createAdminPatient(parsed.data, guard.staff.id);
    return jsonCreated({ patient }, NO_STORE);
  } catch (error) {
    if (error instanceof AdminError) {
      return jsonError(error.code, error.message, error.fields);
    }
    return handleRouteError(error, "admin/patients/create");
  }
}

export async function DELETE() {
  return NextResponse.json(
    { error: { code: "NOT_FOUND", message: "Patient records are managed through PATCH." } },
    { status: 405, headers: { Allow: "GET, POST" } },
  );
}
