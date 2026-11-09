/**
 * Phase D integration tests — private file upload/download/delete against a
 * REAL PostgreSQL database with the in-memory storage adapter (the ONLY
 * storage used by automated tests; no network, no R2).
 *
 * Covers:
 *  - POST [id]/files (upload-init): 401/403/405, 201 ticket shape, server
 *    generated key + R2KeyRegistry tombstone, unsupported type 400,
 *    oversize 400, unknown/soft-deleted record 404, no R2 secrets leaked,
 *    per-record file cap → 409 (configurable, race-safe under CONCURRENT
 *    inits) [F-5], service-level byteSize guard [F-3],
 *    429 after 30 inits/min per staff [F-4]
 *  - POST files/[fileId]/complete: pass → AVAILABLE + dentalfile.upload
 *    audit · idempotent replay (no second audit) · size mismatch → REJECTED
 *    · magic-byte mismatch → REJECTED · missing object → REJECTED ·
 *    OVERSIZE object → REJECTED (`oversize:…`, checked BEFORE size
 *    equality) [F-3] · 429 after 60 completions/min per staff [F-4] ·
 *    REJECTED again on replay (409 for a second complete)
 *  - GET files/[fileId]/url: 409 when not AVAILABLE, presigned URL +
 *    dentalfile.download audit, 404s
 *  - DELETE files/[fileId]: intent audit `dentalfile.delete {trigger:
 *    "admin"}`, not-due → queued (row stays DELETING), due → physical
 *    delete + receipt completion + row removal, foreign live lease → queued
 *  - Storage unconfigured (null adapter) → 503 on init with NO row created
 *  - Cache-Control: no-store; no credentials ever serialized
 *
 * Manifest ids exercised: [K*] key format · [I*] init bounds · [V*]
 * complete verification · [D*] delete semantics · [KK] reservation retry ·
 * [F-3] size guards · [F-4] rate limits · [F-5] per-record file cap.
 *
 * Gating + disposable-DB assumption identical to dental-records.test.ts.
 */

import "dotenv/config";

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

// Refuse — loudly, before any query runs — to touch anything that is not a
// disposable database (see tests/integration/db-guard.ts).
import { assertDisposableDatabase } from "./db-guard";
assertDisposableDatabase(process.env.DATABASE_URL);

