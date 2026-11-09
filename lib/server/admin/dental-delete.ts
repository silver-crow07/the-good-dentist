/**
 * Shared deletion + lease primitives for Phase D storage cleanup (txA / txB).
 *
 * These are the concurrency-safety building blocks used by BOTH the
 * admin file-delete path and cleanup Jobs A–D:
 *
 *  - `createDeletionIntent` (txA): serialises every deletion intent behind
 *    the singleton StorageScanState row lock (SELECT … FOR UPDATE), reads a
 *    fresh DB clock AFTER the lock, allocates `MAX(eventNo)+1` per key and
 *    inserts the receipt — all before any DeleteObject may be issued. A
 *    P2002 (eventNo race or a second pending event for the key) aborts the
 *    intent; no external call happens on conflict.
 *
 *  - `finalizeDeletion` (txB): the exact-one-row gate
 *    `UPDATE … SET completedAt = clock_timestamp() WHERE id = $1 AND
 *    completedAt IS NULL` must affect exactly ONE row or the whole
 *    transaction rolls back — the completion audit can never exist without
 *    its gate, and a double-finalise can never double-write.
 *
 *  - `holdsLease`: the final predicate evaluated immediately before every
 *    DeleteObject. A lease held by ANOTHER live worker blocks the delete
 *    (the check→request race itself is unfenceable and documented in
 *    docs/BACKEND.md — DeleteObject is idempotent, so the worst case is a
 *    redundant delete of an already-absent key).
 *
 *  - Crash recovery: a pending receipt whose run died (no live lease
 *    holder) is completed by the next worker via `takeOverStaleIntent`
 *    BEFORE a fresh intent is created, so the partial unique index
 *    (`onePending`) never dead-locks the key forever.
 *
 * No audit rows are written here except through the explicit `audit`
 * parameter of `finalizeDeletion` (Job A / Job C write no audits — the
 * intent audit was already written atomically with the claim).
 */

import { Prisma, type PrismaClient } from "@/generated/prisma/client";

import type { PrismaTx } from "../db";
import { AdminError } from "./dashboard";
import { captureEvidence } from "../storage/pure";
import type { StorageAdapter } from "../storage/types";

/** Primary key of the singleton StorageScanState row. */
export const SCAN_STATE_ID = "dental_orphan_scan";

/** Lease duration (900 s) — one cleanup run holds it for its whole life. */
export const LEASE_MS = 900 * 1000;

/* ------------------------------------------------------------------ *
 * Clock + scan-state helpers
 * ------------------------------------------------------------------ */

/** Fresh DB clock (`clock_timestamp()` — never the app clock). */
export async function dbNow(db: PrismaTx): Promise<Date> {
  const rows = await db.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  return rows[0]?.now ?? new Date();
}

/**
 * Ensures the singleton scan-state row exists (the migration is DDL-only
 * and inserts no data) and takes the row lock for this transaction.
 */
export async function lockScanState(tx: PrismaTx): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO "StorageScanState" ("id", "updatedAt")
    VALUES (${SCAN_STATE_ID}, clock_timestamp())
    ON CONFLICT ("id") DO NOTHING`;
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "StorageScanState" WHERE "id" = ${SCAN_STATE_ID} FOR UPDATE`;
  if (rows.length !== 1) {
    throw new AdminError("CONFLICT", "Could not lock the storage scan state row.");
  }
}

/* ------------------------------------------------------------------ *
 * Lease (one lease per cleanup run)
 * ------------------------------------------------------------------ */

export type LeaseView = { owner: string | null; expiresAt: Date | null };

export async function readLease(db: PrismaTx): Promise<LeaseView> {
  await db.$executeRaw`
    INSERT INTO "StorageScanState" ("id", "updatedAt")
    VALUES (${SCAN_STATE_ID}, clock_timestamp())
    ON CONFLICT ("id") DO NOTHING`;
  const rows = await db.$queryRaw<Array<{ leaseOwner: string | null; leaseExpiresAt: Date | null }>>`
    SELECT "leaseOwner", "leaseExpiresAt" FROM "StorageScanState" WHERE "id" = ${SCAN_STATE_ID}`;
  return { owner: rows[0]?.leaseOwner ?? null, expiresAt: rows[0]?.leaseExpiresAt ?? null };
}

/**
 * Attempts to acquire (or refresh) the run lease. Succeeds when the lease
 * is free, expired, or already owned by `owner` (re-entrant for the same
 * run). Uses the DB clock for expiry — never the app clock.
 */
