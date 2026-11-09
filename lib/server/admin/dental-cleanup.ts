/**
 * Storage cleanup workers (Phase D) — one leased run, job order B → A → C → D.
 *
 * Jobs (shared item budget + soft deadline across the whole run):
 *   B  sweep   — claim due files (PENDING past cleanupAfter, REJECTED, or
 *                belonging to a soft-deleted record) → status DELETING with
 *                an atomic `dentalfile.delete {trigger:"sweep"}` intent audit.
 *                An AVAILABLE file on a LIVE record is NEVER claimable just
 *                because cleanupAfter elapsed (F-1 — the URL-TTL window
 *                gates when a claim may happen, not whether a healthy file
 *                is deletable).
 *                Claims NEVER touch `cleanupAfter` (the URL-TTL guard stays).
 *   A  delete   — physically remove claimed files whose `cleanupAfter <=
 *                fresh DB clock`, via the shared protocol in dental-delete.ts
 *                (HEAD → txA intent → final holdsLease → DeleteObject →
 *                HEAD confirm → txB finalise + row removal). No audits.
 *   C  purge    — delete soft-deleted DentalRecord rows with ZERO remaining
 *                files (file rows are removed atomically by Job A). No audits.
 *   D  reconcile— LIST `dental/` from the durable cursor, row check FIRST
 *                (row-backed objects are NEVER orphan-deleted), 48 h grace
 *                from a FRESH HeadObject against t0 (fail closed), intent →
 *                final holdsLease → DeleteObject → HEAD confirm → txB
 *                finalise + audit.
 *
 * Failure isolation (F-2): every Job A / Job D item runs inside its own
 * try/catch — a storage failure for ONE key is tallied `failed_error`, logged
 * with runId + key context (never PHI), and the loop continues with the next
 * item. A failed item is never falsely completed (a pre-existing receipt stays
 * PENDING for takeover; the row stays DELETING; the object is untouched).
 * Global DATABASE failures still abort the run — the `finally` block always
 * releases the lease.
 *
 * Lease: ONE lease covers the whole run (tryAcquireLease at start, released
 * in finally, expires after LEASE_MS on crash). t0 = fresh DB clock at run
 * start drives every grace decision (conservative — a run never trusts an
 * older clock). Deadlines use the APP clock (t0 + 240 s full/cron,
 * 60 s throttled) because they only bound our own work.
 *
 * Cursors: `StorageScanState.lastScannedKey` persists between runs and is
 * only ever written while THIS run holds the lease; a shape-invalid cursor
 * (not under `dental/`) is discarded instead of followed.
 */

import { randomBytes } from "node:crypto";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";

import { getPrisma } from "../db";
import { getStorage } from "../storage";
import {
  captureEvidence,
  DENTAL_PREFIX,
  isGraceElapsed,
  isShapeValidCursor,
} from "../storage/pure";
import { AdminError } from "./dashboard";

export { AdminError };
import {
  createDeletionIntent,
  dbNow,
  deleteRowBackedFile,
  finalizeDeletion,
  holdsLease,
  LEASE_MS,
  releaseLease,
  SCAN_STATE_ID,
  takeOverStaleIntent,
  tryAcquireLease,
} from "./dental-delete";

/* ------------------------------------------------------------------ *
 * Budgets & deadlines (approved constants)
 * ------------------------------------------------------------------ */

/** Shared item budget for one throttled sweep (GET) across Jobs B/A/C. */
export const THROTTLE_BUDGET = 10;
/** Shared item budget for a full run (POST manual / cron). */
export const FULL_BUDGET = 100;
/** Soft deadline (app clock) for a throttled sweep. */
export const THROTTLE_DEADLINE_MS = 60 * 1000;
/** Soft deadline (app clock) for a full run. */
export const FULL_DEADLINE_MS = 240 * 1000;
/** Job D LIST page size — the per-page pre-pass limit. */
export const PREPASS_LIMIT = 100;
/** Job D keys examined per run (all pages combined). */
export const MAX_KEYS_PER_RUN = 2000;

