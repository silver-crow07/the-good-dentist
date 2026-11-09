/**
 * Phase D unit tests — request validation schemas (Zod, no DB).
 *
 * Manifest ids: [S*] query bounds · [P*] create/update shapes (strict) ·
 * [I*] upload-init bounds · cleanup body.
 */

import { describe, expect, it } from "vitest";

import {
  adminDentalRecordsQuerySchema,
  completeDentalFileSchema,
  createDentalRecordSchema,
  initDentalFileSchema,
  manualCleanupSchema,
  updateDentalRecordSchema,
} from "@/lib/server/validation";

describe("dental-record list query [S*]", () => {
  it("accepts an empty query (all filters optional)", () => {
    expect(adminDentalRecordsQuerySchema.safeParse({}).success).toBe(true);
  });

  it("coerces and bounds pagination", () => {
    const ok = adminDentalRecordsQuerySchema.safeParse({ page: "3", pageSize: "50" });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data).toMatchObject({ page: 3, pageSize: 50 });

    expect(adminDentalRecordsQuerySchema.safeParse({ page: "0" }).success).toBe(false);
    expect(adminDentalRecordsQuerySchema.safeParse({ pageSize: "500" }).success).toBe(false);
  });

  it("rejects an inverted date range", () => {
    expect(
      adminDentalRecordsQuerySchema.safeParse({ from: "2026-11-10", to: "2026-11-01" }).success,
    ).toBe(false);
    expect(
      adminDentalRecordsQuerySchema.safeParse({ from: "2026-11-01", to: "2026-11-10" }).success,
    ).toBe(true);
  });

  it("rejects malformed dates and over-long searches", () => {
    expect(adminDentalRecordsQuerySchema.safeParse({ from: "10-11-2026" }).success).toBe(false);
    expect(adminDentalRecordsQuerySchema.safeParse({ q: "x".repeat(101) }).success).toBe(false);
  });
});

describe("create dental record [P*]", () => {
  const valid = {
    patientId: "pat_1",
    treatmentDate: "2026-11-03",
    diagnosis: "Dental caries — 36 MO",
    treatmentDetails: "Composite restoration completed.",
  };

  it("accepts the minimum valid record", () => {
    expect(createDentalRecordSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts optional clinical notes", () => {
    expect(
      createDentalRecordSchema.safeParse({ ...valid, clinicalNotes: "Follow-up in 2 weeks." })
        .success,
    ).toBe(true);
  });

  it("is STRICT — unknown keys are rejected", () => {
    expect(createDentalRecordSchema.safeParse({ ...valid, evil: "payload" }).success).toBe(false);
    expect(createDentalRecordSchema.safeParse({ ...valid, id: "forced-id" }).success).toBe(false);
    expect(createDentalRecordSchema.safeParse({ ...valid, deletedAt: null }).success).toBe(false);
  });

  it("bounds every field", () => {
    expect(createDentalRecordSchema.safeParse({ ...valid, diagnosis: "" }).success).toBe(false);
    expect(createDentalRecordSchema.safeParse({ ...valid, diagnosis: "x".repeat(501) }).success).toBe(false);
    expect(createDentalRecordSchema.safeParse({ ...valid, treatmentDetails: "" }).success).toBe(false);
    expect(createDentalRecordSchema.safeParse({ ...valid, treatmentDetails: "x".repeat(5001) }).success).toBe(false);
    expect(createDentalRecordSchema.safeParse({ ...valid, treatmentDate: "2026-11-3" }).success).toBe(false);
    expect(createDentalRecordSchema.safeParse({ ...valid, patientId: "" }).success).toBe(false);
  });
});

describe("update dental record [P*]", () => {
  it("requires at least one field", () => {
    expect(updateDentalRecordSchema.safeParse({}).success).toBe(false);
    expect(updateDentalRecordSchema.safeParse({ diagnosis: "caries" }).success).toBe(true);
    expect(
      updateDentalRecordSchema.safeParse({ treatmentDate: "2026-11-03", clinicalNotes: "" })
        .success,
    ).toBe(true);
  });

  it("is STRICT — no injection of ids or delete flags", () => {
    expect(updateDentalRecordSchema.safeParse({ deletedAt: null }).success).toBe(false);
    expect(updateDentalRecordSchema.safeParse({ patientId: "other" }).success).toBe(false);
  });
});

describe("upload init [I*]", () => {
  const valid = { originalName: "xray.jpg", contentType: "image/jpeg", byteSize: 2048 };

  it("accepts a declared JPEG within the size cap", () => {
    expect(initDentalFileSchema.safeParse(valid).success).toBe(true);
    expect(initDentalFileSchema.safeParse({ ...valid, byteSize: 10 * 1024 * 1024 }).success).toBe(true);
  });

  it("rejects oversize, empty, fractional and unknown-key payloads", () => {
    expect(initDentalFileSchema.safeParse({ ...valid, byteSize: 10 * 1024 * 1024 + 1 }).success).toBe(false);
    expect(initDentalFileSchema.safeParse({ ...valid, byteSize: 0 }).success).toBe(false);
    expect(initDentalFileSchema.safeParse({ ...valid, byteSize: 10.5 }).success).toBe(false);
    expect(initDentalFileSchema.safeParse({ ...valid, r2Key: "dental/evil" }).success).toBe(false);
    expect(initDentalFileSchema.safeParse({ ...valid, status: "AVAILABLE" }).success).toBe(false);
  });

  it("bounds the file name", () => {
    expect(initDentalFileSchema.safeParse({ ...valid, originalName: "" }).success).toBe(false);
    expect(initDentalFileSchema.safeParse({ ...valid, originalName: "x".repeat(256) }).success).toBe(false);
  });
});

describe("complete / cleanup bodies", () => {
  it("complete takes an empty strict object", () => {
    expect(completeDentalFileSchema.safeParse({}).success).toBe(true);
    expect(completeDentalFileSchema.safeParse({ force: true }).success).toBe(false);
  });

  it("manual cleanup body is optional and strict", () => {
    expect(manualCleanupSchema.safeParse(undefined).success).toBe(true);
    expect(manualCleanupSchema.safeParse({}).success).toBe(true);
    expect(manualCleanupSchema.safeParse({ confirm: true }).success).toBe(true);
    expect(manualCleanupSchema.safeParse({ confirm: "yes" }).success).toBe(false);
    expect(manualCleanupSchema.safeParse({ mode: "everything" }).success).toBe(false);
  });
});
