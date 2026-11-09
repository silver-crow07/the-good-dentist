/**
 * /api/admin/dental-records/files/[fileId] — file deletion (Phase D).
 *
 * DELETE → 200 { deleted, queued } — ADMIN only. Claims the file
 *          (status → DELETING + atomic `dentalfile.delete {trigger:"admin"}`
 *          intent audit) and then attempts the guarded physical deletion
 *          immediately (URL-TTL guard → HEAD → txA intent → final lease
 *          check → DeleteObject → HEAD confirm → txB finalise + row
 *          removal). When it is not yet due / storage is busy / storage is
 *          unconfigured, `queued: true` means cleanup Job A finishes it.
 *          404 unknown file or deleted record · 401 · 403 (STAFF)
 * GET  → 405 — file reads are presigned through /files/[fileId]/url.
 *
 * All responses are Cache-Control: no-store.
 */

import { NextRequest, NextResponse } from "next/server";

import { handleRouteError, jsonError, jsonOk } from "@/lib/server/api";
import { AdminError, deleteDentalFile } from "@/lib/server/admin/dental-files";
import { requireRole } from "@/lib/server/guard";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ fileId: string }> };

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

export async function DELETE(request: NextRequest, context: RouteContext) {
  const guard = await requireRole(request, ["ADMIN"]);
  if (guard.response) return guard.response;

  const { fileId } = await context.params;
  try {
    const result = await deleteDentalFile(fileId, guard.staff.id);
    return jsonOk(result, NO_STORE);
  } catch (error) {
    if (error instanceof AdminError) {
      return jsonError(error.code, error.message, error.fields);
    }
    return handleRouteError(error, "admin/dental-records/files/[fileId]");
  }
}

export async function GET() {
  return NextResponse.json(
    { error: { code: "NOT_FOUND", message: "Use /files/[fileId]/url for a download link." } },
    { status: 405, headers: { Allow: "DELETE", "Cache-Control": "no-store" } },
  );
}
