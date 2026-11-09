/**
 * Dental records service (Phase D) — ADMIN-only CRUD + audit.
 *
 * Design rules (mirrors admin/patients.ts):
 *  - Every mutation writes its AuditLog row inside the SAME transaction as
 *    the data change (dentalrecord.create / .update / .delete).
 *  - Deletion is a SOFT delete (`deletedAt`); the physical purge is done by
 *    cleanup Job C once every file of the record has been removed, and the
 *    file deletions themselves are claimed (status → DELETING) in this same
 *    transaction with a per-file `dentalfile.delete` intent audit.
 *  - `treatmentDate` is a clinic-local calendar date (DATE column); the
 *    string form sent to clients is always `YYYY-MM-DD`.
 *  - Returns `null` when no database is configured (route → 503).
 */

import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import { getPrisma } from "../db";
import { getStorage } from "../storage";
import type { AdminDentalRecordQuery, CreateDentalRecordInput, UpdateDentalRecordInput } from "../validation";
import { AdminError } from "./dashboard";
import { deleteRowBackedFile } from "./dental-delete";

export { AdminError };

/**
 * Files included in ONE detail response. Beyond this the response still
 * reports the truth via `filesTotal` + `truncated` — the list is never
 * silently cut (F-5).
 */
const FILES_CAP = 200;

export type DentalFileStatusKey = "PENDING" | "AVAILABLE" | "REJECTED" | "DELETING";

export type AdminDentalRecordListItem = {
  id: string;
  patientId: string;
  patientName: string;
  /** `YYYY-MM-DD` (clinic-local treatment date). */
  treatmentDate: string;
  diagnosis: string;
  fileCount: number;
  availableFileCount: number;
  createdAt: string;
  updatedAt: string;
};