export type CleanupMode = "throttle" | "full";

export type JobName = "sweep" | "delete" | "purge" | "reconcile";

export type JobResult = {
  job: JobName;
  processed: number;
  /** Structured per-job counters (claim/delete/purge/orphan outcomes). */
  counts: Record<string, number>;
  /** Set when the job did not run (reason code). */
  skipped?: "no_storage" | "budget" | "deadline" | "lease_lost";
  /** Reconcile only: a full cursor cycle finished this run. */
  cursorComplete?: boolean;
};

export type CleanupRunResult = {
  runId: string;
  mode: CleanupMode;
  startedAt: string;
  finishedAt: string;
  t0: string;
  leaseAcquired: boolean;
  /** "complete" when every job finished inside budget+deadline. */
  stoppedBy: "complete" | "budget" | "deadline" | "lease_busy" | "no_database";
  jobs: JobResult[];
  cursor: string | null;
  cursorCycleComplete: boolean;
};

type RunContext = {
  db: PrismaClient;
  runId: string;
  t0: Date;
  /** App-clock deadline (ms since epoch). */
  deadline: number;
  /** Remaining shared item budget across Jobs B/A/C. */
  budget: number;
  storage: ReturnType<typeof getStorage>;
  stoppedBy: CleanupRunResult["stoppedBy"];
};

