/**
 * Phase D integration tests — dental record CRUD + authorization + audit
 * against a REAL PostgreSQL database.
 *
 * Covers:
 *  - GET/POST /api/admin/dental-records (401, STAFF 403, 405, list shape,
 *    chronological order, patientId/from/to/q filters, pagination,
 *    validation 400 (strict), unknown patient 404, create 201 + audit)
 *  - GET/PATCH/DELETE /api/admin/dental-records/[id] (detail shape, 404s,
 *    edit 200 + changed-field audit, empty patch 400, soft delete + file
 *    claiming with atomic intent audits, deleted record disappears from
 *    every read path, filesTotal/truncated list metadata — never a silent
 *    truncation [F-5])
 *  - Cache-Control: no-store everywhere; no passwordHash / session material
 *    ever serialized
 *
 * Manifest ids exercised: [S*] query filters · [P*] CRUD shapes ·
 * [AT*] audit rows · [D*] delete claim semantics.
 *
 * Gating + disposable-DB assumption identical to admin-patients.test.ts:
 * the suite WIPES all dental + booking + auth rows — never production.
 */

import "dotenv/config";

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

// Refuse — loudly, before any query runs — to touch anything that is not a
// disposable database (see tests/integration/db-guard.ts).
import { assertDisposableDatabase } from "./db-guard";
assertDisposableDatabase(process.env.DATABASE_URL);

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";

import { GET as listGet, POST as listPost, DELETE as listDelete } from "@/app/api/admin/dental-records/route";
import {
  GET as detailGetHandler,
  PATCH as detailPatchHandler,
  DELETE as detailDeleteHandler,
} from "@/app/api/admin/dental-records/[id]/route";
import { hashPassword } from "@/lib/server/auth";
import { getPrisma } from "@/lib/server/db";
import { setStorageForTests } from "@/lib/server/storage";

import { authed, login, makeRequest, routeCtx, wipeAllData } from "./dental-helpers";

const prisma = getPrisma();
const describeDb = prisma ? describe : describe.skip;

let ipSeq = 700;
function nextIp(): string {
  ipSeq += 1;
  return `10.90.0.${ipSeq % 250}`;
}

function request(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
  auth?: { headers: Record<string, string> },
) {
  const merged = auth ? { ...init, headers: { ...init.headers, ...auth.headers } } : init;
  return makeRequest(path, merged, nextIp());
}

/* `[id]` handlers take (request, context) — the context is derived from
 * the request path so call sites stay readable. */
const detailGet = (req: NextRequest) => detailGetHandler(req, routeCtx(req.nextUrl.pathname));
const detailPatch = (req: NextRequest) => detailPatchHandler(req, routeCtx(req.nextUrl.pathname));
const detailDelete = (req: NextRequest) => detailDeleteHandler(req, routeCtx(req.nextUrl.pathname));

