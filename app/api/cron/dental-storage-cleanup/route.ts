/**
 * /api/cron/dental-storage-cleanup — scheduled orphan reconciliation
 * (Phase D, Vercel Cron).
 *
 * Auth: `Authorization: Bearer CRON_SECRET` — both sides are SHA-256
 * hashed to fixed length, then compared with `timingSafeEqual` (constant
 * time, no length oracle). Fail-closed: when CRON_SECRET is not
 * configured the route answers 503 (never runs unauthenticated); a
 * wrong/expired secret answers 401.
 *
 * Behaviour: one FULL leased run (Jobs B → A → C → D, 100 items, 240 s
 * soft deadline, maxDuration 300) — identical to POST
 * /api/admin/dental-records/cleanup. A busy lease answers 409 (another
 * run is already working); the schedule simply retries next time.
 *
 * The cron only fires once an authorized deploy registers it with Vercel
 * through the officially supported mechanism — a committed `vercel.json`
 * `crons` entry (schedule `0 3 * * *`, path `/api/cron/dental-storage-cleanup`)
 * or `vercel crons add`. The dashboard (Project → Settings → Cron Jobs) is
 * only there to verify, inspect, or disable the job — see
 * docs/MANUAL_DEPLOYMENT_GUIDE.md §7.1. Until the cron exists, the manual
 * cleanup endpoint is the live mechanism.
 * Responses are Cache-Control: no-store.
 */

import { createHash, timingSafeEqual } from "node:crypto";

import { NextRequest } from "next/server";

import { handleRouteError, jsonError, jsonOk } from "@/lib/server/api";
import { AdminError, runCleanup } from "@/lib/server/admin/dental-cleanup";
import { getCronSecret } from "@/lib/server/env";

export const runtime = "nodejs";

/** Full run may take up to ~4 minutes of wall clock. */
export const maxDuration = 300;

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

function bearerMatches(header: string | null, secret: string): boolean {
  if (!header || !header.startsWith("Bearer ")) return false;
  const provided = header.slice("Bearer ".length);
  // F-9: hash BOTH sides to fixed-length digests before the constant-time
  // compare — no length pre-check means no length oracle, and any bearer
  // length (shorter or longer than the secret) is handled by the same path.
  // Cryptographic equality of the digests implies equality of the inputs
  // (SHA-256 preimage resistance). Fail-closed: any mismatch → false, and
  // `getCronSecret()` still rejects unset/<32-char secrets in production.
  const a = createHash("sha256").update(provided, "utf8").digest();
  const b = createHash("sha256").update(secret, "utf8").digest();
  return timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  const secret = getCronSecret();
  if (!secret) {
    return jsonError(
      "SERVICE_UNAVAILABLE",
      "Scheduled cleanup is not configured (CRON_SECRET missing) — use the admin cleanup endpoint instead.",
      undefined,
      NO_STORE,
    );
  }
  if (!bearerMatches(request.headers.get("authorization"), secret)) {
    return jsonError("UNAUTHORIZED", "Invalid cron credentials.", undefined, NO_STORE);
  }

  try {
    const result = await runCleanup("full");
    if (!result.leaseAcquired) {
      return jsonError(
        "CONFLICT",
        "A cleanup run is already in progress — the schedule will retry.",
        undefined,
        NO_STORE,
      );
    }
    return jsonOk({ run: result }, NO_STORE);
  } catch (error) {
    if (error instanceof AdminError) {
      return jsonError(error.code, error.message, error.fields, NO_STORE);
    }
    return handleRouteError(error, "cron/dental-storage-cleanup");
  }
}
