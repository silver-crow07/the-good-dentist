/**
 * Phase D integration tests — storage cleanup workers (Jobs A–D), the run
 * lease, the manual endpoints and the cron route, against a REAL PostgreSQL
 * database with the in-memory storage adapter (no network, no R2).
 *
 * Covers:
 *  - manual endpoints: 401 / STAFF 403 / 405, GET = throttled sweep
 *    (Jobs B→A→C only, 10 items) vs POST = full run (B→A→C→D, 100 items),
 *    409 while another live run holds the lease, 429 after the shared
 *    per-staff budget of 10/min (GET + POST share the bucket) [F-4]
 *  - Job B: claims due PENDING/REJECTED uploads (cleanupAfter <= DB clock)
 *    or ANY file of a soft-deleted record, with an atomic
 *    `dentalfile.delete {trigger:"sweep"}` audit, NEVER touches
 *    cleanupAfter, NEVER claims a healthy AVAILABLE file on a live
 *    record [F-1]; shared-budget exhaustion stops the run (`budget`)
 *  - Job A: operation order HEAD → DeleteObject → HEAD, no audits, receipt
 *    completed + row removed atomically; not-due files untouched
 *  - per-item failure isolation [F-2]: a throwing DeleteObject/HEAD aborts
 *    only that item (failed_error counter), the run/Job C/Job D continue,
 *    no false completion receipts or success audits, lease released
 *  - Job C: purges soft-deleted records only when ZERO file rows remain
 *  - Job D (reconcile): 48 h grace from t0, row-backed objects are NEVER
 *    orphan-deleted (filter-free row check), fail-closed on missing
 *    timestamps, LIST timestamps are optimization-only (replace-between-
 *    LIST-and-HEAD), phantom LIST keys audited `orphan_already_absent`,
 *    stale pending receipts taken over (crash recovery), durable cursor
 *    cycles across more than one page then resets
 *  - cron route: fail-closed 503 without CRON_SECRET, 401 on a wrong/missing
 *    bearer — including WRONG-LENGTH and non-Bearer credentials, hashed
 *    constant-time compare with no length oracle [F-9] — 200 + full run
 *    with the right secret
 *  - concurrency: two simultaneous deletion intents for one key → exactly
 *    one wins, the other aborts with CONFLICT before any DeleteObject
 *  - the documented unfenceable check→request race: a lease that appears
 *    AFTER the final holdsLease() still lets the (idempotent) delete land
 *
 * Manifest ids exercised: [B*] sweep · [A*] delete · [C*] purge ·
 * [RC*] reconcile/orphans · [LR*] LIST/HEAD races · [LK*] lease ·
 * [CR*] cron · [FENC]/[DL] race · [F-1]/[F-2] regression guards ·
 * [F-4] cleanup rate limit · [F-9] bearer compare ·
 * [KK] (covered in dental-files).
 *
 * Gating + disposable-DB assumption identical to the other Phase D suites.
 */

import "dotenv/config";

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

// Refuse — loudly, before any query runs — to touch anything that is not a
// disposable database (see tests/integration/db-guard.ts).
import { assertDisposableDatabase } from "./db-guard";
assertDisposableDatabase(process.env.DATABASE_URL);

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST as recordPost } from "@/app/api/admin/dental-records/route";
import {
  GET as cleanupGet,
  POST as cleanupPost,
  DELETE as cleanupDelete,
} from "@/app/api/admin/dental-records/cleanup/route";
import { GET as cronGet } from "@/app/api/cron/dental-storage-cleanup/route";
import { AdminError } from "@/lib/server/admin/dashboard";
import {
  createDeletionIntent,
  releaseLease,
  SCAN_STATE_ID,
  tryAcquireLease,
} from "@/lib/server/admin/dental-delete";
import { runCleanup } from "@/lib/server/admin/dental-cleanup";
import { hashPassword } from "@/lib/server/auth";
import { getPrisma } from "@/lib/server/db";
import { resetRateLimits } from "@/lib/server/rate-limit";
import { setStorageForTests } from "@/lib/server/storage";
import { MemoryStorage } from "@/lib/server/storage/memory";
import { GRACE_MS } from "@/lib/server/storage/pure";

import { authed, jpegBytes, login, makeRequest, wipeAllData } from "./dental-helpers";

const prisma = getPrisma();
const describeDb = prisma ? describe : describe.skip;

let ipSeq = 900;
function nextIp(): string {
  ipSeq += 1;
  return `10.90.2.${ipSeq % 250}`;
}

function request(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
  auth?: { headers: Record<string, string> },
) {
  const merged = auth ? { ...init, headers: { ...init.headers, ...auth.headers } } : init;
  return makeRequest(path, merged, nextIp());
}

/** Wipes ONLY the dental/storage tables + audits (staff/sessions survive). */
async function resetDental(): Promise<void> {
  if (!prisma) return;
  await prisma.storageDeletionReceipt.deleteMany({});
  await prisma.dentalFile.deleteMany({});
  await prisma.dentalRecord.deleteMany({});
  await prisma.r2KeyRegistry.deleteMany({});
  await prisma.storageScanState.deleteMany({});
  await prisma.auditLog.deleteMany({});
}

let fileSeq = 0;

type SeedFileOptions = {
  status?: "PENDING" | "AVAILABLE" | "REJECTED" | "DELETING";
  /** true → cleanupAfter in the past (due), false → +10 min (not due). */
  due?: boolean;
  withObject?: boolean;
  lastModified?: Date | null;
};

