/**
 * /api/admin/patients/[id]/notes — internal clinical notes (Phase C).
 *
 * POST → 201 { note } — ADMIN only (requireRole, STAFF gets 403). The note
 *        is written with an audit row (note.create) in one transaction.
 *        404 unknown patient · 400 empty/too-long body · 401 · 403 · 503
 * GET  → 405 — notes are read through the patient profile (which applies
 *        the same ADMIN-only rule server-side).
 *
 * Responses are Cache-Control: no-store (clinical content).
 */

import { NextRequest, NextResponse } from "next/server";

import { handleRouteError, jsonCreated, jsonError } from "@/lib/server/api";
import { AdminError, addClinicalNote } from "@/lib/server/admin/patients";
import { requireRole } from "@/lib/server/guard";
import { clinicalNoteSchema, parseJsonBody, safeParseWith } from "@/lib/server/validation";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

export async function POST(request: NextRequest, context: RouteContext) {
  const guard = await requireRole(request, ["ADMIN"]);
  if (guard.response) return guard.response;

  const body = parseJsonBody(await request.text());
  if (body === undefined || body === null || typeof body !== "object") {
    return jsonError("VALIDATION_ERROR", "Invalid request body.");
  }
  const parsed = safeParseWith(clinicalNoteSchema, body);
  if (!parsed.ok) {
    return jsonError("VALIDATION_ERROR", "Please review the highlighted fields.", parsed.fields);
  }

  const { id } = await context.params;
  try {
    const note = await addClinicalNote(id, parsed.data.body, guard.staff.id);
    return jsonCreated({ note }, NO_STORE);
  } catch (error) {
    if (error instanceof AdminError) {
      return jsonError(error.code, error.message, error.fields);
    }
    return handleRouteError(error, "admin/patients/[id]/notes");
  }
}

export async function GET() {
  return NextResponse.json(
    { error: { code: "NOT_FOUND", message: "Notes are read through the patient profile." } },
    { status: 405, headers: { Allow: "POST" } },
  );
}