export type AdminDentalRecordsPage = {
  timezone: string;
  records: AdminDentalRecordListItem[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

export type AdminDentalFileItem = {
  id: string;
  originalName: string;
  contentType: string;
  byteSize: number;
  status: DentalFileStatusKey;
  createdAt: string;
  updatedAt: string;
};

export type AdminDentalRecordDetail = {
  timezone: string;
  record: {
    id: string;
    patientId: string;
    patientName: string;
    treatmentDate: string;
    diagnosis: string;
    treatmentDetails: string;
    clinicalNotes: string | null;
    /** Author display name; null when the staff account was deleted. */
    author: string | null;
    createdAt: string;
    updatedAt: string;
  };
  files: AdminDentalFileItem[];
  /**
   * F-5 — full file count for this record (NOT limited by the response cap),
   * and whether `files` was truncated to the first FILES_CAP rows. The list
   * is never silently cut: the UI surfaces `truncated` with `filesTotal`.
   */
  filesTotal: number;
  truncated: boolean;
  permissions: { canEdit: boolean; canDelete: boolean };
};

function requirePrisma(): PrismaClient {
  const prisma = getPrisma();
  if (!prisma) {
    throw new AdminError(
      "SERVICE_UNAVAILABLE",
      "Dental records are temporarily unavailable — the database is not configured.",
    );
  }
  return prisma;
}

/** DATE column → `YYYY-MM-DD` (never a locale-rendered string). */
function dateKeyOf(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` → the UTC midnight instant Prisma stores for a DATE. */
function dateOfKey(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

const RECORD_LIST_SELECT = {
  id: true,
  patientId: true,
  treatmentDate: true,
  diagnosis: true,
  createdAt: true,
  updatedAt: true,
  patient: { select: { fullName: true } },
  _count: { select: { files: true } },
} satisfies Prisma.DentalRecordSelect;

type RecordListRow = Prisma.DentalRecordGetPayload<{ select: typeof RECORD_LIST_SELECT }>;

function toListItem(
  row: RecordListRow,
  availableCounts: Map<string, number>,
): AdminDentalRecordListItem {
  return {
    id: row.id,
    patientId: row.patientId,
    patientName: row.patient.fullName,
    treatmentDate: dateKeyOf(row.treatmentDate),
    diagnosis: row.diagnosis,
    fileCount: row._count.files,
    availableFileCount: availableCounts.get(row.id) ?? 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Paginated dental-record history, newest treatment date first.
 *
 * Filters: `patientId` (a patient's own chronological history), `from`/`to`
 * (treatment-date range, inclusive) and `q` (diagnosis or patient name).
 * Soft-deleted records are never listed.
 */
export async function listDentalRecords(
  query: AdminDentalRecordQuery,
): Promise<AdminDentalRecordsPage | null> {
  const prisma = getPrisma();
  if (!prisma) return null;

  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const search = query.q?.trim() || undefined;

  const where: Prisma.DentalRecordWhereInput = {
    deletedAt: null,
    ...(query.patientId ? { patientId: query.patientId } : {}),
    ...(query.from || query.to
      ? {
          treatmentDate: {
            ...(query.from ? { gte: dateOfKey(query.from) } : {}),
            ...(query.to ? { lte: dateOfKey(query.to) } : {}),
          },
        }
      : {}),
    ...(search
      ? {
          OR: [
            { diagnosis: { contains: search, mode: "insensitive" } },
            { patient: { fullName: { contains: search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [rows, total, config] = await Promise.all([
    prisma.dentalRecord.findMany({
      where,
      orderBy: [{ treatmentDate: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: RECORD_LIST_SELECT,
    }),
    prisma.dentalRecord.count({ where }),
    prisma.clinicConfig.findUnique({ where: { id: "singleton" }, select: { timezone: true } }),
  ]);

  const availableCounts = new Map<string, number>();
  if (rows.length > 0) {
    const grouped = await prisma.dentalFile.groupBy({
      by: ["recordId"],
      where: { recordId: { in: rows.map((row) => row.id) }, status: "AVAILABLE" },
      _count: { _all: true },
    });
    for (const group of grouped) availableCounts.set(group.recordId, group._count._all);
  }

  return {
    timezone: config?.timezone ?? "Asia/Kolkata",
    records: rows.map((row) => toListItem(row, availableCounts)),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

/** One record + its files (chronological). Soft-deleted → NOT_FOUND. */
export async function getDentalRecord(id: string): Promise<AdminDentalRecordDetail | null> {
  const prisma = getPrisma();
  if (!prisma) return null;

  const record = await prisma.dentalRecord.findUnique({
    where: { id },
    select: {
      id: true,
      patientId: true,
      treatmentDate: true,
      diagnosis: true,
      treatmentDetails: true,
      clinicalNotes: true,
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
      patient: { select: { fullName: true } },
      author: { select: { fullName: true } },
      files: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: FILES_CAP,
        select: {
          id: true,
          originalName: true,
          contentType: true,
          byteSize: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });
  if (!record || record.deletedAt) throw new AdminError("NOT_FOUND", "Dental record not found.");

  // F-5 — the list above is capped at FILES_CAP; surface the TRUE total and
  // an explicit `truncated` flag instead of silently dropping rows.
  const filesTotal = await prisma.dentalFile.count({ where: { recordId: id } });

  const config = await prisma.clinicConfig.findUnique({
    where: { id: "singleton" },
    select: { timezone: true },
  });

  return {
    timezone: config?.timezone ?? "Asia/Kolkata",
    record: {
      id: record.id,
      patientId: record.patientId,
      patientName: record.patient.fullName,
      treatmentDate: dateKeyOf(record.treatmentDate),
      diagnosis: record.diagnosis,
      treatmentDetails: record.treatmentDetails,
      clinicalNotes: record.clinicalNotes,
      author: record.author?.fullName ?? null,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    },
    files: record.files.map((file) => ({
      id: file.id,
      originalName: file.originalName,
      contentType: file.contentType,
      byteSize: file.byteSize,
      status: file.status as DentalFileStatusKey,
      createdAt: file.createdAt.toISOString(),
      updatedAt: file.updatedAt.toISOString(),
    })),
    filesTotal,
    truncated: filesTotal > record.files.length,
    permissions: { canEdit: true, canDelete: true },
  };
}

/** Create a record (ADMIN) — audited in the same transaction. */
export async function createDentalRecord(
  input: CreateDentalRecordInput,
  staffId: string,
): Promise<AdminDentalRecordListItem> {
  const prisma = requirePrisma();

  const created = await prisma.$transaction(async (tx) => {
    const patient = await tx.patient.findUnique({
      where: { id: input.patientId },
      select: { id: true },
    });
    if (!patient) throw new AdminError("NOT_FOUND", "Patient not found.");

    const record = await tx.dentalRecord.create({
      data: {
        patientId: input.patientId,
        treatmentDate: dateOfKey(input.treatmentDate),
        diagnosis: input.diagnosis.trim(),
        treatmentDetails: input.treatmentDetails.trim(),
        clinicalNotes: input.clinicalNotes?.trim() || null,
        createdBy: staffId,
      },
      select: RECORD_LIST_SELECT,
    });
    await tx.auditLog.create({
      data: {
        staffId,
        action: "dentalrecord.create",
        entityType: "DentalRecord",
        entityId: record.id,
        metadata: { patientId: input.patientId, treatmentDate: input.treatmentDate },
      },
    });
    return record;
  });

  return toListItem(created, new Map());
}

/** Edit a record (ADMIN) — partial update, audited with changed field names. */
export async function updateDentalRecord(
  id: string,
  input: UpdateDentalRecordInput,
  staffId: string,
): Promise<AdminDentalRecordListItem> {
  const prisma = requirePrisma();

  const data: Prisma.DentalRecordUpdateInput = {};
  const fields: string[] = [];
  if (input.treatmentDate !== undefined) {
    data.treatmentDate = dateOfKey(input.treatmentDate);
    fields.push("treatmentDate");
  }
  if (input.diagnosis !== undefined) {
    data.diagnosis = input.diagnosis.trim();
    fields.push("diagnosis");
  }
  if (input.treatmentDetails !== undefined) {
    data.treatmentDetails = input.treatmentDetails.trim();
    fields.push("treatmentDetails");
  }
  if (input.clinicalNotes !== undefined) {
    data.clinicalNotes = input.clinicalNotes.trim() || null;
    fields.push("clinicalNotes");
  }
  if (fields.length === 0) {
    throw new AdminError("VALIDATION_ERROR", "Provide at least one field to update.");
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.dentalRecord.findUnique({
      where: { id },
      select: { id: true, deletedAt: true },
    });
    if (!existing || existing.deletedAt) throw new AdminError("NOT_FOUND", "Dental record not found.");

    const record = await tx.dentalRecord.update({
      where: { id },
      data,
      select: RECORD_LIST_SELECT,
    });
    await tx.auditLog.create({
      data: {
        staffId,
        action: "dentalrecord.update",
        entityType: "DentalRecord",
        entityId: id,
        metadata: { fields },
      },
    });

    const grouped = await tx.dentalFile.groupBy({
      by: ["status"],
      where: { recordId: id, status: "AVAILABLE" },
      _count: { _all: true },
    });
    const available = grouped.reduce((sum, group) => sum + group._count._all, 0);
    return toListItem(record, new Map([[id, available]]));
  });
}

/**
 * Delete a record (ADMIN): SOFT delete + claim every file for deletion.
 *
 * One transaction, all-or-nothing:
 *   1. `deletedAt` is set (the record disappears from every listing),
 *   2. every file not already DELETING is claimed (`status → DELETING`,
 *      `cleanupAfter` untouched — Job A still refuses to remove an object
 *      before its URL-TTL window has closed),
 *   3. one `dentalfile.delete` INTENT audit per claimed file,
 *   4. one `dentalrecord.delete` audit.
 *
 * Physical object removal happens later (the endpoint tries immediately,
 * cleanup Job A retries) — always after a HEAD confirmation.
 */
export async function deleteDentalRecord(
  id: string,
  staffId: string,
): Promise<{ recordId: string; filesQueued: number }> {
  const prisma = requirePrisma();

  const claimed = await prisma.$transaction(async (tx) => {
    const record = await tx.dentalRecord.findUnique({
      where: { id },
      select: { id: true, patientId: true, deletedAt: true },
    });
    if (!record || record.deletedAt) throw new AdminError("NOT_FOUND", "Dental record not found.");

    await tx.dentalRecord.update({ where: { id }, data: { deletedAt: new Date() } });

    // Claim every file that is not already being deleted. `cleanupAfter` is
    // deliberately NOT reset: the URL-TTL guard still applies.
    const rows = await tx.$queryRaw<
      Array<{ id: string; r2Key: string; cleanupAfter: Date }>
    >`
      UPDATE "DentalFile"
         SET "status" = 'DELETING', "updatedAt" = clock_timestamp()
       WHERE "recordId" = ${id} AND "status" <> 'DELETING'
      RETURNING "id", "r2Key", "cleanupAfter"`;

    for (const file of rows) {
      await tx.auditLog.create({
        data: {
          staffId,
          action: "dentalfile.delete",
          entityType: "DentalFile",
          entityId: file.id,
          metadata: { trigger: "record_delete", recordId: id },
        },
      });
    }
    await tx.auditLog.create({
      data: {
        staffId,
        action: "dentalrecord.delete",
        entityType: "DentalRecord",
        entityId: id,
        metadata: { patientId: record.patientId, filesQueued: rows.length },
      },
    });

    return rows;
  });

  // Best-effort immediate physical delete (guarded: URL-TTL + lease + HEAD
  // + txA/txB protocol). Anything not yet due stays DELETING for Job A —
  // the intent audits above are already durable either way.
  const storage = getStorage();
  if (storage) {
    for (const file of claimed) {
      try {
        await deleteRowBackedFile(
          prisma,
          storage,
          { id: file.id, r2Key: file.r2Key, cleanupAfter: file.cleanupAfter },
          null, // admin path: the cleanup lease must be FREE to proceed
        );
      } catch (error) {
        // Never fail the audited soft-delete because a physical delete
        // attempt errored — Job A retries it.
        console.error("[dental-records] immediate file delete failed:", error instanceof Error ? error.message : error);
      }
    }
  }

  return { recordId: id, filesQueued: claimed.length };
}