describeDb("Storage cleanup — Jobs A–D, lease, cron (real PostgreSQL)", () => {
  let adminCookie = "";
  let staffCookie = "";
  let patientId = "";
  let storage: MemoryStorage;
  const originalCronSecret = process.env.CRON_SECRET;

  async function seedRecord(diagnosis = "Cleanup test record"): Promise<string> {
    const response = await recordPost(
      request(
        "/api/admin/dental-records",
        {
          method: "POST",
          body: { patientId, treatmentDate: "2026-11-03", diagnosis, treatmentDetails: "details" },
        },
        authed(adminCookie),
      ),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    return body.record.id as string;
  }

  async function seedFile(
    recordId: string,
    options: SeedFileOptions = {},
  ): Promise<{ id: string; r2Key: string }> {
    fileSeq += 1;
    const id = `ctestfile${String(fileSeq).padStart(4, "0")}`;
    const r2Key = `dental/${patientId}/${recordId}/${id}.jpg`;
    const row = await prisma!.dentalFile.create({
      data: {
        id,
        recordId,
        r2Key,
        originalName: `${id}.jpg`,
        contentType: "image/jpeg",
        byteSize: 100,
        status: options.status ?? "AVAILABLE",
        cleanupAfter: new Date(Date.now() + (options.due ? -1_000 : 600_000)),
      },
    });
    if (options.withObject !== false) {
      storage.seed(r2Key, {
        bytes: jpegBytes(100),
        ...(options.lastModified !== undefined ? { lastModified: options.lastModified } : {}),
      });
    }
    return { id: row.id, r2Key };
  }

  beforeAll(async () => {
    if (!prisma) return;
    const config = await prisma.clinicConfig.findUnique({ where: { id: "singleton" } });
    if (!config) {
      throw new Error("Database is not seeded — run: npx prisma migrate deploy && npm run db:seed");
    }

    await wipeAllData(prisma);

    const suffix = Date.now();
    const password = "dental-cleanup-test-pw-123";
    await prisma.staff.create({
      data: {
        email: `admin-clean-${suffix}@example.test`,
        fullName: "Admin CleanTest",
        passwordHash: await hashPassword(password),
        role: "ADMIN",
        active: true,
      },
    });
    await prisma.staff.create({
      data: {
        email: `staff-clean-${suffix}@example.test`,
        fullName: "Staff CleanTest",
        passwordHash: await hashPassword(password),
        role: "STAFF",
        active: true,
      },
    });
    adminCookie = await login(`admin-clean-${suffix}@example.test`, password, nextIp());
    staffCookie = await login(`staff-clean-${suffix}@example.test`, password, nextIp());

    const patient = await prisma.patient.create({
      data: { fullName: "Vikram Rao", phone: "9876512345" },
    });
    patientId = patient.id;
  });

  beforeEach(async () => {
    storage = new MemoryStorage();
    setStorageForTests(storage);
    // The cleanup endpoints are rate limited per staff id [F-4] — buckets
    // are per-process, so reset them or one test's budget bleeds into the
    // next test's endpoint assertions.
    resetRateLimits();
    await resetDental();
  });

  afterAll(async () => {
    if (!prisma) return;
    setStorageForTests(null);
    if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalCronSecret;
    await wipeAllData(prisma);
  });

  /* ---------------- endpoints: auth + mode ---------------- */

  it("401s / 403s / 405s the manual cleanup endpoints", async () => {
    expect((await cleanupGet(request("/api/admin/dental-records/cleanup"))).status).toBe(401);
    expect(
      (await cleanupPost(request("/api/admin/dental-records/cleanup", { method: "POST", body: {} }))).status,
    ).toBe(401);
    expect(
      (await cleanupGet(request("/api/admin/dental-records/cleanup", {}, authed(staffCookie)))).status,
    ).toBe(403);
    expect(
      (
        await cleanupPost(
          request("/api/admin/dental-records/cleanup", { method: "POST", body: {} }, authed(staffCookie)),
        )
      ).status,
    ).toBe(403);

    const wrong = await cleanupDelete();
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get("allow")).toBe("GET, POST");
  });

  it("GET runs the THROTTLED sweep (Jobs B→A→C only); POST adds Job D", async () => {
    const throttle = await cleanupGet(
      request("/api/admin/dental-records/cleanup", {}, authed(adminCookie)),
    );
    expect(throttle.status).toBe(200);
    expect(throttle.headers.get("cache-control")).toBe("no-store");
    const throttleBody = await throttle.json();
    expect(throttleBody.run.mode).toBe("throttle");
    expect(throttleBody.run.leaseAcquired).toBe(true);
    expect(throttleBody.run.stoppedBy).toBe("complete");
    expect(throttleBody.run.jobs.map((job: { job: string }) => job.job)).toEqual([
      "sweep",
      "delete",
      "purge",
    ]);

    const full = await cleanupPost(
      request("/api/admin/dental-records/cleanup", { method: "POST", body: {} }, authed(adminCookie)),
    );
    expect(full.status).toBe(200);
    const fullBody = await full.json();
    expect(fullBody.run.mode).toBe("full");
    expect(fullBody.run.jobs.map((job: { job: string }) => job.job)).toEqual([
      "sweep",
      "delete",
      "purge",
      "reconcile",
    ]);

    // The route caps the function duration at the approved 300 s.
    const routeModule = await import("@/app/api/admin/dental-records/cleanup/route");
    expect(routeModule.maxDuration).toBe(300);
  });

  it("409s while ANOTHER live run holds the lease, then recovers", async () => {
    const acquired = await tryAcquireLease(prisma!, "run_busy_external");
    expect(acquired).toBe(true);
    try {
      const response = await cleanupGet(
        request("/api/admin/dental-records/cleanup", {}, authed(adminCookie)),
      );
      expect(response.status).toBe(409);
      expect((await response.json()).error.code).toBe("CONFLICT");

      const full = await cleanupPost(
        request("/api/admin/dental-records/cleanup", { method: "POST", body: {} }, authed(adminCookie)),
      );
      expect(full.status).toBe(409);
    } finally {
      await releaseLease(prisma!, "run_busy_external");
    }

    const after = await cleanupGet(
      request("/api/admin/dental-records/cleanup", {}, authed(adminCookie)),
    );
    expect(after.status).toBe(200);
  });

  it("429s the cleanup endpoints after the shared per-staff budget (10/min) [F-4]", async () => {
    // Exhaust the shared bucket with legitimate throttled sweeps.
    for (let i = 0; i < 10; i += 1) {
      const response = await cleanupGet(
        request("/api/admin/dental-records/cleanup", {}, authed(adminCookie)),
      );
      expect(response.status).toBe(200);
    }

    const limitedGet = await cleanupGet(
      request("/api/admin/dental-records/cleanup", {}, authed(adminCookie)),
    );
    expect(limitedGet.status).toBe(429);
    expect((await limitedGet.json()).error.code).toBe("RATE_LIMITED");
    expect(Number(limitedGet.headers.get("retry-after"))).toBeGreaterThan(0);

    // POST shares the SAME bucket: switching modes cannot bypass the limit.
    const limitedPost = await cleanupPost(
      request("/api/admin/dental-records/cleanup", { method: "POST", body: {} }, authed(adminCookie)),
    );
    expect(limitedPost.status).toBe(429);

    // Auth is evaluated BEFORE the limiter: an unauthenticated call is a
    // clean 401, never a 429 (and never a run).
    const anon = await cleanupGet(request("/api/admin/dental-records/cleanup"));
    expect(anon.status).toBe(401);
  });

  /* ---------------- Job B — sweep / claim ---------------- */

  it("Job B claims the THROTTLE budget (10) due files atomically and stops on budget", async () => {
    const recordId = await seedRecord();
    const files: Array<{ id: string; r2Key: string }> = [];
    for (let i = 0; i < 12; i += 1) {
      // Due PENDING files = abandoned uploads (the sweep's canonical input).
      // Healthy AVAILABLE files on a live record are NEVER claimable [F-1].
      files.push(await seedFile(recordId, { status: "PENDING", due: true }));
    }

    const run = await runCleanup("throttle");
    expect(run.stoppedBy).toBe("budget");
    expect(run.jobs[0]).toMatchObject({ job: "sweep", processed: 10 });
    expect(run.jobs[0].counts.claimed).toBe(10);
    // Shared budget exhausted by the claims → Job A/C did not run.
    expect(run.jobs[1]).toMatchObject({ job: "delete", skipped: "budget" });
    expect(run.jobs[2]).toMatchObject({ job: "purge", skipped: "budget" });

    // 10 claimed (DELETING), 2 untouched (still PENDING — beyond the budget).
    expect(await prisma!.dentalFile.count({ where: { status: "DELETING" } })).toBe(10);
    expect(await prisma!.dentalFile.count({ where: { status: "PENDING" } })).toBe(2);

    // Exactly one atomic intent audit per claim, trigger "sweep".
    const audits = await prisma!.auditLog.findMany({ where: { action: "dentalfile.delete" } });
    expect(audits).toHaveLength(10);
    for (const audit of audits) {
      expect((audit.metadata as { trigger?: string }).trigger).toBe("sweep");
      expect(audit.staffId).toBeNull();
    }

    // Claims NEVER touch cleanupAfter — one claimed file keeps its value.
    const claimed = await prisma!.dentalFile.findFirst({ where: { status: "DELETING" } });
    const original = files.find((file) => file.id === claimed!.id);
    expect(original).toBeTruthy();
    const fresh = await prisma!.dentalFile.findUnique({ where: { id: claimed!.id } });
    expect(fresh!.cleanupAfter.getTime()).toBeLessThan(Date.now());
  });

  it("Job B never claims a not-due file on a live record", async () => {
    const recordId = await seedRecord();
    await seedFile(recordId, { due: false });

    const run = await runCleanup("throttle");
    expect(run.jobs[0].counts.claimed).toBe(0);
    expect(await prisma!.dentalFile.count({ where: { status: "AVAILABLE" } })).toBe(1);
    expect(await prisma!.auditLog.count({ where: { action: "dentalfile.delete" } })).toBe(0);
  });

  it("Job B NEVER claims a DUE AVAILABLE file on a live record — it survives cleanup intact [F-1]", async () => {
    const recordId = await seedRecord();
    const file = await seedFile(recordId, { status: "AVAILABLE", due: true });
    storage.resetCalls();

    const run = await runCleanup("full");
    // Not claimed, not deleted, not audited — the record is live and the
    // file is healthy; an elapsed cleanupAfter (URL-TTL window) is NOT a
    // deletion trigger for an AVAILABLE file [F-1].
    expect(run.jobs[0].counts.claimed).toBe(0);
    expect(run.jobs[1].counts.deleted).toBe(0);
    expect(run.jobs[3].counts.orphan_deleted ?? 0).toBe(0);

    const row = await prisma!.dentalFile.findUnique({ where: { id: file.id } });
    expect(row?.status).toBe("AVAILABLE");
    expect(storage.deleteCalls).toEqual([]);
    expect(storage.has(file.r2Key)).toBe(true);
    expect(await prisma!.auditLog.count({ where: { action: "dentalfile.delete" } })).toBe(0);
    expect(await prisma!.storageDeletionReceipt.count()).toBe(0);
  });

  it("Job B still claims due PENDING and REJECTED files, and Job A physically deletes them", async () => {
    const recordId = await seedRecord();
    const pending = await seedFile(recordId, { status: "PENDING", due: true });
    const rejected = await seedFile(recordId, { status: "REJECTED", due: true });

    const run = await runCleanup("throttle");
    expect(run.jobs[0].counts.claimed).toBe(2);
    expect(run.jobs[1].counts.deleted).toBe(2);

    expect(storage.has(pending.r2Key)).toBe(false);
    expect(storage.has(rejected.r2Key)).toBe(false);
    expect(await prisma!.dentalFile.findUnique({ where: { id: pending.id } })).toBeNull();
    expect(await prisma!.dentalFile.findUnique({ where: { id: rejected.id } })).toBeNull();
    // Exactly two sweep intent audits (Job A writes none) and no receipt
    // left pending behind a completed deletion.
    expect(await prisma!.auditLog.count({ where: { action: "dentalfile.delete" } })).toBe(2);
    expect(await prisma!.storageDeletionReceipt.count({ where: { completedAt: null } })).toBe(0);
  });

  it("Job B still claims an AVAILABLE file on a SOFT-DELETED record, and Job A deletes it", async () => {
    const recordId = await seedRecord();
    const file = await seedFile(recordId, { status: "AVAILABLE", due: true });
    await prisma!.dentalRecord.update({
      where: { id: recordId },
      data: { deletedAt: new Date() },
    });

    const run = await runCleanup("throttle");
    expect(run.jobs[0].counts.claimed).toBe(1);
    expect(run.jobs[1].counts.deleted).toBe(1);
    expect(storage.deleteCalls).toEqual([file.r2Key]);
    expect(await prisma!.dentalFile.findUnique({ where: { id: file.id } })).toBeNull();
    expect(await prisma!.storageDeletionReceipt.count({ where: { completedAt: null } })).toBe(0);

    const audit = await prisma!.auditLog.findFirst({ where: { action: "dentalfile.delete" } });
    expect((audit?.metadata as { trigger?: string }).trigger).toBe("sweep");
  });

  it("Job B never re-claims an already-DELETING file (no duplicate sweep audit)", async () => {
    const recordId = await seedRecord();
    const file = await seedFile(recordId, { status: "DELETING", due: true });

    const run = await runCleanup("throttle");
    expect(run.jobs[0].counts.claimed).toBe(0);
    // Job A still processes it exactly once (and writes no audits of its own).
    expect(run.jobs[1].counts.deleted).toBe(1);
    expect(storage.has(file.r2Key)).toBe(false);
    expect(await prisma!.auditLog.count({ where: { action: "dentalfile.delete" } })).toBe(0);
    expect(await prisma!.storageDeletionReceipt.count()).toBe(1);
  });

  /* ---------------- Job A — physical deletion ---------------- */

  it("Job A deletes a claimed file: HEAD → DeleteObject → HEAD, receipt + row, NO audits", async () => {
    const recordId = await seedRecord();
    const file = await seedFile(recordId, { status: "DELETING", due: true });
    storage.resetCalls();

    const run = await runCleanup("throttle");
    const jobA = run.jobs[1];
    expect(jobA.processed).toBe(1);
    expect(jobA.counts.deleted).toBe(1);
    expect(run.stoppedBy).toBe("complete");

    // Exact operation order for the row-backed delete protocol.
    const ops = storage.calls
      .filter((call) => call.op === "head" || call.op === "delete")
      .map((call) => call.op);
    expect(ops).toEqual(["head", "delete", "head"]);
    expect(storage.deleteCalls).toEqual([file.r2Key]);
    expect(storage.has(file.r2Key)).toBe(false);

    // Receipt completed (txB gate) with HEAD evidence; row removed.
    const receipt = await prisma!.storageDeletionReceipt.findFirst({
      where: { r2Key: file.r2Key },
    });
    expect(receipt?.completedAt).not.toBeNull();
    expect(receipt?.eventNo).toBe(1);
    expect(receipt?.evidence).toMatchObject({ size: 100 });
    expect(await prisma!.dentalFile.findUnique({ where: { id: file.id } })).toBeNull();

    // Job A writes NO audits of its own — the only row in the log is
    // seedRecord's own dentalrecord.create.
    expect(await prisma!.auditLog.count({ where: { action: { not: "dentalrecord.create" } } })).toBe(0);
  });

  it("Job A leaves a claimed-but-not-due file alone (URL-TTL guard)", async () => {
    const recordId = await seedRecord();
    const file = await seedFile(recordId, { status: "DELETING", due: false });

    const run = await runCleanup("throttle");
    expect(run.jobs[1].processed).toBe(0);
    expect(storage.deleteCalls).toEqual([]);
    expect(storage.has(file.r2Key)).toBe(true);
    const row = await prisma!.dentalFile.findUnique({ where: { id: file.id } });
    expect(row?.status).toBe("DELETING");
    // No receipt was ever created for an object that was not deleted.
    expect(await prisma!.storageDeletionReceipt.count()).toBe(0);
  });

  it("isolates ONE failing DeleteObject: the run, Job C and the lease all survive [F-2]", async () => {
    const recordId = await seedRecord();
    const failing = await seedFile(recordId, { status: "DELETING", due: true });
    const succeeding = await seedFile(recordId, { status: "DELETING", due: true });
    // Deterministic FIFO order: the failing file is examined first.
    await prisma!.dentalFile.update({
      where: { id: failing.id },
      data: { cleanupAfter: new Date(Date.now() - 60_000) },
    });
    await prisma!.dentalFile.update({
      where: { id: succeeding.id },
      data: { cleanupAfter: new Date(Date.now() - 30_000) },
    });
    // One-shot storage failure for the FIRST key only.
    storage.deleteErrors.set(failing.r2Key, new Error("injected R2 delete failure"));

    // A soft-deleted EMPTY record proves Job C still runs after the failure.
    const emptyRecordId = await seedRecord("Empty soft-deleted for F-2");
    await prisma!.dentalRecord.update({
      where: { id: emptyRecordId },
      data: { deletedAt: new Date() },
    });

    const run = await runCleanup("throttle");
    expect(run.stoppedBy).toBe("complete");

    const jobA = run.jobs[1];
    expect(jobA.processed).toBe(2);
    expect(jobA.counts.failed_error).toBe(1);
    expect(jobA.counts.deleted).toBe(1);

    // Job C continued after the isolated per-item failure.
    const jobC = run.jobs[2];
    expect(jobC.skipped).toBeUndefined();
    expect(jobC.counts.purged).toBe(1);
    expect(await prisma!.dentalRecord.findUnique({ where: { id: emptyRecordId } })).toBeNull();

    // The failed item: txA intent exists but is NEVER falsely completed —
    // no completed receipt, no success audit, row stays DELETING, object intact.
    const failedReceipts = await prisma!.storageDeletionReceipt.findMany({
      where: { r2Key: failing.r2Key },
    });
    expect(failedReceipts).toHaveLength(1);
    expect(failedReceipts[0].completedAt).toBeNull();
    const failedRow = await prisma!.dentalFile.findUnique({ where: { id: failing.id } });
    expect(failedRow?.status).toBe("DELETING");
    expect(storage.has(failing.r2Key)).toBe(true);

    // The second item was still processed and completed normally.
    expect(storage.has(succeeding.r2Key)).toBe(false);
    expect(await prisma!.dentalFile.findUnique({ where: { id: succeeding.id } })).toBeNull();
    const okReceipt = await prisma!.storageDeletionReceipt.findFirst({
      where: { r2Key: succeeding.r2Key },
    });
    expect(okReceipt?.completedAt).not.toBeNull();

    // Job A writes no audits at all — nothing claims success for the failure.
    expect(
      await prisma!.auditLog.count({ where: { action: { startsWith: "dentalfile." } } }),
    ).toBe(0);

    // The lease was released by the run's finally block.
    const state = await prisma!.storageScanState.findUnique({ where: { id: SCAN_STATE_ID } });
    expect(state?.leaseOwner).toBeNull();
  });

  /* ---------------- Job C — purge ---------------- */

  it("Job C purges soft-deleted records only when zero file rows remain", async () => {
    const emptyRecord = await seedRecord("Soft-deleted, no files");
    const guardedRecord = await seedRecord("Soft-deleted, file pending");
    await seedFile(guardedRecord, { due: false });

    await prisma!.dentalRecord.update({
      where: { id: emptyRecord },
      data: { deletedAt: new Date() },
    });
    await prisma!.dentalRecord.update({
      where: { id: guardedRecord },
      data: { deletedAt: new Date() },
    });

    const run = await runCleanup("throttle");
    const jobC = run.jobs[2];
    expect(jobC.processed).toBe(1);
    expect(jobC.counts.purged).toBe(1);

    expect(await prisma!.dentalRecord.findUnique({ where: { id: emptyRecord } })).toBeNull();
    // The guarded record still has a file row → NOT purged.
    const guarded = await prisma!.dentalRecord.findUnique({ where: { id: guardedRecord } });
    expect(guarded).not.toBeNull();
    expect(guarded?.deletedAt).not.toBeNull();
    // Its file WAS claimed by Job B (soft-deleted record ⇒ due immediately).
    expect(await prisma!.dentalFile.count({ where: { recordId: guardedRecord, status: "DELETING" } })).toBe(1);
    // Job C writes NO audits — the only dentalfile audit is Job B's sweep
    // claim (the two dentalrecord.create rows come from seedRecord itself).
    expect(await prisma!.auditLog.count({ where: { action: { startsWith: "dentalfile." } } })).toBe(1);
  });

  /* ---------------- Job D — orphan reconciliation ---------------- */

  it("deletes an orphan past the 48 h grace (full run) with an audited receipt", async () => {
    const old = new Date(Date.now() - GRACE_MS - 3_600_000);
    storage.seed("dental/pat_x/rec_x/orphan-old.jpg", { bytes: jpegBytes(100), lastModified: old });

    const run = await runCleanup("full");
    const jobD = run.jobs[3];
    expect(jobD.counts.orphan_deleted).toBe(1);
    expect(jobD.counts.keys_scanned).toBe(1);
    expect(run.stoppedBy).toBe("complete");
    expect(storage.deleteCalls).toEqual(["dental/pat_x/rec_x/orphan-old.jpg"]);

    // Audit + completed receipt with evidence.
    const audit = await prisma!.auditLog.findFirst({
      where: { action: "dentalfile.delete", entityId: null },
    });
    expect(audit).not.toBeNull();
    const metadata = audit?.metadata as { trigger?: string; r2Key?: string };
    expect(metadata.trigger).toBe("orphan");
    expect(metadata.r2Key).toBe("dental/pat_x/rec_x/orphan-old.jpg");

    const receipt = await prisma!.storageDeletionReceipt.findFirst({
      where: { r2Key: "dental/pat_x/rec_x/orphan-old.jpg" },
    });
    expect(receipt?.completedAt).not.toBeNull();
    expect(receipt?.evidence).toMatchObject({ size: 100, lastModified: expect.any(String) });
  });

  it("throttled sweeps NEVER run the reconciler; the full run does", async () => {
    const old = new Date(Date.now() - GRACE_MS - 3_600_000);
    storage.seed("dental/pat_x/rec_x/orphan-throttle.jpg", { bytes: jpegBytes(100), lastModified: old });

    await runCleanup("throttle");
    expect(storage.has("dental/pat_x/rec_x/orphan-throttle.jpg")).toBe(true);
    expect(storage.listCalls).toBe(0);
    expect(await prisma!.auditLog.count()).toBe(0);

    const full = await runCleanup("full");
    expect(full.jobs.map((job) => job.job)).toContain("reconcile");
    expect(full.jobs[3].counts.orphan_deleted).toBe(1);
    expect(storage.has("dental/pat_x/rec_x/orphan-throttle.jpg")).toBe(false);
  });

  it("NEVER orphan-deletes a row-backed object (filter-free row check) [RC]", async () => {
    const recordId = await seedRecord();
    const file = await seedFile(recordId, {
      status: "AVAILABLE",
      due: false,
      lastModified: new Date(Date.now() - GRACE_MS - 3_600_000),
    });
    storage.resetCalls();

    const run = await runCleanup("full");
    const jobD = run.jobs[3];
    expect(jobD.counts.skipped_row_backed).toBe(1);
    expect(jobD.counts.orphan_deleted ?? 0).toBe(0);

    // The object survives and DeleteObject was NEVER issued.
    expect(storage.has(file.r2Key)).toBe(true);
    expect(storage.deleteCalls).toEqual([]);

    // Diagnostic audit because the object LOOKED old enough to be swept.
    const audit = await prisma!.auditLog.findFirst({
      where: { action: "dentalfile.orphan_row_backed" },
    });
    expect(audit).not.toBeNull();
    expect(audit?.entityId).toBe(file.id);
    expect((audit?.metadata as { r2Key?: string }).r2Key).toBe(file.r2Key);
  });

  it("fails CLOSED on missing timestamps and skips young objects", async () => {
    // Null timestamp everywhere → never old enough (fail closed).
    storage.seed("dental/pat_x/rec_x/orphan-nullts.jpg", { bytes: jpegBytes(50), lastModified: null });
    // Young object → LIST optimization skips it without a HEAD.
    storage.seed("dental/pat_x/rec_x/orphan-young.jpg", { bytes: jpegBytes(50) });

    const run = await runCleanup("full");
    const jobD = run.jobs[3];
    expect(jobD.counts.skipped_no_timestamp).toBe(1);
    expect(jobD.counts.skipped_young).toBe(1);
    expect(jobD.counts.orphan_deleted ?? 0).toBe(0);
    expect(storage.deleteCalls).toEqual([]);
    expect(storage.has("dental/pat_x/rec_x/orphan-nullts.jpg")).toBe(true);
    expect(storage.has("dental/pat_x/rec_x/orphan-young.jpg")).toBe(true);
    expect(await prisma!.auditLog.count()).toBe(0);
  });

  it("uses the FRESH HEAD when an object is replaced between LIST and HEAD [LR1]", async () => {
    const key = "dental/pat_x/rec_x/orphan-replaced.jpg";
    const old = new Date(Date.now() - GRACE_MS - 3_600_000);
    storage.seed(key, { bytes: jpegBytes(100), lastModified: old });
    // LIST reports the OLD timestamp, then the object is replaced with a
    // fresh instance before HEAD runs → authoritative HEAD says "young".
    storage.afterList = () => storage.replace(key);

    const run = await runCleanup("full");
    expect(run.jobs[3].counts.skipped_young).toBe(1);
    expect(run.jobs[3].counts.orphan_deleted ?? 0).toBe(0);
    expect(storage.deleteCalls).toEqual([]);
    expect(storage.has(key)).toBe(true);
    expect(await prisma!.auditLog.count()).toBe(0);
  });

  it("audits a phantom LIST key as orphan_already_absent (idempotent delete)", async () => {
    const phantom = "dental/pat_x/rec_x/orphan-phantom.jpg";
    // The object disappeared between LIST and HEAD — model it by injecting
    // a key into the LIST page that HEAD cannot find.
    storage.afterList = (page) => {
      page.objects.push({ key: phantom, size: 10, lastModified: new Date(Date.now() - GRACE_MS - 60_000) });
    };

    const run = await runCleanup("full");
    expect(run.jobs[3].counts.orphan_already_absent).toBe(1);
    // No DeleteObject for something that is already gone.
    expect(storage.deleteCalls).toEqual([]);

    const audit = await prisma!.auditLog.findFirst({
      where: { action: "dentalfile.orphan_already_absent" },
    });
    expect(audit).not.toBeNull();
    expect((audit?.metadata as { r2Key?: string }).r2Key).toBe(phantom);
    expect(run.cursorCycleComplete).toBe(true);
    expect(run.cursor).toBeNull();
  });

  it("isolates ONE failing orphan HEAD: later orphans still process [F-2]", async () => {
    const old = new Date(Date.now() - GRACE_MS - 3_600_000);
    const failingKey = "dental/pat_x/rec_x/orphan-failhead.jpg";
    const succeedingKey = "dental/pat_x/rec_x/orphan-oknow.jpg";
    storage.seed(failingKey, { bytes: jpegBytes(100), lastModified: old });
    storage.seed(succeedingKey, { bytes: jpegBytes(100), lastModified: old });
    // One-shot HEAD failure for the first key (keys are scanned sorted).
    storage.headErrors.set(failingKey, new Error("injected R2 head failure"));

    const run = await runCleanup("full");
    expect(run.stoppedBy).toBe("complete");

    // Jobs B → A → C ran first without being skipped, then Job D continued
    // past the failed item.
    expect(run.jobs[2].job).toBe("purge");
    expect(run.jobs[2].skipped).toBeUndefined();
    const jobD = run.jobs[3];
    expect(jobD.processed).toBe(2);
    expect(jobD.counts.failed_error).toBe(1);
    expect(jobD.counts.orphan_deleted).toBe(1);

    // Failed item: object untouched, NO receipt, NO audit (nothing was
    // finalised, so a later run can retry it cleanly).
    expect(storage.has(failingKey)).toBe(true);
    expect(await prisma!.storageDeletionReceipt.count({ where: { r2Key: failingKey } })).toBe(0);
    const orphanAudits = await prisma!.auditLog.findMany({
      where: { action: { startsWith: "dentalfile." } },
    });
    expect(orphanAudits).toHaveLength(1);
    expect((orphanAudits[0].metadata as { r2Key?: string }).r2Key).toBe(succeedingKey);

    // The later orphan completed the full protocol.
    expect(storage.has(succeedingKey)).toBe(false);
    const okReceipt = await prisma!.storageDeletionReceipt.findFirst({
      where: { r2Key: succeedingKey },
    });
    expect(okReceipt?.completedAt).not.toBeNull();

    // The lease was released by the run's finally block.
    const state = await prisma!.storageScanState.findUnique({ where: { id: SCAN_STATE_ID } });
    expect(state?.leaseOwner).toBeNull();
  });

  it("takes over a STALE pending receipt (crash recovery) instead of dead-locking [RC]", async () => {
    const recordId = await seedRecord();
    const file = await seedFile(recordId, { status: "DELETING", due: true });

    // A previous run crashed after txA and before txB: a PENDING receipt
    // exists with NO live lease holder.
    await prisma!.storageDeletionReceipt.create({
      data: { r2Key: file.r2Key, eventNo: 1, evidence: { crashed: true } },
    });

    const run = await runCleanup("throttle");
    expect(run.jobs[1].counts.deleted).toBe(1);

    // No pending receipt may survive (the onePending index stays usable).
    expect(
      await prisma!.storageDeletionReceipt.count({ where: { r2Key: file.r2Key, completedAt: null } }),
    ).toBe(0);
    const receipts = await prisma!.storageDeletionReceipt.findMany({
      where: { r2Key: file.r2Key },
      orderBy: { eventNo: "asc" },
    });
    expect(receipts).toHaveLength(2);
    expect(receipts[0].completedAt).not.toBeNull(); // taken over
    expect(receipts[1].completedAt).not.toBeNull(); // fresh intent completed
    expect(receipts[1].eventNo).toBe(2); // never-reuse rule
    expect(storage.has(file.r2Key)).toBe(false);
    expect(await prisma!.dentalFile.findUnique({ where: { id: file.id } })).toBeNull();
  });

  it("cycles the durable cursor across pages, then resets it", async () => {
    // 105 young orphans > PREPASS_LIMIT (100): the first full run stops on
    // the shared item budget with a persisted cursor; the second run
    // finishes the cycle and resets it.
    const keys: string[] = [];
    for (let i = 0; i < 105; i += 1) {
      const key = `dental/pat_x/rec_x/orph${String(i).padStart(3, "0")}.jpg`;
      keys.push(key);
      storage.seed(key, { bytes: jpegBytes(20) });
    }

    const first = await runCleanup("full");
    expect(first.stoppedBy).toBe("budget");
    expect(first.jobs[3].counts.keys_scanned).toBe(100);
    expect(first.cursorCycleComplete).toBe(false);
    expect(first.cursor).toBe(keys[99]); // durable page-boundary cursor
    expect(storage.deleteCalls).toEqual([]); // everything was young

    const second = await runCleanup("full");
    expect(second.stoppedBy).toBe("complete");
    expect(second.jobs[3].counts.keys_scanned).toBe(5);
    expect(second.cursorCycleComplete).toBe(true);
    expect(second.cursor).toBeNull(); // cycle complete → cursor reset
    expect(storage.deleteCalls).toEqual([]);
  });

  /* ---------------- concurrency + the documented race ---------------- */

  it("aborts a CONCURRENT second intent for the same key (one CONFLICT, no delete)", async () => {
    const key = "dental/pat_x/rec_x/concurrent.jpg";
    const attempt = () =>
      prisma!.$transaction(async (tx) => createDeletionIntent(tx, { r2Key: key }));

    const results = await Promise.allSettled([attempt(), attempt()]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const reason = (rejected[0] as PromiseRejectedResult).reason;
    expect(reason).toBeInstanceOf(AdminError);
    expect((reason as AdminError).code).toBe("CONFLICT");

    // Exactly ONE pending receipt — the loser rolled back before any
    // DeleteObject could be issued.
    expect(
      await prisma!.storageDeletionReceipt.count({ where: { r2Key: key, completedAt: null } }),
    ).toBe(1);
    expect(storage.deleteCalls).toEqual([]);
  });

  it("documented unfenceable race: a lease appearing after the final check still lets the idempotent delete land [FENC/DL]", async () => {
    const recordId = await seedRecord();
    const file = await seedFile(recordId, { status: "DELETING", due: true });

    // Between the FINAL holdsLease() and the request reaching storage, our
    // lease expires and another worker takes over — the check→request race
    // cannot be fenced. DeleteObject is idempotent, so the worst case is a
    // redundant delete of an already-absent key.
    storage.beforeDelete = async () => {
      await prisma!.storageScanState.update({
        where: { id: SCAN_STATE_ID },
        data: {
          leaseOwner: "run_intruder",
          leaseExpiresAt: new Date(Date.now() + 600_000),
        },
      });
    };

    try {
      const run = await runCleanup("throttle");
      expect(run.jobs[1].counts.deleted).toBe(1);
      expect(storage.deleteCalls).toEqual([file.r2Key]);
      expect(storage.has(file.r2Key)).toBe(false);
      // Receipt + row still finalised atomically despite the takeover.
      const receipt = await prisma!.storageDeletionReceipt.findFirst({
        where: { r2Key: file.r2Key },
      });
      expect(receipt?.completedAt).not.toBeNull();
      expect(await prisma!.dentalFile.findUnique({ where: { id: file.id } })).toBeNull();
    } finally {
      await releaseLease(prisma!, "run_intruder");
    }
  });

  /* ---------------- cron route ---------------- */

  it("cron fails CLOSED with 503 when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;
    try {
      const response = await cronGet(
        request("/api/cron/dental-storage-cleanup", {
          headers: { authorization: "Bearer anything" },
        }),
      );
      expect(response.status).toBe(503);
      expect((await response.json()).error.code).toBe("SERVICE_UNAVAILABLE");
    } finally {
      if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = originalCronSecret;
    }
  });

  it("cron 401s a missing/wrong bearer and 200s the right one (timing-safe)", async () => {
    process.env.CRON_SECRET = "integration-test-cron-secret-0123456789";
    try {
      const missing = await cronGet(request("/api/cron/dental-storage-cleanup"));
      expect(missing.status).toBe(401);

      const wrong = await cronGet(
        request("/api/cron/dental-storage-cleanup", {
          headers: { authorization: "Bearer not-the-secret" },
        }),
      );
      expect(wrong.status).toBe(401);

      const right = await cronGet(
        request("/api/cron/dental-storage-cleanup", {
          headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
        }),
      );
      expect(right.status).toBe(200);
      expect(right.headers.get("cache-control")).toBe("no-store");
      const body = await right.json();
      expect(body.run.mode).toBe("full");
      expect(body.run.leaseAcquired).toBe(true);
      expect(body.run.jobs.map((job: { job: string }) => job.job)).toEqual([
        "sweep",
        "delete",
        "purge",
        "reconcile",
      ]);
    } finally {
      if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = originalCronSecret;
    }
  });

  it("cron 401s wrong-length and non-Bearer credentials (hashed compare) [F-9]", async () => {
    process.env.CRON_SECRET = "integration-test-cron-secret-0123456789";
    const secret = process.env.CRON_SECRET;
    try {
      // Each candidate fails for a DIFFERENT reason: the hashed
      // timingSafeEqual path must reject every length, not just equal
      // lengths, without leaking which one it saw.
      const attempts = [
        `Bearer ${secret.slice(0, 10)}`, // much shorter (prefix)
        `Bearer ${secret.slice(0, -1)}`, // same length, one char off
        `Bearer ${secret}x`, // one char longer
        `Bearer ${"z".repeat(secret.length + 64)}`, // much longer
        `Bearer `, // empty bearer
        `Basic ${secret}`, // wrong scheme
      ];
      for (const authorization of attempts) {
        const response = await cronGet(
          request("/api/cron/dental-storage-cleanup", { headers: { authorization } }),
        );
        expect(response.status, authorization).toBe(401);
        expect((await response.json()).error.code).toBe("UNAUTHORIZED");
      }

      // Fail-closed: no rejected attempt ever acquired the lease or ran.
      const state = await prisma!.storageScanState.findUnique({ where: { id: SCAN_STATE_ID } });
      expect(state?.leaseOwner ?? null).toBeNull();
    } finally {
      if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = originalCronSecret;
    }
  });
});
