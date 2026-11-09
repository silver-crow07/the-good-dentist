/**
 * /api/admin/dental-records/files/[fileId]/complete — upload verification
 * (Phase D).
 *
 * POST → 200 { file: { id, status, … } } — ADMIN only, empty body allowed.
 *        The server re-reads the object FROM STORAGE (HEAD size + magic
 *        bytes + type/extension family match) and decides the outcome
 *        itself — a lying client can never make a bad object AVAILABLE:
 *          • pass    → status AVAILABLE, audited `dentalfile.upload`
 *          • fail    → status REJECTED, audited `dentalfile.rejected`
 *                      with the reason (object_missing / oversize / size_
 *                      mismatch / family_mismatch / magic_bytes; the 10 MB
 *                      cap is checked BEFORE size equality [F-3], because
 *                      the presigned PUT cannot bind body size)
 *                      (the object is swept by cleanup Job B later and is
 *                      never served)
 *        Idempotent: replaying on an already-AVAILABLE file returns the
 *        current state without a second audit row.
 *        404 unknown file · 409 already rejected/deleting · 401 · 403
 *        · 429 rate limited (60/min per staff) · 503 no DB / no storage
 * GET  → 405.
 *
 * All responses are Cache-Control: no-store.
 */

import { NextRequest, NextResponse } from "next/server";

import { handleRouteError, jsonError, jsonOk, jsonRateLimited } from "@/lib/server/api";
import { AdminError, completeDentalFileUpload } from "@/lib/server/admin/dental-files";
import { requireRole } from "@/lib/server/guard";
import { checkRateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ fileId: string }> };

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

/** Per-staff completion budget — generous headroom over init (1:1 + retries). */
const COMPLETE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

export async function POST(request: NextRequest, context: RouteContext) {
  const guard = await requireRole(request, ["ADMIN"]);
  if (guard.response) return guard.response;

  // Server-side rate limit keyed by the AUTHENTICATED staff id (429 +
  // Retry-After), enforced before any storage read.
  const limit = checkRateLimit(`dental-complete:${guard.staff.id}`, COMPLETE_LIMIT, RATE_WINDOW_MS);
  if (!limit.ok) return jsonRateLimited(limit.retryAfterMs);

  const { fileId } = await context.params;
  try {
    const file = await completeDentalFileUpload(fileId, guard.staff.id);
    return jsonOk({ file }, NO_STORE);
  } catch (error) {
    if (error instanceof AdminError) {
      return jsonError(error.code, error.message, error.fields);
    }
    return handleRouteError(error, "admin/dental-records/files/[fileId]/complete");
  }
}

export async function GET() {
  return NextResponse.json(
    { error: { code: "NOT_FOUND", message: "Uploads are completed with POST." } },
    { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } },
  );
}
