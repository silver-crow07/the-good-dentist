/**
 * /api/admin/dental-records/[id] — one dental record (Phase D).
 *
 * GET    → 200 { timezone, record, files, permissions } — ADMIN only.
 *          Soft-deleted or unknown id → 404 · 401 · 403 (STAFF) · 503
 * PATCH  → 200 { record } — ADMIN only — audited dentalrecord.update with
 *          the changed field names. At least one field required (400).
 * DELETE → 200 { recordId, filesQueued } — ADMIN only. Soft-deletes the
 *          record, claims its files (atomic intent audits) and attempts an
 *          immediate guarded physical delete — audited dentalrecord.delete.
 *
 * All responses are Cache-Control: no-store (patient clinical data).
 */

import { NextRequest } from "next/server";

import { handleRouteError, jsonError, jsonOk } from "@/lib/server/api";
import {
  AdminError,
  deleteDentalRecord,
  getDentalRecord,
  updateDentalRecord,
} from "@/lib/server/admin/dental-records";
import { requireRole } from "@/lib/server/guard";
import { parseJsonBody, safeParseWith, updateDentalRecordSchema } from "@/lib/server/validation";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

export async function GET(request: NextRequest, context: RouteContext) {
  const guard = await requireRole(request, ["ADMIN"]);
  if (guard.response) return guard.response;

  const { id } = await context.params;
  try {
    const detail = await getDentalRecord(id);
    if (!detail) {
      return jsonError(
        "SERVICE_UNAVAILABLE",
        "Dental records are temporarily unavailable — the database is not configured.",
      );
    }
    return jsonOk(detail, NO_STORE);
  } catch (error) {
    if (error instanceof AdminError) {
      return jsonError(error.code, error.message, error.fields);
    }
    return handleRouteError(error, "admin/dental-records/[id]");
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const guard = await requireRole(request, ["ADMIN"]);
  if (guard.response) return guard.response;

  const body = parseJsonBody(await request.text());
  if (body === undefined) return jsonError("VALIDATION_ERROR", "Invalid request body.");
  const parsed = safeParseWith(updateDentalRecordSchema, body);
  if (!parsed.ok) {
    return jsonError("VALIDATION_ERROR", "Please review the highlighted fields.", parsed.fields);
  }

  const { id } = await context.params;
  try {
    const record = await updateDentalRecord(id, parsed.data, guard.staff.id);
    return jsonOk({ record }, NO_STORE);
  } catch (error) {
    if (error instanceof AdminError) {
      return jsonError(error.code, error.message, error.fields);
    }
    return handleRouteError(error, "admin/dental-records/[id]/patch");
  }
}

/**
 * DELETE → soft-deletes the record and claims its files (atomic intent
 * audits), then attempts an immediate guarded physical delete — anything
 * not yet due stays queued for cleanup Job A. Audited dentalrecord.delete.
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const guard = await requireRole(request, ["ADMIN"]);
  if (guard.response) return guard.response;

  const { id } = await context.params;
  try {
    const result = await deleteDentalRecord(id, guard.staff.id);
    return jsonOk(result, NO_STORE);
  } catch (error) {
    if (error instanceof AdminError) {
      return jsonError(error.code, error.message, error.fields);
    }
    return handleRouteError(error, "admin/dental-records/[id]/delete");
  }
}