import { afterEach, beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";

import {
  POST as initPostHandler,
  GET as initGet,
} from "@/app/api/admin/dental-records/[id]/files/route";
import {
  POST as completePostHandler,
  GET as completeGet,
} from "@/app/api/admin/dental-records/files/[fileId]/complete/route";
import {
  GET as urlGetHandler,
  POST as urlPost,
} from "@/app/api/admin/dental-records/files/[fileId]/url/route";
import {
  DELETE as fileDeleteHandler,
  GET as fileGet,
} from "@/app/api/admin/dental-records/files/[fileId]/route";
import { POST as recordPost } from "@/app/api/admin/dental-records/route";
import { tryAcquireLease, releaseLease } from "@/lib/server/admin/dental-delete";
import { AdminError } from "@/lib/server/admin/dashboard";
import { initDentalFileUpload } from "@/lib/server/admin/dental-files";
import { hashPassword } from "@/lib/server/auth";
import { getPrisma } from "@/lib/server/db";
import { resetRateLimits } from "@/lib/server/rate-limit";
import { setStorageForTests } from "@/lib/server/storage";
import { MemoryStorage } from "@/lib/server/storage/memory";
import { setFileIdFactoryForTests } from "@/lib/server/storage/pure";

import { authed, jpegBytes, login, makeRequest, routeCtx, wipeAllData } from "./dental-helpers";

const prisma = getPrisma();
const describeDb = prisma ? describe : describe.skip;

let ipSeq = 800;
function nextIp(): string {
  ipSeq += 1;
  return `10.90.1.${ipSeq % 250}`;
}

function request(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
  auth?: { headers: Record<string, string> },
) {
  const merged = auth ? { ...init, headers: { ...init.headers, ...auth.headers } } : init;
  return makeRequest(path, merged, nextIp());
}

/* Handlers that take (request, context) — context derived from the path.
 * The wrong-method handlers (initGet / completeGet / urlPost / fileGet)
 * take no arguments at all. */
const initPost = (req: NextRequest) => initPostHandler(req, routeCtx(req.nextUrl.pathname));
const completePost = (req: NextRequest) =>
  completePostHandler(req, routeCtx(req.nextUrl.pathname));
const urlGet = (req: NextRequest) => urlGetHandler(req, routeCtx(req.nextUrl.pathname));
const fileDelete = (req: NextRequest) => fileDeleteHandler(req, routeCtx(req.nextUrl.pathname));

describeDb("Dental files — private upload / download / delete (real PostgreSQL)", () => {
  let adminCookie = "";
  let staffCookie = "";
  let patientId = "";
  let recordId = "";
  let storage: MemoryStorage;

  /** Creates a record through the real route and returns its id. */
  async function seedRecord(diagnosis = "Dental caries — 36 MO"): Promise<string> {
    const response = await recordPost(
      request(
        "/api/admin/dental-records",
        {
          method: "POST",
          body: {
            patientId,
            treatmentDate: "2026-11-03",
            diagnosis,
            treatmentDetails: "details",
          },
        },
        authed(adminCookie),
      ),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    return body.record.id as string;
  }

  beforeAll(async () => {
    if (!prisma) return;
    const config = await prisma.clinicConfig.findUnique({ where: { id: "singleton" } });
    if (!config) {
      throw new Error("Database is not seeded — run: npx prisma migrate deploy && npm run db:seed");
    }

    await wipeAllData(prisma);

    const suffix = Date.now();
    const password = "dental-files-test-pw-123";
    await prisma.staff.create({
      data: {
        email: `admin-files-${suffix}@example.test`,
        fullName: "Admin FileTest",
        passwordHash: await hashPassword(password),
        role: "ADMIN",
        active: true,
      },
    });
    await prisma.staff.create({
      data: {
        email: `staff-files-${suffix}@example.test`,
        fullName: "Staff FileTest",
        passwordHash: await hashPassword(password),
        role: "STAFF",
        active: true,
      },
    });
    adminCookie = await login(`admin-files-${suffix}@example.test`, password, nextIp());
    staffCookie = await login(`staff-files-${suffix}@example.test`, password, nextIp());

    const patient = await prisma.patient.create({
      data: { fullName: "Meera Iyer", phone: "9876501234" },
    });
    patientId = patient.id;
    recordId = await seedRecord();
  });

  afterAll(async () => {
    if (!prisma) return;
    setStorageForTests(null);
    setFileIdFactoryForTests(null);
    await wipeAllData(prisma);
  });

  beforeEach(() => {
    storage = new MemoryStorage();
    setStorageForTests(storage);
    // Upload init/complete are rate limited per staff id [F-4]; buckets live
    // per process, so reset them or one test's budget bleeds into the next.
    resetRateLimits();
  });

  afterEach(() => {
    setStorageForTests(null);
    setFileIdFactoryForTests(null);
  });

  /* ---------------- authorization + method gates ---------------- */

  it("401s every file endpoint without a session", async () => {
    expect((await initPost(request(`/api/admin/dental-records/${recordId}/files`, { method: "POST", body: {} }))).status).toBe(401);
    expect((await completePost(request("/api/admin/dental-records/files/x/complete", { method: "POST", body: {} }))).status).toBe(401);
    expect((await urlGet(request("/api/admin/dental-records/files/x/url"))).status).toBe(401);
    expect((await fileDelete(request("/api/admin/dental-records/files/x", { method: "DELETE" }))).status).toBe(401);
  });

  it("403s STAFF on every file endpoint (ADMIN-only module)", async () => {
    expect(
      (
        await initPost(
          request(
            `/api/admin/dental-records/${recordId}/files`,
            { method: "POST", body: { originalName: "a.jpg", contentType: "image/jpeg", byteSize: 10 } },
            authed(staffCookie),
          ),
        )
      ).status,
    ).toBe(403);
    expect(
      (await completePost(request("/api/admin/dental-records/files/x/complete", { method: "POST", body: {} }, authed(staffCookie)))).status,
    ).toBe(403);
    expect((await urlGet(request("/api/admin/dental-records/files/x/url", {}, authed(staffCookie)))).status).toBe(403);
    expect((await fileDelete(request("/api/admin/dental-records/files/x", { method: "DELETE" }, authed(staffCookie)))).status).toBe(403);
  });

  it("405s the wrong methods with explicit Allow headers", async () => {
    // These wrong-method handlers take no arguments (405 is unconditional).
    const initWrong = await initGet();
    expect(initWrong.status).toBe(405);
    expect(initWrong.headers.get("allow")).toBe("POST");

    const completeWrong = await completeGet();
    expect(completeWrong.status).toBe(405);
    expect(completeWrong.headers.get("allow")).toBe("POST");

    const urlWrong = await urlPost();
    expect(urlWrong.status).toBe(405);
    expect(urlWrong.headers.get("allow")).toBe("GET");

    const fileWrong = await fileGet();
    expect(fileWrong.status).toBe(405);
    expect(fileWrong.headers.get("allow")).toBe("DELETE");
  });

  /* ---------------- upload init ---------------- */

  it("reserves a row + registry tombstone and returns a presigned PUT", async () => {
    const response = await initPost(
      request(
        `/api/admin/dental-records/${recordId}/files`,
        { method: "POST", body: { originalName: "X-Ray Upper.JPEG", contentType: "image/jpeg", byteSize: 2048 } },
        authed(adminCookie),
      ),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();

    // Server-generated key: dental/{patientId}/{recordId}/{fileId}.jpeg ext.
    expect(body.file.id).toMatch(/^c[0-9a-z]+[0-9a-f]{8}$/);
    expect(body.file.upload.method).toBe("PUT");
    expect(body.file.upload.url).toContain("memory://put/dental/");
    expect(body.file.upload.headers["Content-Type"]).toBe("image/jpeg");
    expect(body.file.upload.expiresAt).toBeTruthy();

    // Row + registry tombstone both exist; key lives only in the row.
    const row = await prisma!.dentalFile.findUnique({ where: { id: body.file.id } });
    expect(row).not.toBeNull();
    expect(row?.status).toBe("PENDING");
    expect(row?.r2Key).toBe(`dental/${patientId}/${recordId}/${body.file.id}.jpeg`);
    expect(row?.uploadedBy).not.toBeNull();
    const registry = await prisma!.r2KeyRegistry.findUnique({ where: { r2Key: row!.r2Key } });
    expect(registry).not.toBeNull();

    // No storage credentials anywhere in the response.
    const text = JSON.stringify(body);
    expect(text).not.toContain("R2_SECRET");
    expect(text).not.toContain("secretAccessKey");
  });

  it("rejects unsupported types, mismatched families and oversize declarations", async () => {
    const before = await prisma!.dentalFile.count();
    const cases = [
      { originalName: "scan.gif", contentType: "image/gif", byteSize: 10 },
      { originalName: "scan.pdf", contentType: "application/pdf", byteSize: 10 },
      { originalName: "scan.png", contentType: "image/jpeg", byteSize: 10 },
      { originalName: "scan.jpg", contentType: "image/jpeg", byteSize: 10 * 1024 * 1024 + 1 },
      { originalName: "scan.jpg", contentType: "image/jpeg", byteSize: 0 },
      { originalName: "", contentType: "image/jpeg", byteSize: 10 },
      { originalName: "scan.jpg", contentType: "image/jpeg", byteSize: 10, r2Key: "dental/evil" },
    ];
    for (const body of cases) {
      const response = await initPost(
        request(
          `/api/admin/dental-records/${recordId}/files`,
          { method: "POST", body },
          authed(adminCookie),
        ),
      );
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    expect(await prisma!.dentalFile.count()).toBe(before);
  });

  it("404s init for an unknown or soft-deleted record", async () => {
    const unknown = await initPost(
      request(
        "/api/admin/dental-records/nope/files",
        { method: "POST", body: { originalName: "a.jpg", contentType: "image/jpeg", byteSize: 10 } },
        authed(adminCookie),
      ),
    );
    expect(unknown.status).toBe(404);

    const doomed = await seedRecord("Doomed record");
    await prisma!.dentalRecord.update({ where: { id: doomed }, data: { deletedAt: new Date() } });
    const deleted = await initPost(
      request(
        `/api/admin/dental-records/${doomed}/files`,
        { method: "POST", body: { originalName: "a.jpg", contentType: "image/jpeg", byteSize: 10 } },
        authed(adminCookie),
      ),
    );
    expect(deleted.status).toBe(404);
  });

  it("503s init when storage is unconfigured WITHOUT creating a row", async () => {
    setStorageForTests(null);
    const before = await prisma!.dentalFile.count();
    const response = await initPost(
      request(
        `/api/admin/dental-records/${recordId}/files`,
        { method: "POST", body: { originalName: "a.jpg", contentType: "image/jpeg", byteSize: 10 } },
        authed(adminCookie),
      ),
    );
    expect(response.status).toBe(503);
    expect(await prisma!.dentalFile.count()).toBe(before);
  });

  it("retries on a generated file-id collision (registry PK) [KK]", async () => {
    const original = recordId;
    // Force the FIRST id to collide with an existing row, then fall back to
    // the real factory.
    const takenId = "ccollision00";
    await prisma!.dentalFile.create({
      data: {
        id: takenId,
        recordId: original,
        r2Key: `dental/${patientId}/${original}/${takenId}.jpg`,
        originalName: "existing.jpg",
        contentType: "image/jpeg",
        byteSize: 10,
        status: "AVAILABLE",
        cleanupAfter: new Date(Date.now() + 600_000),
      },
    });
    await prisma!.r2KeyRegistry.create({
      data: { r2Key: `dental/${patientId}/${original}/${takenId}.jpg` },
    });

    let first = true;
    setFileIdFactoryForTests(() => {
      if (first) {
        first = false;
        return takenId;
      }
      return `cfresh${Math.random().toString(16).slice(2, 10)}00`;
    });

    const response = await initPost(
      request(
        `/api/admin/dental-records/${original}/files`,
        { method: "POST", body: { originalName: "second.jpg", contentType: "image/jpeg", byteSize: 100 } },
        authed(adminCookie),
      ),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.file.id).not.toBe(takenId);

    // Clean the collision fixtures.
    await prisma!.r2KeyRegistry.delete({ where: { r2Key: `dental/${patientId}/${original}/${takenId}.jpg` } });
    await prisma!.dentalFile.delete({ where: { id: takenId } });
  });

  /* ---------------- per-record file cap [F-5] + service size guard [F-3] ---------------- */

  it("409s init at the configurable per-record file cap — never a silent truncation [F-5]", async () => {
    const previous = process.env.DENTAL_MAX_FILES_PER_RECORD;
    process.env.DENTAL_MAX_FILES_PER_RECORD = "3";
    try {
      const target = await seedRecord("Cap test record");
      for (let i = 0; i < 3; i += 1) {
        const ok = await initPost(
          request(
            `/api/admin/dental-records/${target}/files`,
            { method: "POST", body: { originalName: `cap-${i}.jpg`, contentType: "image/jpeg", byteSize: 100 } },
            authed(adminCookie),
          ),
        );
        expect(ok.status).toBe(201);
      }
      expect(await prisma!.dentalFile.count({ where: { recordId: target } })).toBe(3);

      const limited = await initPost(
        request(
          `/api/admin/dental-records/${target}/files`,
          { method: "POST", body: { originalName: "one-too-many.jpg", contentType: "image/jpeg", byteSize: 100 } },
          authed(adminCookie),
        ),
      );
      expect(limited.status).toBe(409);
      expect((await limited.json()).error.code).toBe("CONFLICT");

      // Explicit 409 with NOTHING created — never a partial/truncated state.
      expect(await prisma!.dentalFile.count({ where: { recordId: target } })).toBe(3);

      // The cap is PER RECORD: another record still accepts uploads.
      const other = await seedRecord("Cap other record");
      const okOther = await initPost(
        request(
          `/api/admin/dental-records/${other}/files`,
          { method: "POST", body: { originalName: "other.jpg", contentType: "image/jpeg", byteSize: 100 } },
          authed(adminCookie),
        ),
      );
      expect(okOther.status).toBe(201);
    } finally {
      if (previous === undefined) delete process.env.DENTAL_MAX_FILES_PER_RECORD;
      else process.env.DENTAL_MAX_FILES_PER_RECORD = previous;
    }
  });

  it("enforces the file cap under CONCURRENT inits — exactly `limit` win, the rest 409 [F-5]", async () => {
    const previous = process.env.DENTAL_MAX_FILES_PER_RECORD;
    process.env.DENTAL_MAX_FILES_PER_RECORD = "2";
    try {
      const target = await seedRecord("Concurrent cap record");
      const attempts = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          initPost(
            request(
              `/api/admin/dental-records/${target}/files`,
              { method: "POST", body: { originalName: `race-${i}.jpg`, contentType: "image/jpeg", byteSize: 100 } },
              authed(adminCookie),
            ),
          ),
        ),
      );

      const statuses = attempts.map((r) => r.status).sort((a, b) => a - b);
      expect(statuses).toEqual([201, 201, 409, 409, 409]);

      // Race-safe: the `FOR UPDATE` record lock serializes the count check,
      // so exactly 2 rows exist and every admitted key has its tombstone.
      const rows = await prisma!.dentalFile.findMany({ where: { recordId: target } });
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(await prisma!.r2KeyRegistry.findUnique({ where: { r2Key: row.r2Key } })).not.toBeNull();
      }
      for (const response of attempts.filter((r) => r.status === 409)) {
        expect((await response.json()).error.code).toBe("CONFLICT");
      }
    } finally {
      if (previous === undefined) delete process.env.DENTAL_MAX_FILES_PER_RECORD;
      else process.env.DENTAL_MAX_FILES_PER_RECORD = previous;
    }
  });

  it("rejects out-of-bounds byteSize in the SERVICE layer (route schema is not the only guard) [F-3]", async () => {
    const admin = await prisma!.staff.findFirst({ where: { role: "ADMIN" } });
    expect(admin).not.toBeNull();
    const before = await prisma!.dentalFile.count();
    for (const byteSize of [10 * 1024 * 1024 + 1, 0, -5, 10.5]) {
      let thrown: unknown = null;
      try {
        await initDentalFileUpload(
          recordId,
          { originalName: "guard.jpg", contentType: "image/jpeg", byteSize },
          admin!.id,
        );
      } catch (error) {
        thrown = error;
      }
      expect(thrown, `byteSize=${byteSize}`).toBeInstanceOf(AdminError);
      expect((thrown as AdminError).code).toBe("VALIDATION_ERROR");
    }
    // Not one reservation row or registry key was created.
    expect(await prisma!.dentalFile.count()).toBe(before);
  });

  /* ---------------- upload complete ---------------- */

  it("passes a valid upload → AVAILABLE + dentalfile.upload audit (idempotent)", async () => {
    const init = await initPost(
      request(
        `/api/admin/dental-records/${recordId}/files`,
        { method: "POST", body: { originalName: "good.jpg", contentType: "image/jpeg", byteSize: 512 } },
        authed(adminCookie),
      ),
    );
    expect(init.status).toBe(201);
    const ticket = (await init.json()).file;
    const row = await prisma!.dentalFile.findUnique({ where: { id: ticket.id } });

    // The client PUT the bytes (tests do this directly on the fake).
    storage.seed(row!.r2Key, { bytes: jpegBytes(512) });

    const completed = await completePost(
      request(`/api/admin/dental-records/files/${ticket.id}/complete`, { method: "POST", body: {} }, authed(adminCookie)),
    );
    expect(completed.status).toBe(200);
    const file = (await completed.json()).file;
    expect(file.status).toBe("AVAILABLE");
    expect(completed.headers.get("cache-control")).toBe("no-store");

    const audits = await prisma!.auditLog.count({ where: { action: "dentalfile.upload", entityId: ticket.id } });
    expect(audits).toBe(1);

    // Replay: same state, NO second audit.
    const replay = await completePost(
      request(`/api/admin/dental-records/files/${ticket.id}/complete`, { method: "POST", body: {} }, authed(adminCookie)),
    );
    expect(replay.status).toBe(200);
    expect((await replay.json()).file.status).toBe("AVAILABLE");
    expect(await prisma!.auditLog.count({ where: { action: "dentalfile.upload", entityId: ticket.id } })).toBe(1);
  });

  it("rejects on size mismatch, magic bytes and missing object (audited)", async () => {
    const cases: Array<{ name: string; prepare: (key: string) => void; reason: RegExp }> = [
      {
        // Declared 512 bytes but the stored object is 256 → size mismatch.
        name: "size_mismatch",
        prepare: (key) => storage.seed(key, { bytes: jpegBytes(256) }),
        reason: /size_mismatch/,
      },
      {
        name: "magic_bytes",
        prepare: (key) => storage.seed(key, { bytes: jpegBytes(100) }),
        reason: /magic_bytes/,
      },
      {
        name: "object_missing",
        prepare: () => {},
        reason: /object_missing/,
      },
    ];

    for (const testCase of cases) {
      const init = await initPost(
        request(
          `/api/admin/dental-records/${recordId}/files`,
          {
            method: "POST",
            body: { originalName: `${testCase.name}.jpg`, contentType: "image/jpeg", byteSize: testCase.name === "size_mismatch" ? 512 : 100 },
          },
          authed(adminCookie),
        ),
      );
      const ticket = (await init.json()).file;
      const row = await prisma!.dentalFile.findUnique({ where: { id: ticket.id } });
      if (testCase.name === "magic_bytes") storage.seedCorrupt(row!.r2Key, { size: 100 });
      else testCase.prepare(row!.r2Key);

      const completed = await completePost(
        request(`/api/admin/dental-records/files/${ticket.id}/complete`, { method: "POST", body: {} }, authed(adminCookie)),
      );
      expect(completed.status).toBe(200);
      const file = (await completed.json()).file;
      expect(file.status).toBe("REJECTED");

      const audit = await prisma!.auditLog.findFirst({ where: { action: "dentalfile.rejected", entityId: ticket.id } });
      expect(audit).not.toBeNull();
      expect(String((audit?.metadata as { reason?: string }).reason)).toMatch(testCase.reason);

      // A REJECTED file cannot be verified again → 409.
      const again = await completePost(
        request(`/api/admin/dental-records/files/${ticket.id}/complete`, { method: "POST", body: {} }, authed(adminCookie)),
      );
      expect(again.status).toBe(409);
    }
  });

  it("REJECTS an oversize object at complete — BEFORE the size-equality check [F-3]", async () => {
    // Declared size AND stored object BOTH exceed the 10 MB hard cap and
    // MATCH each other: only the oversize guard can reject this (size
    // equality, family and magic bytes would all pass). A presigned PUT
    // cannot bind body size — this HEAD-based check is the enforcement.
    const oversize = 10 * 1024 * 1024 + 1;
    const id = "coversize0001";
    const r2Key = `dental/${patientId}/${recordId}/${id}.jpg`;
    await prisma!.dentalFile.create({
      data: {
        id,
        recordId,
        r2Key,
        originalName: "too-big.jpg",
        contentType: "image/jpeg",
        byteSize: oversize,
        status: "PENDING",
        cleanupAfter: new Date(Date.now() + 600_000),
      },
    });
    await prisma!.r2KeyRegistry.create({ data: { r2Key } });
    storage.seed(r2Key, { bytes: jpegBytes(oversize) });

    try {
      const completed = await completePost(
        request(`/api/admin/dental-records/files/${id}/complete`, { method: "POST", body: {} }, authed(adminCookie)),
      );
      expect(completed.status).toBe(200);
      const file = (await completed.json()).file;
      expect(file.status).toBe("REJECTED");

      const audit = await prisma!.auditLog.findFirst({
        where: { action: "dentalfile.rejected", entityId: id },
      });
      expect(audit).not.toBeNull();
      expect(String((audit?.metadata as { reason?: string }).reason)).toBe(
        `oversize:limit=${10 * 1024 * 1024}:actual=${oversize}`,
      );

      // The oversize object was NEVER offered for download (not AVAILABLE).
      const download = await urlGet(
        request(`/api/admin/dental-records/files/${id}/url`, {}, authed(adminCookie)),
      );
      expect(download.status).toBe(409);
    } finally {
      await prisma!.dentalFile.delete({ where: { id } });
      await prisma!.r2KeyRegistry.delete({ where: { r2Key } });
    }
  });

  it("404s complete/url/delete for an unknown file id", async () => {
    expect((await completePost(request("/api/admin/dental-records/files/nope/complete", { method: "POST", body: {} }, authed(adminCookie)))).status).toBe(404);
    expect((await urlGet(request("/api/admin/dental-records/files/nope/url", {}, authed(adminCookie)))).status).toBe(404);
    expect((await fileDelete(request("/api/admin/dental-records/files/nope", { method: "DELETE" }, authed(adminCookie)))).status).toBe(404);
  });

  /* ---------------- secure download ---------------- */

  it("issues an audited presigned GET only for AVAILABLE files", async () => {
    const init = await initPost(
      request(
        `/api/admin/dental-records/${recordId}/files`,
        { method: "POST", body: { originalName: "view.jpg", contentType: "image/jpeg", byteSize: 100 } },
        authed(adminCookie),
      ),
    );
    const ticket = (await init.json()).file;

    // PENDING → 409 (nothing to download yet).
    const pending = await urlGet(
      request(`/api/admin/dental-records/files/${ticket.id}/url`, {}, authed(adminCookie)),
    );
    expect(pending.status).toBe(409);

    const row = await prisma!.dentalFile.findUnique({ where: { id: ticket.id } });
    storage.seed(row!.r2Key, { bytes: jpegBytes(100) });
    await completePost(
      request(`/api/admin/dental-records/files/${ticket.id}/complete`, { method: "POST", body: {} }, authed(adminCookie)),
    );

    const response = await urlGet(
      request(`/api/admin/dental-records/files/${ticket.id}/url`, {}, authed(adminCookie)),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.url).toContain("memory://get/dental/");
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const audit = await prisma!.auditLog.findFirst({ where: { action: "dentalfile.download", entityId: ticket.id } });
    expect(audit).not.toBeNull();

    // Each call is audited (a second view writes a second row).
    await urlGet(request(`/api/admin/dental-records/files/${ticket.id}/url`, {}, authed(adminCookie)));
    expect(await prisma!.auditLog.count({ where: { action: "dentalfile.download", entityId: ticket.id } })).toBe(2);
  });

  /* ---------------- deletion ---------------- */

  it("queues (not-due) an ADMIN delete: intent audit + row stays DELETING", async () => {
    const init = await initPost(
      request(
        `/api/admin/dental-records/${recordId}/files`,
        { method: "POST", body: { originalName: "young.jpg", contentType: "image/jpeg", byteSize: 100 } },
        authed(adminCookie),
      ),
    );
    const ticket = (await init.json()).file;
    const row = await prisma!.dentalFile.findUnique({ where: { id: ticket.id } });
    storage.seed(row!.r2Key, { bytes: jpegBytes(100) });
    await completePost(
      request(`/api/admin/dental-records/files/${ticket.id}/complete`, { method: "POST", body: {} }, authed(adminCookie)),
    );
    storage.resetCalls();

    const response = await fileDelete(
      request(`/api/admin/dental-records/files/${ticket.id}`, { method: "DELETE" }, authed(adminCookie)),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: false, queued: true });

    // cleanupAfter (now + 600 s) has NOT elapsed → no DeleteObject ever.
    expect(storage.deleteCalls).toEqual([]);
    const after = await prisma!.dentalFile.findUnique({ where: { id: ticket.id } });
    expect(after?.status).toBe("DELETING");

    const audit = await prisma!.auditLog.findFirst({ where: { action: "dentalfile.delete", entityId: ticket.id } });
    expect((audit?.metadata as { trigger?: string }).trigger).toBe("admin");

    // A second delete does NOT write a second intent audit.
    await fileDelete(
      request(`/api/admin/dental-records/files/${ticket.id}`, { method: "DELETE" }, authed(adminCookie)),
    );
    expect(await prisma!.auditLog.count({ where: { action: "dentalfile.delete", entityId: ticket.id } })).toBe(1);
  });

  it("physically deletes a DUE file: DeleteObject + receipt completion + row removal", async () => {
    const init = await initPost(
      request(
        `/api/admin/dental-records/${recordId}/files`,
        { method: "POST", body: { originalName: "due.jpg", contentType: "image/jpeg", byteSize: 100 } },
        authed(adminCookie),
      ),
    );
    const ticket = (await init.json()).file;
    const row = await prisma!.dentalFile.findUnique({ where: { id: ticket.id } });
    storage.seed(row!.r2Key, { bytes: jpegBytes(100) });
    await completePost(
      request(`/api/admin/dental-records/files/${ticket.id}/complete`, { method: "POST", body: {} }, authed(adminCookie)),
    );

    // Make it due (URL-TTL guard = 600 s past creation).
    await prisma!.dentalFile.update({
      where: { id: ticket.id },
      data: { cleanupAfter: new Date(Date.now() - 1000) },
    });
    storage.resetCalls();

    const response = await fileDelete(
      request(`/api/admin/dental-records/files/${ticket.id}`, { method: "DELETE" }, authed(adminCookie)),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true, queued: false });

    // Operation order: HEAD (evidence) → DELETE → HEAD (confirm).
    const ops = storage.calls.filter((call) => call.op === "head" || call.op === "delete").map((call) => call.op);
    expect(ops).toEqual(["head", "delete", "head"]);
    expect(storage.deleteCalls).toEqual([row!.r2Key]);
    expect(storage.has(row!.r2Key)).toBe(false);

    // Receipt completed (txB gate) + row removed atomically.
    const receipt = await prisma!.storageDeletionReceipt.findFirst({ where: { r2Key: row!.r2Key } });
    expect(receipt?.completedAt).not.toBeNull();
    expect(await prisma!.dentalFile.findUnique({ where: { id: ticket.id } })).toBeNull();
  });

  it("queues the delete when ANOTHER live worker holds the cleanup lease", async () => {
    const init = await initPost(
      request(
        `/api/admin/dental-records/${recordId}/files`,
        { method: "POST", body: { originalName: "leased.jpg", contentType: "image/jpeg", byteSize: 100 } },
        authed(adminCookie),
      ),
    );
    const ticket = (await init.json()).file;
    const row = await prisma!.dentalFile.findUnique({ where: { id: ticket.id } });
    storage.seed(row!.r2Key, { bytes: jpegBytes(100) });
    await completePost(
      request(`/api/admin/dental-records/files/${ticket.id}/complete`, { method: "POST", body: {} }, authed(adminCookie)),
    );
    await prisma!.dentalFile.update({
      where: { id: ticket.id },
      data: { cleanupAfter: new Date(Date.now() - 1000) },
    });

    // A live cleanup run owns storage right now.
    const acquired = await tryAcquireLease(prisma!, "run_foreign_test");
    expect(acquired).toBe(true);
    storage.resetCalls();
    try {
      const response = await fileDelete(
        request(`/api/admin/dental-records/files/${ticket.id}`, { method: "DELETE" }, authed(adminCookie)),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ deleted: false, queued: true });
      expect(storage.deleteCalls).toEqual([]); // never touched the object
      const after = await prisma!.dentalFile.findUnique({ where: { id: ticket.id } });
      expect(after?.status).toBe("DELETING");
    } finally {
      await releaseLease(prisma!, "run_foreign_test");
    }
  });

  /* ---------------- rate limits [F-4] ---------------- */

  it("429s upload-init after the per-staff budget (30/min) — enforced server-side [F-4]", async () => {
    const before = await prisma!.dentalFile.count();
    // 30 attempts (invalid bodies still count: the limiter runs BEFORE any
    // body parsing) — every one is answered 400, none 429 yet.
    for (let i = 0; i < 30; i += 1) {
      const response = await initPost(
        request(
          `/api/admin/dental-records/${recordId}/files`,
          { method: "POST", body: {} },
          authed(adminCookie),
        ),
      );
      expect(response.status).toBe(400);
    }
    // The 31st attempt is 429 even with a VALID body: enforcement never
    // depends on client-side or UI restrictions, and no row is reserved.
    const limited = await initPost(
      request(
        `/api/admin/dental-records/${recordId}/files`,
        { method: "POST", body: { originalName: "after-limit.jpg", contentType: "image/jpeg", byteSize: 100 } },
        authed(adminCookie),
      ),
    );
    expect(limited.status).toBe(429);
    expect((await limited.json()).error.code).toBe("RATE_LIMITED");
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await prisma!.dentalFile.count()).toBe(before);
  });

  it("429s upload-complete after the per-staff budget (60/min) [F-4]", async () => {
    // Each attempt hits the real handler (404 for an unknown id) — the
    // limiter still counts it because it runs before any storage read.
    for (let i = 0; i < 60; i += 1) {
      const response = await completePost(
        request("/api/admin/dental-records/files/nope/complete", { method: "POST", body: {} }, authed(adminCookie)),
      );
      expect(response.status).toBe(404);
    }
    const limited = await completePost(
      request("/api/admin/dental-records/files/nope/complete", { method: "POST", body: {} }, authed(adminCookie)),
    );
    expect(limited.status).toBe(429);
    expect((await limited.json()).error.code).toBe("RATE_LIMITED");
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);

    // An UNAUTHENTICATED call is still a clean 401 (auth before limiter).
    const anon = await initPost(
      request(`/api/admin/dental-records/${recordId}/files`, { method: "POST", body: {} }),
    );
    expect(anon.status).toBe(401);
  });

  it("never serializes session or credential material from file endpoints", async () => {
    const response = await urlGet(
      request("/api/admin/dental-records/files/nope/url", {}, authed(adminCookie)),
    );
    const text = JSON.stringify(await response.json());
    expect(text).not.toContain("passwordHash");
    expect(text).not.toContain("tgd_session");
    expect(text).not.toContain("secretAccessKey");
  });
});
