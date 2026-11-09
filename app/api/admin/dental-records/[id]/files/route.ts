/**
 * /api/admin/dental-records/[id]/files — upload-init (Phase D).
 *
 * POST → 201 { file: { id, upload: { url, method, headers, expiresAt } } }
 *        ADMIN only. The server validates the declared type/size, then
 *        reserves the DentalFile row + R2KeyRegistry tombstone in ONE
 *        transaction — started by a `FOR UPDATE` lock on the record row so
 *        concurrent inits race-safely enforce the per-record file cap
 *        (DENTAL_MAX_FILES_PER_RECORD) — and only THEN returns the
 *        short-lived presigned PUT URL. The
 *        browser PUTs the bytes directly to R2 and calls
 *        POST /files/[fileId]/complete to trigger server-side verification.
 *        400 unsupported type/oversize · 404 unknown/deleted record ·
 *        401 · 403 (STAFF) · 409 key reservation conflict or file cap
 *        reached · 429 rate limited (30/min per staff) · 503 no DB/no storage
 * GET  → 405 — files are read through the record detail route.
 *
 * No response ever contains R2 credentials — only the signed URL.
 * All responses are Cache-Control: no-store.
 */

import { NextRequest, NextResponse } from "next/server";

import { handleRouteError, jsonCreated, jsonError, jsonRateLimited } from "@/lib/server/api";
import { AdminError, initDentalFileUpload } from "@/lib/server/admin/dental-files";
import { requireRole } from "@/lib/server/guard";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { initDentalFileSchema, parseJsonBody, safeParseWith } from "@/lib/server/validation";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

/** Per-staff upload-init budget: generous for batch X-ray sessions. */
const INIT_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;

export async function POST(request: NextRequest, context: RouteContext) {
  const guard = await requireRole(request, ["ADMIN"]);
  if (guard.response) return guard.response;

  // Server-side rate limit keyed by the AUTHENTICATED staff id (429 +
  // Retry-After). Applied before any DB/storage work; never trusts a
  // client-supplied identity.
  const limit = checkRateLimit(`dental-init:${guard.staff.id}`, INIT_LIMIT, RATE_WINDOW_MS);
  if (!limit.ok) return jsonRateLimited(limit.retryAfterMs);

  const body = parseJsonBody(await request.text());
  if (body === undefined) return jsonError("VALIDATION_ERROR", "Invalid request body.");
  const parsed = safeParseWith(initDentalFileSchema, body);
  if (!parsed.ok) {
    return jsonError("VALIDATION_ERROR", "Please review the highlighted fields.", parsed.fields);
  }

  const { id } = await context.params;
  try {
    const ticket = await initDentalFileUpload(id, parsed.data, guard.staff.id);
    return jsonCreated(
      { file: { id: ticket.fileId, upload: ticket.upload } },
      NO_STORE,
    );
  } catch (error) {
    if (error instanceof AdminError) {
      return jsonError(error.code, error.message, error.fields);
    }
    return handleRouteError(error, "admin/dental-records/[id]/files");
  }
}

export async function GET() {
  return NextResponse.json(
    { error: { code: "NOT_FOUND", message: "Files are managed through the record detail view." } },
    { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } },
  );
}