export async function tryAcquireLease(
  db: PrismaTx,
  owner: string,
  leaseMs: number = LEASE_MS,
): Promise<boolean> {
  await db.$executeRaw`
    INSERT INTO "StorageScanState" ("id", "updatedAt")
    VALUES (${SCAN_STATE_ID}, clock_timestamp())
    ON CONFLICT ("id") DO NOTHING`;
  const affected = await db.$executeRaw`
    UPDATE "StorageScanState"
       SET "leaseOwner" = ${owner},
           "leaseExpiresAt" = clock_timestamp() + ${`${leaseMs} milliseconds`}::interval,
           "updatedAt" = clock_timestamp()
     WHERE "id" = ${SCAN_STATE_ID}
       AND ("leaseOwner" IS NULL
            OR "leaseExpiresAt" < clock_timestamp()
            OR "leaseOwner" = ${owner})`;
  return affected === 1;
}

export async function releaseLease(db: PrismaTx, owner: string): Promise<void> {
  await db.$executeRaw`
    UPDATE "StorageScanState"
       SET "leaseOwner" = NULL, "leaseExpiresAt" = NULL, "updatedAt" = clock_timestamp()
     WHERE "id" = ${SCAN_STATE_ID} AND "leaseOwner" = ${owner}`;
}

/**
 * The final predicate before EVERY DeleteObject:
 *   - `ownerId === null` (admin path) → the lease must be FREE,
 *   - `ownerId === run id` (cleanup path) → the lease must be free OR ours.
 *
 * Returns false when another live worker owns the storage right now —
 * the caller must skip the physical delete and leave the intent for the
 * lease holder / next run.
 */
export async function holdsLease(db: PrismaTx, ownerId: string | null): Promise<boolean> {
  const lease = await readLease(db);
  const now = await dbNow(db);
  const live = lease.expiresAt !== null && lease.expiresAt.getTime() > now.getTime();
  if (!lease.owner || !live) return true; // free or expired
  if (ownerId !== null && lease.owner === ownerId) return true;
  return false;
}

/* ------------------------------------------------------------------ *
 * txA — deletion intent (durable BEFORE any DeleteObject)
 * ------------------------------------------------------------------ */

export type DeletionIntent = {
  receiptId: string;
  eventNo: number;
  intentAt: Date;
};

/**
 * Creates the deletion receipt for one key. MUST be called inside a
 * transaction; the scan-state row lock serialises intents across workers.
 *
 * Throws CONFLICT (aborting the transaction → no DeleteObject) when:
 *  - a PENDING event already exists for the key (onePending index), or
 *  - the (r2Key, eventNo) pair collides (never-reuse rule).
 */
export async function createDeletionIntent(
  tx: PrismaTx,
  params: { r2Key: string; evidence?: unknown },
): Promise<DeletionIntent> {
  await lockScanState(tx);

  // Fresh clock AFTER the lock: the intent instant can never precede the
  // serialisation point.
  const intentAt = await dbNow(tx);

  const pending = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "StorageDeletionReceipt"
     WHERE "r2Key" = ${params.r2Key} AND "completedAt" IS NULL`;
  if (pending.length > 0) {
    throw new AdminError(
      "CONFLICT",
      "A deletion for this object is already pending — aborting before any delete request.",
    );
  }

  const maxRows = await tx.$queryRaw<Array<{ next: number }>>`
    SELECT COALESCE(MAX("eventNo"), 0) + 1 AS next
      FROM "StorageDeletionReceipt" WHERE "r2Key" = ${params.r2Key}`;
  const eventNo = maxRows[0]?.next ?? 1;

  try {
    const created = await tx.storageDeletionReceipt.create({
      data: {
        r2Key: params.r2Key,
        eventNo,
        evidence: (params.evidence ?? undefined) as Prisma.InputJsonValue | undefined,
        createdAt: intentAt,
      },
      select: { id: true, eventNo: true, createdAt: true },
    });
    return { receiptId: created.id, eventNo: created.eventNo, intentAt: created.createdAt };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2002" || error.code === "P2034")
    ) {
      throw new AdminError(
        "CONFLICT",
        "A concurrent deletion intent already exists for this object — aborting.",
      );
    }
    throw error;
  }
}

/* ------------------------------------------------------------------ *
 * txB — finalisation (exact-one-row gate + optional audit, atomic)
 * ------------------------------------------------------------------ */

export type FinalizeAudit = {
  staffId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata?: Prisma.InputJsonValue;
};

/**
 * Completes a receipt: the gate must affect exactly one row, otherwise the
 * transaction (and therefore the optional audit insert) rolls back.
 * Returns true when this call completed the receipt, false when it was
 * already completed (double-finalise is a no-op, never an error).
 */
export async function finalizeDeletion(
  tx: PrismaTx,
  receiptId: string,
  audit?: FinalizeAudit,
): Promise<boolean> {
  const affected = await tx.$executeRaw`
    UPDATE "StorageDeletionReceipt"
       SET "completedAt" = clock_timestamp()
     WHERE "id" = ${receiptId} AND "completedAt" IS NULL`;
  if (affected > 1) {
    throw new AdminError("CONFLICT", "Deletion receipt gate affected multiple rows.");
  }
  if (affected === 0) return false; // already completed elsewhere

  if (audit) {
    await tx.auditLog.create({
      data: {
        staffId: audit.staffId,
        action: audit.action,
        entityType: audit.entityType,
        entityId: audit.entityId,
        ...(audit.metadata !== undefined ? { metadata: audit.metadata } : {}),
      },
    });
  }
  return true;
}

/**
 * Crash recovery: completes a stale PENDING receipt left behind by a dead
 * run so the key can take a fresh intent. Only called when NO live lease
 * holder exists (checked by the caller via holdsLease) — a live worker's
 * in-flight intent is never stolen.
 */
export async function takeOverStaleIntent(tx: PrismaTx, r2Key: string): Promise<number> {
  const pending = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "StorageDeletionReceipt"
     WHERE "r2Key" = ${r2Key} AND "completedAt" IS NULL`;
  let completed = 0;
  for (const row of pending) {
    const done = await finalizeDeletion(tx, row.id);
    if (done) completed += 1;
  }
  return completed;
}

