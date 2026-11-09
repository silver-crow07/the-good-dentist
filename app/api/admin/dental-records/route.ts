/**
 * /api/admin/dental-records — dental record history (Phase D).
 *
 * GET  → 200 { timezone, records, pagination } — ADMIN only (requireRole).
 *        Filters: patientId, from/to (treatment-date range, inclusive), q
 *        (diagnosis / patient name). Newest treatment date first.
 *        400 invalid query · 401 · 403 (STAFF) · 503 no DB
 * POST → 201 { record } — ADMIN only — audited dentalrecord.create.
 * DELETE → 405 (records are deleted through the [id] route).
 *
 * All responses are Cache-Control: no-store (patient clinical data).
 */

import { NextRequest, NextResponse } from "next/server";

import { handleRouteError, jsonCreated, jsonError, jsonOk } from "@/lib/server/api";
import {
  AdminError,
  createDentalRecord,
  listDentalRecords,
} from "@/lib/server/admin/dental-records";
import { requireRole } from "@/lib/server/guard";
import {
  adminDentalRecordsQuerySchema,
  createDentalRecordSchema,
  parseJsonBody,
  safeParseWith,
} from "@/lib/server/validation";

export const runtime = "nodejs";

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

export async function GET(request: NextRequest) {
  const guard = await requireRole(request, ["ADMIN"]);
  if (guard.response) return guard.response;

  const query = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = safeParseWith(adminDentalRecordsQuerySchema, query);
  if (!parsed.ok) {
    return jsonError("VALIDATION_ERROR", "Please review the highlighted fields.", parsed.fields);
  }

  try {
    const page = await listDentalRecords(parsed.data);
    if (!page) {
      return jsonError(
        "SERVICE_UNAVAILABLE",
        "Dental records are temporarily unavailable — the database is not configured.",
      );
    }
    return jsonOk(page, NO_STORE);
  } catch (error) {
    if (error instanceof AdminError) {
      return jsonError(error.code, error.message, error.fields);
    }
    return handleRouteError(error, "admin/dental-records");
  }
}

export async function POST(request: NextRequest) {
  const guard = await requireRole(request, ["ADMIN"]);
  if (guard.response) return guard.response;

  const body = parseJsonBody(await request.text());
  if (body === undefined) return jsonError("VALIDATION_ERROR", "Invalid request body.");
  const parsed = safeParseWith(createDentalRecordSchema, body);
  if (!parsed.ok) {
    return jsonError("VALIDATION_ERROR", "Please review the highlighted fields.", parsed.fields);
  }

  try {
    const record = await createDentalRecord(parsed.data, guard.staff.id);
    return jsonCreated({ record }, NO_STORE);
  } catch (error) {
    if (error instanceof AdminError) {
      return jsonError(error.code, error.message, error.fields);
    }
    return handleRouteError(error, "admin/dental-records/create");
  }
}

export async function DELETE() {
  return NextResponse.json(
    { error: { code: "NOT_FOUND", message: "Dental records are deleted through /api/admin/dental-records/[id]." } },
    { status: 405, headers: { Allow: "GET, POST", "Cache-Control": "no-store" } },
  );
}