function newRunId(): string {
  return `run_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
}

/**
 * F-2 failure classifier — separates a PER-ITEM storage failure (isolate it,
 * keep processing the remaining items) from a broken GLOBAL database layer
 * (abort the run: re-running the same query for every remaining item cannot
 * succeed, and the caller must see the outage).
 *
 * Prisma client errors are infrastructure by definition here: connection
 * loss / timeout (P1xxx), transport or rust-panic failures, or a query-shape
 * validation error. Domain conflicts never reach this check — txA converts
 * P2002/P2034 into `AdminError CONFLICT`, which the delete protocols already
 * map to `skipped_conflict` (counted, not thrown).
 */
function isDatabaseFailure(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientRustPanicError ||
    error instanceof Prisma.PrismaClientValidationError
  );
}

/* ------------------------------------------------------------------ *
 * Job B — claim due files for deletion
 * ------------------------------------------------------------------ */

async function jobSweep(ctx: RunContext): Promise<JobResult> {
  const result: JobResult = { job: "sweep", processed: 0, counts: { claimed: 0 } };
  if (ctx.budget <= 0) {
    result.skipped = "budget";
    ctx.stoppedBy = "budget";
    return result;
  }
  if (Date.now() >= ctx.deadline) {
    result.skipped = "deadline";
    ctx.stoppedBy = "deadline";
    return result;
  }

  const claimed = await ctx.db.$transaction(async (tx) => {
    // Claim in one statement (Postgres has no UPDATE … LIMIT — subquery),
    // oldest cleanupAfter first so abandoned uploads drain FIFO.
    //
    // F-1 claim guard — eligible sets ONLY:
    //   · PENDING  past cleanupAfter (abandoned upload), or
    //   · REJECTED past cleanupAfter (verification failed), or
    //   · ANY non-DELETING file of a SOFT-DELETED record (all of its
    //     files must go, whatever their status).
    // A healthy AVAILABLE file on a LIVE record is NEVER claimable just
    // because its URL-TTL window elapsed — `cleanupAfter` only ever gates
    // WHEN a claim may happen, never whether a live file is deletable.
    const rows = await tx.$queryRaw<Array<{ id: string; recordId: string }>>`
      UPDATE "DentalFile" f
         SET "status" = 'DELETING', "updatedAt" = clock_timestamp()
       WHERE f."id" IN (
         SELECT c."id" FROM "DentalFile" c
           JOIN "DentalRecord" r ON r."id" = c."recordId"
          WHERE c."status" <> 'DELETING'
            AND ( ( c."status" IN ('PENDING', 'REJECTED')
                    AND c."cleanupAfter" <= clock_timestamp() )
               OR r."deletedAt" IS NOT NULL )
          ORDER BY c."cleanupAfter"
          LIMIT ${ctx.budget}
       )
      RETURNING f."id", f."recordId"`;

    // Intent audit written ATOMICALLY with the claim (same transaction).
    for (const row of rows) {
      await tx.auditLog.create({
        data: {
          staffId: null,
          action: "dentalfile.delete",
          entityType: "DentalFile",
          entityId: row.id,
          metadata: { trigger: "sweep", recordId: row.recordId },
        },
      });
    }
    return rows;
  });

  ctx.budget -= claimed.length;
  result.processed = claimed.length;
  result.counts.claimed = claimed.length;
  return result;
}

/* ------------------------------------------------------------------ *
 * Job A — physical deletion of claimed (DELETING) files
 * ------------------------------------------------------------------ */

async function jobDelete(ctx: RunContext): Promise<JobResult> {
  const result: JobResult = {
    job: "delete",
    processed: 0,
    counts: { deleted: 0, already_absent: 0, skipped_not_due: 0, skipped_lease: 0, skipped_conflict: 0, failed_confirm: 0, failed_error: 0 },
  };
  if (!ctx.storage) {
    result.skipped = "no_storage";
    return result;
  }
  if (ctx.budget <= 0) {
    result.skipped = "budget";
    ctx.stoppedBy = "budget";
    return result;
  }
  if (Date.now() >= ctx.deadline) {
    result.skipped = "deadline";
    ctx.stoppedBy = "deadline";
    return result;
  }

  // Fresh DB clock at Job A start — the authoritative `cleanupAfter` guard.
  const now = await dbNow(ctx.db);
  const rows = await ctx.db.dentalFile.findMany({
    where: { status: "DELETING", cleanupAfter: { lte: now } },
    orderBy: { cleanupAfter: "asc" },
    take: ctx.budget,
    select: { id: true, r2Key: true, cleanupAfter: true },
  });

  let processed = 0;
  for (const file of rows) {
    if (Date.now() >= ctx.deadline) {
      ctx.stoppedBy = "deadline";
      break;
    }
    try {
      const outcome = await deleteRowBackedFile(ctx.db, ctx.storage, file, ctx.runId);
      result.counts[outcome] = (result.counts[outcome] ?? 0) + 1;
      processed += 1;
      // "skipped_*" outcomes leave the row for a later run — they still
      // consumed budget because they were examined.
    } catch (error) {
      // F-2: a GLOBAL database failure is not an item failure — abort the
      // run (the caller sees it; `finally` still releases the lease).
      if (isDatabaseFailure(error)) throw error;
      // Per-item storage failure: isolate it and keep processing. Nothing
      // was falsely completed — a pre-existing txA receipt stays PENDING
      // for the next run's takeover; the row stays DELETING; the object
      // is untouched (or, if DeleteObject itself failed, idempotent on
      // retry). Log context only — no PHI (ids/keys, never patient data).
      result.counts.failed_error = (result.counts.failed_error ?? 0) + 1;
      processed += 1;
      console.error(
        `[dental-cleanup] jobDelete item failed (run=${ctx.runId} file=${file.id} key=${file.r2Key}):`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  ctx.budget -= processed;
  result.processed = processed;
  return result;
}

/* ------------------------------------------------------------------ *
 * Job C — purge soft-deleted records with zero files left
 * ------------------------------------------------------------------ */

async function jobPurge(ctx: RunContext): Promise<JobResult> {
  const result: JobResult = { job: "purge", processed: 0, counts: { purged: 0 } };
  if (ctx.budget <= 0) {
    result.skipped = "budget";
    ctx.stoppedBy = "budget";
    return result;
  }
  if (Date.now() >= ctx.deadline) {
    result.skipped = "deadline";
    ctx.stoppedBy = "deadline";
    return result;
  }

  const rows = await ctx.db.$queryRaw<Array<{ id: string }>>`
    DELETE FROM "DentalRecord" d
     WHERE d."id" IN (
       SELECT r."id" FROM "DentalRecord" r
        WHERE r."deletedAt" IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM "DentalFile" f WHERE f."recordId" = r."id"
          )
        ORDER BY r."deletedAt"
        LIMIT ${ctx.budget}
     )
    RETURNING d."id"`;

  ctx.budget -= rows.length;
  result.processed = rows.length;
  result.counts.purged = rows.length;
  return result;
}

/* ------------------------------------------------------------------ *
 * Job D — orphan reconciliation
 * ------------------------------------------------------------------ */

type OrphanOutcome =
  | "orphan_deleted"
  | "orphan_already_absent"
  | "skipped_young"
  | "skipped_no_row_check"
  | "skipped_row_backed"
  | "skipped_no_timestamp"
  | "skipped_lease"
  | "skipped_conflict"
  | "failed_confirm"
  | "failed_error";

/**
 * Deletes ONE row-less object under the full protocol (fresh HEAD grace →
 * txA intent → final holdsLease → DeleteObject → HEAD confirm → txB
 * finalise + audit). `t0` (run-start DB clock) is the grace reference.
 */
async function deleteOrphanObject(
  ctx: RunContext,
  key: string,
  listLastModified: Date | null,
): Promise<OrphanOutcome> {
  const storage = ctx.storage!;

  // LIST timestamps are an OPTIMIZATION only: a clearly-young object can
  // be skipped WITHOUT a HEAD. A missing LIST timestamp falls through to
  // the authoritative fresh HEAD.
  if (listLastModified && !isGraceElapsed(listLastModified, ctx.t0)) {
    return "skipped_young";
  }

  const head = await storage.headObject(key);
  if (!head.found) {
    // The CALLER (jobReconcile) tallies every outcome uniformly — never
    // increment `counters` here or the outcome is double-counted.
    await ctx.db.auditLog.create({
      data: {
        staffId: null,
        action: "dentalfile.orphan_already_absent",
        entityType: "DentalFile",
        entityId: null,
        metadata: { r2Key: key },
      },
    });
    return "orphan_already_absent";
  }

  // Fail closed: no timestamp ⇒ never old enough to delete.
  if (!head.lastModified) return "skipped_no_timestamp";
  if (!isGraceElapsed(head.lastModified, ctx.t0)) return "skipped_young";

  // Final lease check before the intent (a live foreign holder owns storage).
  if (!(await holdsLease(ctx.db, ctx.runId))) return "skipped_lease";

  const evidence = captureEvidence(head);
  let intent;
  try {
    intent = await ctx.db.$transaction(async (tx) => {
      await takeOverStaleIntent(tx, key);
      return createDeletionIntent(tx, { r2Key: key, evidence });
    });
  } catch (error) {
    if (error instanceof AdminError && error.code === "CONFLICT") return "skipped_conflict";
    throw error;
  }

  // FINAL holdsLease immediately before DeleteObject (unfenceable
  // check→request race documented in docs/BACKEND.md).
  if (!(await holdsLease(ctx.db, ctx.runId))) return "skipped_lease";

  await storage.deleteObject(key);

  const confirm = await storage.headObject(key);
  if (confirm.found) return "failed_confirm"; // receipt stays pending → next run recovers

  await ctx.db.$transaction(async (tx) => {
    const done = await finalizeDeletion(tx, intent.receiptId, {
      staffId: null,
      action: "dentalfile.delete",
      entityType: "DentalFile",
      entityId: null,
      metadata: {
        trigger: "orphan",
        r2Key: key,
        eventNo: intent.eventNo,
        ageMs: ctx.t0.getTime() - head.lastModified!.getTime(),
      },
    });
    if (!done) {
      // Another worker finalised the same receipt first — the audit above
      // is intentionally skipped (gate already consumed).
    }
  });

  return "orphan_deleted";
}

async function jobReconcile(ctx: RunContext): Promise<JobResult> {
  const result: JobResult = {
    job: "reconcile",
    processed: 0,
    counts: { keys_scanned: 0, orphan_deleted: 0, orphan_already_absent: 0, skipped_young: 0, skipped_row_backed: 0, skipped_no_timestamp: 0, skipped_lease: 0, skipped_conflict: 0, failed_confirm: 0, failed_error: 0 },
  };
  if (!ctx.storage) {
    result.skipped = "no_storage";
    return result;
  }
  if (ctx.budget <= 0) {
    result.skipped = "budget";
    ctx.stoppedBy = "budget";
    return result;
  }
  if (Date.now() >= ctx.deadline) {
    result.skipped = "deadline";
    ctx.stoppedBy = "deadline";
    return result;
  }

  const state = await ctx.db.storageScanState.findUnique({
    where: { id: SCAN_STATE_ID },
    select: { lastScannedKey: true, leaseOwner: true },
  });
  // The cursor may only be trusted while WE hold the lease (we do — the
  // run lease was acquired at start), and must be shape-valid.
  const cursor =
    state && state.leaseOwner === ctx.runId && isShapeValidCursor(state.lastScannedKey)
      ? state.lastScannedKey
      : null;

  let startAfter: string | null = cursor;
  let keysThisRun = 0;
  let cycleComplete = false;

  while (keysThisRun < MAX_KEYS_PER_RUN) {
    if (Date.now() >= ctx.deadline) {
      ctx.stoppedBy = "deadline";
      break;
    }
    if (!(await holdsLease(ctx.db, ctx.runId))) {
      result.skipped = "lease_lost";
      ctx.stoppedBy = "lease_busy";
      break;
    }

    const page = await ctx.storage.listObjects({
      prefix: DENTAL_PREFIX,
      startAfter,
      maxKeys: PREPASS_LIMIT,
    });

    for (const object of page.objects) {
      if (keysThisRun >= MAX_KEYS_PER_RUN) break;
      if (Date.now() >= ctx.deadline) {
        ctx.stoppedBy = "deadline";
        break;
      }
      keysThisRun += 1;
      result.counts.keys_scanned = keysThisRun;

      // ROW CHECK FIRST, filter-free: an object with a DentalFile row is
      // NEVER orphan-deleted, regardless of status or soft-delete flags.
      const row = await ctx.db.dentalFile.findUnique({
        where: { r2Key: object.key },
        select: { id: true },
      });
      if (row) {
        // Diagnostic audit only when the object LOOKS old enough that a
        // naive reconciler would have deleted it — the row protects it.
        if (object.lastModified && isGraceElapsed(object.lastModified, ctx.t0)) {
          await ctx.db.auditLog.create({
            data: {
              staffId: null,
              action: "dentalfile.orphan_row_backed",
              entityType: "DentalFile",
              entityId: row.id,
              metadata: { r2Key: object.key },
            },
          });
        }
        result.counts.skipped_row_backed = (result.counts.skipped_row_backed ?? 0) + 1;
        continue;
      }

      // Every outcome is tallied ONCE by the caller from the returned tag.
      // F-2: isolate a per-item storage failure so later orphans still get
      // processed; a global database failure aborts the run (lease is
      // released by `finally`), and a failed item is NEVER tallied as an
      // outcome it did not achieve (no receipt, no audit — a later run
      // retries it from scratch).
      let outcome: OrphanOutcome;
      try {
        outcome = await deleteOrphanObject(ctx, object.key, object.lastModified);
      } catch (error) {
        if (isDatabaseFailure(error)) throw error;
        outcome = "failed_error";
        console.error(
          `[dental-cleanup] jobReconcile item failed (run=${ctx.runId} key=${object.key}):`,
          error instanceof Error ? error.message : error,
        );
      }
      result.counts[outcome] = (result.counts[outcome] ?? 0) + 1;
      result.processed += 1;
      // Shared item budget also bounds Job D's deletions/HEADs per run.
      ctx.budget -= 1;
      if (ctx.budget <= 0) {
        ctx.stoppedBy = "budget";
        break;
      }
    }

    // Persist the durable cursor (only while we hold the lease).
    const lastKey = page.objects.length > 0 ? page.objects[page.objects.length - 1].key : null;
    if (lastKey && isShapeValidCursor(lastKey)) {
      await ctx.db.storageScanState.update({
        where: { id: SCAN_STATE_ID },
        data: { lastScannedKey: lastKey, updatedAt: new Date() },
      });
      startAfter = lastKey;
    }

    if (ctx.budget <= 0 || Date.now() >= ctx.deadline) break;
    if (!page.isTruncated || !page.nextStartAfter) {
      cycleComplete = true;
      break;
    }
  }

  if (cycleComplete) {
    // Cycle finished → reset the cursor so the next run starts fresh.
    await ctx.db.storageScanState.update({
      where: { id: SCAN_STATE_ID },
      data: { lastScannedKey: null, updatedAt: new Date() },
    });
    result.cursorComplete = true;
  }

  return result;
}

/* ------------------------------------------------------------------ *
 * Run orchestration
 * ------------------------------------------------------------------ */

/**
 * Executes one cleanup run. Returns `leaseAcquired: false` when another
 * live run holds the lease (route maps that to 409 CONFLICT).
 *
 * `mode: "throttle"` runs Jobs B → A → C only (10 items / 60 s) — the
 * lightweight endpoint an admin can call frequently. `mode: "full"` runs
 * B → A → C → D (100 items / 240 s) — manual full runs and the cron.
 */
export async function runCleanup(mode: CleanupMode): Promise<CleanupRunResult> {
  const prisma = getPrisma();
  if (!prisma) {
    throw new AdminError(
      "SERVICE_UNAVAILABLE",
      "Cleanup is temporarily unavailable — the database is not configured.",
    );
  }

  const runId = newRunId();
  const startedAt = new Date();
  const storage = getStorage();

  const leaseOk = await tryAcquireLease(prisma, runId, LEASE_MS);
  if (!leaseOk) {
    return {
      runId,
      mode,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      t0: startedAt.toISOString(),
      leaseAcquired: false,
      stoppedBy: "lease_busy",
      jobs: [],
      cursor: null,
      cursorCycleComplete: false,
    };
  }

  const ctx: RunContext = {
    db: prisma,
    runId,
    t0: await dbNow(prisma),
    deadline: Date.now() + (mode === "full" ? FULL_DEADLINE_MS : THROTTLE_DEADLINE_MS),
    budget: mode === "full" ? FULL_BUDGET : THROTTLE_BUDGET,
    storage,
    stoppedBy: "complete",
  };

  const jobs: JobResult[] = [];
  try {
    // Job order B → A → C (→ D for full runs).
    jobs.push(await jobSweep(ctx));
    jobs.push(await jobDelete(ctx));
    jobs.push(await jobPurge(ctx));
    if (mode === "full") {
      jobs.push(await jobReconcile(ctx));
    }
  } finally {
    await releaseLease(prisma, runId);
  }

  const state = await prisma.storageScanState.findUnique({
    where: { id: SCAN_STATE_ID },
    select: { lastScannedKey: true },
  });

  return {
    runId,
    mode,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    t0: ctx.t0.toISOString(),
    leaseAcquired: true,
    stoppedBy: ctx.stoppedBy,
    jobs,
    cursor: state?.lastScannedKey ?? null,
    cursorCycleComplete: jobs.some((job) => job.cursorComplete === true),
  };
}
