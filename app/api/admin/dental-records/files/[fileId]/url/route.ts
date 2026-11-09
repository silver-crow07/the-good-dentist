/**
 * /api/admin/dental-records/files/[fileId]/url — secure download (Phase D).
 *
 * GET → 200 { url, expiresAt } — ADMIN only. Issues a short-lived (300 s)
 *       presigned GET URL AFTER the session + role + availability checks
 *       and writes an audited `dentalfile.download` row. The R2 bucket is
 *       private: without this endpoint no object URL exists anywhere.
 *       404 unknown/deleted record's file · 409 file not AVAILABLE ·
 *       401 · 403 (STAFF) · 503 no DB / no storage
 * POST → 405 — downloads are GET-only.
 *
 * All responses are Cache-Control: no-store (signed URLs).
 */

import { NextRequest, NextResponse } from "next/server";

import { handleRouteError, jsonError, jsonOk } from "@/lib/server/api";
import { AdminError, getDentalFileUrl } from "@/lib/server/admin/dental-files";
import { requireRole } from "@/lib/server/guard";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ fileId: string }> };

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

export async function GET(request: NextRequest, context: RouteContext) {
  const guard = await requireRole(request, ["ADMIN"]);
  if (guard.response) return guard.response;

  const { fileId } = await context.params;
  try {
    const signed = await getDentalFileUrl(fileId, guard.staff.id);
    return jsonOk(signed, NO_STORE);
  } catch (error) {
    if (error instanceof AdminError) {
      return jsonError(error.code, error.message, error.fields);
    }
    return handleRouteError(error, "admin/dental-records/files/[fileId]/url");
  }
}

export async function POST() {
  return NextResponse.json(
    { error: { code: "NOT_FOUND", message: "Download links are issued with GET." } },
    { status: 405, headers: { Allow: "GET", "Cache-Control": "no-store" } },
  );
}