describeDb("Dental records CRUD + authorization (real PostgreSQL)", () => {
  let adminCookie = "";
  let staffCookie = "";
  let ashaId = "";
  let rahulId = "";
  let recordId = "";

  beforeAll(async () => {
    if (!prisma) return;
    const config = await prisma.clinicConfig.findUnique({ where: { id: "singleton" } });
    if (!config) {
      throw new Error("Database is not seeded — run: npx prisma migrate deploy && npm run db:seed");
    }

    // This suite never touches object storage — force the adapter to null
    // so no file endpoint can accidentally reach a real or shared backend.
    setStorageForTests(null);

    await wipeAllData(prisma);

    const suffix = Date.now();
    const password = "dental-records-test-pw-123";
    const admin = await prisma.staff.create({
      data: {
        email: `admin-rec-${suffix}@example.test`,
        fullName: "Admin RecordTest",
        passwordHash: await hashPassword(password),
        role: "ADMIN",
        active: true,
      },
    });
    await prisma.staff.create({
      data: {
        email: `staff-rec-${suffix}@example.test`,
        fullName: "Staff RecordTest",
        passwordHash: await hashPassword(password),
        role: "STAFF",
        active: true,
      },
    });
    adminCookie = await login(`admin-rec-${suffix}@example.test`, password, nextIp());
    staffCookie = await login(`staff-rec-${suffix}@example.test`, password, nextIp());

    const asha = await prisma.patient.create({
      data: { fullName: "Asha Verma", phone: "9876543210" },
    });
    const rahul = await prisma.patient.create({
      data: { fullName: "Rahul Sen", phone: "9812345678" },
    });
    ashaId = asha.id;
    rahulId = rahul.id;

    // Silence unused-variable lint (admin is used only for its session).
    expect(admin.role).toBe("ADMIN");
  });

  afterAll(async () => {
    if (!prisma) return;
    setStorageForTests(null);
    await wipeAllData(prisma);
  });

  /* ---------------- authorization ---------------- */

  it("401s every endpoint without a session", async () => {
    expect((await listGet(request("/api/admin/dental-records"))).status).toBe(401);
    expect(
      (
        await listPost(
          request("/api/admin/dental-records", {
            method: "POST",
            body: { patientId: ashaId, treatmentDate: "2026-11-03", diagnosis: "x", treatmentDetails: "y" },
          }),
        )
      ).status,
    ).toBe(401);
    expect((await detailGet(request("/api/admin/dental-records/anything"))).status).toBe(401);
    expect(
      (await detailPatch(request("/api/admin/dental-records/anything", { method: "PATCH", body: {} }))).status,
    ).toBe(401);
    expect(
      (await detailDelete(request("/api/admin/dental-records/anything", { method: "DELETE" }))).status,
    ).toBe(401);
  });

  it("403s STAFF on every endpoint (ADMIN-only module)", async () => {
    expect((await listGet(request("/api/admin/dental-records", authed(staffCookie)))).status).toBe(403);
    expect(
      (
        await listPost(
          request("/api/admin/dental-records", {
            method: "POST",
            body: { patientId: ashaId, treatmentDate: "2026-11-03", diagnosis: "x", treatmentDetails: "y" },
            ...authed(staffCookie),
          }),
        )
      ).status,
    ).toBe(403);
    expect((await detailGet(request("/api/admin/dental-records/x", authed(staffCookie)))).status).toBe(403);
    expect(
      (await detailPatch(request("/api/admin/dental-records/x", { method: "PATCH", body: {}, ...authed(staffCookie) }))).status,
    ).toBe(403);
    expect(
      (await detailDelete(request("/api/admin/dental-records/x", { method: "DELETE", ...authed(staffCookie) }))).status,
    ).toBe(403);
  });

  it("405s DELETE on the collection with an explicit Allow header", async () => {
    const response = await listDelete();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, POST");
  });

  /* ---------------- create ---------------- */

  it("creates a record (201) with an audited dentalrecord.create", async () => {
    const response = await listPost(
      request(
        "/api/admin/dental-records",
        {
          method: "POST",
          body: {
            patientId: ashaId,
            treatmentDate: "2026-11-03",
            diagnosis: "Dental caries — 36 MO",
            treatmentDetails: "Composite restoration completed.",
            clinicalNotes: "Mild sensitivity noted.",
          },
        },
        authed(adminCookie),
      ),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.record).toMatchObject({
      patientId: ashaId,
      patientName: "Asha Verma",
      treatmentDate: "2026-11-03",
      diagnosis: "Dental caries — 36 MO",
      fileCount: 0,
      availableFileCount: 0,
    });
    recordId = body.record.id;
    expect(response.headers.get("cache-control")).toBe("no-store");

    const audit = await prisma!.auditLog.findFirst({
      where: { action: "dentalrecord.create", entityId: recordId },
    });
    expect(audit).not.toBeNull();
    expect(audit?.entityType).toBe("DentalRecord");
    expect(audit?.staffId).not.toBeNull();
  });

  it("rejects invalid creates with field errors (strict schema)", async () => {
    const base = { patientId: ashaId, treatmentDate: "2026-11-03", diagnosis: "x", treatmentDetails: "y" };

    const empty = await listPost(
      request("/api/admin/dental-records", { method: "POST", body: { ...base, diagnosis: "" } }, authed(adminCookie)),
    );
    expect(empty.status).toBe(400);
    expect((await empty.json()).error.fields.diagnosis).toBeTruthy();

    const unknown = await listPost(
      request("/api/admin/dental-records", { method: "POST", body: { ...base, id: "forced" } }, authed(adminCookie)),
    );
    expect(unknown.status).toBe(400);

    const badDate = await listPost(
      request(
        "/api/admin/dental-records",
        { method: "POST", body: { ...base, treatmentDate: "03/11/2026" } },
        authed(adminCookie),
      ),
    );
    expect(badDate.status).toBe(400);
  });

  it("404s a create for an unknown patient", async () => {
    const response = await listPost(
      request(
        "/api/admin/dental-records",
        {
          method: "POST",
          body: { patientId: "does-not-exist", treatmentDate: "2026-11-03", diagnosis: "x", treatmentDetails: "y" },
        },
        authed(adminCookie),
      ),
    );
    expect(response.status).toBe(404);
  });

  /* ---------------- list + filters ---------------- */

  it("lists records newest-treatment-date first with pagination", async () => {
    // Second + third records with different dates.
    for (const [date, diagnosis] of [
      ["2026-10-01", "Gingivitis"],
      ["2026-09-15", "Tooth fracture — 21"],
    ] as const) {
      const created = await listPost(
        request(
          "/api/admin/dental-records",
          { method: "POST", body: { patientId: rahulId, treatmentDate: date, diagnosis, treatmentDetails: "details" } },
          authed(adminCookie),
        ),
      );
      expect(created.status).toBe(201);
    }

    const response = await listGet(request("/api/admin/dental-records", authed(adminCookie)));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.timezone).toBeTruthy();
    expect(body.records.length).toBe(3);
    expect(body.records[0].treatmentDate).toBe("2026-11-03");
    expect(body.records[1].treatmentDate).toBe("2026-10-01");
    expect(body.records[2].treatmentDate).toBe("2026-09-15");
    expect(body.pagination).toMatchObject({ page: 1, pageSize: 20, total: 3, totalPages: 1 });
    // No session/password material ever leaks.
    expect(JSON.stringify(body)).not.toContain("passwordHash");
    expect(JSON.stringify(body)).not.toContain("tgd_session");
  });

  it("filters by patient, inclusive treatment-date range and search", async () => {
    const byPatient = await listGet(
      request(`/api/admin/dental-records?patientId=${ashaId}`, authed(adminCookie)),
    );
    const patientBody = await byPatient.json();
    expect(patientBody.records).toHaveLength(1);
    expect(patientBody.records[0].patientName).toBe("Asha Verma");

    const inRange = await listGet(
      request("/api/admin/dental-records?from=2026-09-15&to=2026-10-01", authed(adminCookie)),
    );
    const rangeBody = await inRange.json();
    expect(rangeBody.records.map((r: { treatmentDate: string }) => r.treatmentDate)).toEqual([
      "2026-10-01",
      "2026-09-15",
    ]);

    const singleDay = await listGet(
      request("/api/admin/dental-records?from=2026-11-03&to=2026-11-03", authed(adminCookie)),
    );
    expect((await singleDay.json()).records).toHaveLength(1);

    const byDiagnosis = await listGet(
      request("/api/admin/dental-records?q=gingivitis", authed(adminCookie)),
    );
    expect((await byDiagnosis.json()).records).toHaveLength(1);

    const byName = await listGet(
      request("/api/admin/dental-records?q=Rahul", authed(adminCookie)),
    );
    expect((await byName.json()).records).toHaveLength(2);

    const inverted = await listGet(
      request("/api/admin/dental-records?from=2026-12-01&to=2026-01-01", authed(adminCookie)),
    );
    expect(inverted.status).toBe(400);
  });

  it("paginates", async () => {
    const response = await listGet(
      request("/api/admin/dental-records?page=2&pageSize=2", authed(adminCookie)),
    );
    const body = await response.json();
    expect(body.records).toHaveLength(1);
    expect(body.pagination).toMatchObject({ page: 2, pageSize: 2, total: 3, totalPages: 2 });
  });

  /* ---------------- detail ---------------- */

  it("returns the detail shape for one record", async () => {
    const response = await detailGet(
      request(`/api/admin/dental-records/${recordId}`, authed(adminCookie)),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.record).toMatchObject({
      id: recordId,
      patientName: "Asha Verma",
      treatmentDate: "2026-11-03",
      diagnosis: "Dental caries — 36 MO",
      clinicalNotes: "Mild sensitivity noted.",
    });
    expect(body.files).toEqual([]);
    expect(body.permissions).toEqual({ canEdit: true, canDelete: true });
    expect(body.timezone).toBeTruthy();
    // F-5: explicit list metadata — never a silent cut.
    expect(body.filesTotal).toBe(0);
    expect(body.truncated).toBe(false);
  });

  it("404s an unknown record id", async () => {
    const response = await detailGet(
      request("/api/admin/dental-records/nope", authed(adminCookie)),
    );
    expect(response.status).toBe(404);
  });

  it("detail reports filesTotal + truncated and NEVER silently cuts the list [F-5]", async () => {
    const created = await listPost(
      request(
        "/api/admin/dental-records",
        {
          method: "POST",
          body: {
            patientId: ashaId,
            treatmentDate: "2026-11-04",
            diagnosis: "Truncation test",
            treatmentDetails: "details",
          },
        },
        authed(adminCookie),
      ),
    );
    expect(created.status).toBe(201);
    const target = (await created.json()).record.id as string;

    // One record BEYOND the 200-row response cap.
    const TOTAL = 201;
    const idOf = (i: number) => `ctrunc${String(i).padStart(4, "0")}`;
    const cleanupAfter = new Date(Date.now() + 600_000);
    await prisma!.dentalFile.createMany({
      data: Array.from({ length: TOTAL }, (_, i) => ({
        id: idOf(i),
        recordId: target,
        r2Key: `dental/${ashaId}/${target}/${idOf(i)}.jpg`,
        originalName: `xr-${i}.jpg`,
        contentType: "image/jpeg",
        byteSize: 100,
        status: "AVAILABLE" as const,
        cleanupAfter,
      })),
    });

    try {
      const response = await detailGet(
        request(`/api/admin/dental-records/${target}`, authed(adminCookie)),
      );
      expect(response.status).toBe(200);
      const body = await response.json();

      // The list keeps its existing cap AND ordering …
      expect(body.files).toHaveLength(200);
      // … but the truth is surfaced explicitly instead of dropping a row
      // without saying so.
      expect(body.filesTotal).toBe(201);
      expect(body.truncated).toBe(true);

      // A record under the cap says so explicitly as well.
      const small = await detailGet(
        request(`/api/admin/dental-records/${recordId}`, authed(adminCookie)),
      );
      const smallBody = await small.json();
      expect(smallBody.truncated).toBe(false);
      expect(smallBody.filesTotal).toBe(smallBody.files.length);
    } finally {
      // Remove the synthetic rows (cascades with the record).
      await prisma!.dentalRecord.delete({ where: { id: target } });
    }
  });

  /* ---------------- update ---------------- */

  it("updates fields with a changed-field audit", async () => {
    const response = await detailPatch(
      request(
        `/api/admin/dental-records/${recordId}`,
        { method: "PATCH", body: { diagnosis: "Dental caries — 36 MO (revised)", clinicalNotes: "" } },
        authed(adminCookie),
      ),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.record.diagnosis).toBe("Dental caries — 36 MO (revised)");
    // PATCH answers with the LIST shape — re-fetch the detail to confirm the
    // cleared notes were persisted as null.
    const detail = await detailGet(
      request(`/api/admin/dental-records/${recordId}`, authed(adminCookie)),
    );
    expect(detail.status).toBe(200);
    expect((await detail.json()).record.clinicalNotes).toBeNull();

    const audit = await prisma!.auditLog.findFirst({
      where: { action: "dentalrecord.update", entityId: recordId },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
    const metadata = audit?.metadata as { fields?: string[] };
    expect(metadata.fields).toEqual(expect.arrayContaining(["diagnosis", "clinicalNotes"]));
  });

  it("rejects an empty patch and an unknown id", async () => {
    const empty = await detailPatch(
      request(`/api/admin/dental-records/${recordId}`, { method: "PATCH", body: {} }, authed(adminCookie)),
    );
    expect(empty.status).toBe(400);

    const unknown = await detailPatch(
      request("/api/admin/dental-records/nope", { method: "PATCH", body: { diagnosis: "x" } }, authed(adminCookie)),
    );
    expect(unknown.status).toBe(404);
  });

  /* ---------------- delete (soft) + file claiming ---------------- */

  it("soft-deletes a record, claims its files atomically and audits both intents", async () => {
    // A file row belonging to the record (storage is null → no physical
    // delete is attempted; the row must be claimed regardless).
    const file = await prisma!.dentalFile.create({
      data: {
        recordId,
        r2Key: `dental/${ashaId}/${recordId}/ctestfile01.jpg`,
        originalName: "xray.jpg",
        contentType: "image/jpeg",
        byteSize: 1024,
        status: "AVAILABLE",
        cleanupAfter: new Date(Date.now() + 600_000), // deliberately NOT due yet
      },
    });

    const response = await detailDelete(
      request(`/api/admin/dental-records/${recordId}`, { method: "DELETE" }, authed(adminCookie)),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ recordId, filesQueued: 1 });

    // Record is soft-deleted (row retained until cleanup Job C purges it).
    const record = await prisma!.dentalRecord.findUnique({ where: { id: recordId } });
    expect(record?.deletedAt).not.toBeNull();

    // File claimed for deletion; cleanupAfter untouched [CLK — URL-TTL guard
    // survives the claim].
    const claimedFile = await prisma!.dentalFile.findUnique({ where: { id: file.id } });
    expect(claimedFile?.status).toBe("DELETING");
    expect(claimedFile?.cleanupAfter.toISOString()).toBe(file.cleanupAfter.toISOString());

    // Intent audits: one per claimed file + one for the record.
    const fileAudit = await prisma!.auditLog.findFirst({
      where: { action: "dentalfile.delete", entityId: file.id },
    });
    expect((fileAudit?.metadata as { trigger?: string }).trigger).toBe("record_delete");
    const recordAudit = await prisma!.auditLog.findFirst({
      where: { action: "dentalrecord.delete", entityId: recordId },
    });
    expect(recordAudit).not.toBeNull();

    // The record disappears from every read path.
    expect(
      (await detailGet(request(`/api/admin/dental-records/${recordId}`, authed(adminCookie)))).status,
    ).toBe(404);
    const list = await listGet(request("/api/admin/dental-records", authed(adminCookie)));
    const listBody = await list.json();
    expect(listBody.records.find((r: { id: string }) => r.id === recordId)).toBeUndefined();
  });

  it("404s a second delete of the same record", async () => {
    const response = await detailDelete(
      request(`/api/admin/dental-records/${recordId}`, { method: "DELETE" }, authed(adminCookie)),
    );
    expect(response.status).toBe(404);
  });

  it("never serializes password or session material", async () => {
    const list = await listGet(request("/api/admin/dental-records", authed(adminCookie)));
    const text = JSON.stringify(await list.json());
    expect(text).not.toContain("passwordHash");
    expect(text).not.toContain("scrypt$");
    expect(text).not.toContain("tgd_session");
  });
});