/* ------------------------------------------------------------------ *
 * Row-backed physical deletion (Job A + admin delete share this path)
 * ------------------------------------------------------------------ */

export type RowDeletionOutcome =
  | "deleted"
  | "already_absent"
  | "skipped_not_due"
  | "skipped_lease"
  | "skipped_conflict"
  | "failed_confirm";

export type RowFileRef = {
  id: string;
  r2Key: string;
  cleanupAfter: Date;
};

/**
 * Deletes ONE row-backed object with the full protocol:
 *
 *   1. fresh DB clock — `cleanupAfter <= now` (URL TTL + buffer) or skip,
 *   2. `holdsLease` pre-check (another live worker → skip),
 *   3. fresh HEAD (evidence; missing object → still finalise, delete is
 *      idempotent and the row must go),
 *   4. txA intent (stale-pending takeover first when the lease is free),
 *   5. FINAL `holdsLease` immediately before DeleteObject,
 *   6. DeleteObject,
 *   7. HEAD confirmation — only then txB finalise + remove the row.
 *
 * `ownerId` is the cleanup run id, or null for the admin path.
 * The DentalFile row is removed atomically with the receipt completion, so
 * a record's file count reaches zero exactly when its files are gone.
 */
export async function deleteRowBackedFile(
  db: PrismaClient,
  storage: StorageAdapter,
  file: RowFileRef,
  ownerId: string | null,
): Promise<RowDeletionOutcome> {
  // 1. Fresh DB clock guard (never the app clock).
  const now = await dbNow(db);
  if (file.cleanupAfter.getTime() > now.getTime()) return "skipped_not_due";

  // 2. Pre-check: a live foreign lease holder owns storage right now.
  if (!(await holdsLease(db, ownerId))) return "skipped_lease";

  // 3. Fresh HEAD — diagnostic evidence only (age is not a row-backed
  //    deletion predicate; the URL-TTL guard above already ran).
  const head = await storage.headObject(file.r2Key);
  const evidence = captureEvidence(head);

  // 4. Intent (txA), taking over any stale pending receipt first.
  let intent: DeletionIntent;
  try {
    intent = await db.$transaction(async (tx) => {
      await takeOverStaleIntent(tx, file.r2Key);
      return createDeletionIntent(tx, { r2Key: file.r2Key, evidence });
    });
  } catch (error) {
    if (error instanceof AdminError && error.code === "CONFLICT") return "skipped_conflict";
    throw error;
  }

  // 5. FINAL lease check immediately before the external request.
  if (!(await holdsLease(db, ownerId))) {
    // Intent stays pending; the next run takes it over (lease will be free
    // by then) — no DeleteObject was issued, so nothing is half-done.
    return "skipped_lease";
  }

  // 6. Physical delete (idempotent for absent keys).
  await storage.deleteObject(file.r2Key);

  // 7. HEAD confirmation BEFORE finalising.
  const confirm = await storage.headObject(file.r2Key);
  if (confirm.found) return "failed_confirm"; // receipt stays pending (retry later)

  await db.$transaction(async (tx) => {
    const gateOk = await finalizeDeletion(tx, intent.receiptId);
    if (!gateOk) {
      // Another worker completed the same receipt — the row removal below
      // is still correct (it is idempotent by primary key).
      const remaining = await tx.dentalFile.findUnique({
        where: { id: file.id },
        select: { id: true },
      });
      if (remaining) await tx.dentalFile.delete({ where: { id: file.id } });
      return;
    }
    await tx.dentalFile.deleteMany({ where: { id: file.id } });
  });

  return head.found ? "deleted" : "already_absent";
}
