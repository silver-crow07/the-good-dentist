/**
 * /api/admin/dental-records/cleanup — manual storage cleanup (Phase D).
 *
 * GET  → 200 { run } — ADMIN only. THROTTLED sweep: Jobs B → A → C only,
 *        10 shared items, 60 s soft deadline, one leased run. Safe to call
 *        repeatedly (it never runs the orphan reconciler).
 * POST → 200 { run } — ADMIN only. FULL run: Jobs B → A → C → D, 100
 *        shared items, 240 s soft deadline (maxDuration = 300), includes
 *        the orphan reconciliation with the durable cursor.
 *        409 another live run holds the lease · 429 rate limited (both
 *        methods share one per-staff budget) · 401 · 403 (STAFF) · 503
 * DELETE → 405.
 *
 * `run.stoppedBy` reports why a run ended: "complete" | "budget" |
 * "deadline". Responses are Cache-Control: no-store.
 */

import { NextRequest, NextResponse } from "next/server";

import { handleRouteError, jsonError, jsonOk, jsonRateLimited } from "@/lib/server/api";
import { AdminError, runCleanup } from "@/lib/server/admin/dental-cleanup";
import { requireRole } from "@/lib/server/guard";
import { checkRateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

/** Vercel function ceiling for the full run (matches the cron route). */
export const maxDuration = 300;

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

/** Per-staff cleanup budget (GET + POST share it) — ample for manual use. */
const CLEANUP_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

async function run(request: NextRequest, mode: "throttle" | "full") {
  const guard = await requireRole(request, ["ADMIN"]);
  if (guard.response) return guard.response;

  // Server-side rate limit keyed by the AUTHENTICATED staff id (429 +
  // Retry-After), enforced before the lease/DB work.
  const limit = checkRateLimit(`dental-cleanup:${guard.staff.id}`, CLEANUP_LIMIT, RATE_WINDOW_MS);
  if (!limit.ok) return jsonRateLimited(limit.retryAfterMs);

  try {
    const result = await runCleanup(mode);
    if (!result.leaseAcquired) {
      return jsonError("CONFLICT", "A cleanup run is already in progress — try again shortly.");
    }
    return jsonOk({ run: result }, NO_STORE);
  } catch (error) {
    if (error instanceof AdminError) {
      return jsonError(error.code, error.message, error.fields);
    }
    return handleRouteError(error, "admin/dental-records/cleanup");
  }
}

export async function GET(request: NextRequest) {
  return run(request, "throttle");
}

export async function POST(request: NextRequest) {
  return run(request, "full");
}

export async function DELETE() {
  return NextResponse.json(
    { error: { code: "NOT_FOUND", message: "Cleanup runs are triggered with GET (sweep) or POST (full)." } },
    { status: 405, headers: { Allow: "GET, POST", "Cache-Control": "no-store" } },
  );
}
