/**
 * Dental file workflows (Phase D) — upload-init, upload-complete, secure
 * download URL, and deletion, all ADMIN-only.
 *
 * Security invariants enforced here (never in the client):
 *  - Storage keys are ALWAYS server-generated (`dental/{patientId}/
 *    {recordId}/{fileId}.{ext}`); the original name only influences the
 *    normalised extension.
 *  - R2 credentials never leave the server — the browser only ever sees a
 *    short-lived presigned URL issued after the session check.
 *  - Upload is two-phase: init reserves the row + key (registry-first, in
 *    one transaction) and only then presigns; complete RE-VALIDATES from
 *    storage itself (HEAD size + magic bytes + family match) before a file
 *    can ever become AVAILABLE.
 *  - Size is capped at MAX_FILE_BYTES (10 MB): init re-validates the
 *    DECLARED size (F-3 service guard) and complete rejects an OVERSIZE
 *    object from its HEAD size — because a presigned PUT cannot bind the
 *    body size cryptographically (Content-Length is unsigned, see
 *    storage/r2.ts).
 *  - Per-record file cap (DENTAL_MAX_FILES_PER_RECORD, default 50): the
 *    count is checked under a `FOR UPDATE` lock on the record row, so
 *    concurrent inits serialize; hitting the limit is a 409 CONFLICT (F-5),
 *    never a silent truncation.
 *  - Every upload/download/deletion/rejection writes an AuditLog row.
 *  - Physical deletion goes through the shared guarded protocol in
 *    dental-delete.ts (cleanupAfter guard → HEAD → txA intent → final
 *    holdsLease → DeleteObject → HEAD confirm → txB finalise + row removal).
 */

import { Prisma, type PrismaClient } from "@/generated/prisma/client";

import { getPrisma, type PrismaTx } from "../db";
import { getDentalMaxFilesPerRecord } from "../env";
import { getStorage } from "../storage";
import {
  buildDentalKey,
  cleanupAfterFor,
  extensionOf,
  familyOfExtension,
  matchesFamily,
  matchesMagicBytes,
  MAX_FILE_BYTES,
  newFileId,
  URL_TTL_SECONDS,
} from "../storage/pure";
import type { InitDentalFileInput } from "../validation";
import { AdminError } from "./dashboard";
import { deleteRowBackedFile } from "./dental-delete";

export { AdminError };

/** Reservation attempts when the generated file id collides (registry PK). */
const MAX_RESERVE_ATTEMPTS = 3;

/** Bytes read from storage for the magic-byte check. */
const MAGIC_READ_BYTES = 16;

export type UploadTicket = {
  fileId: string;
  r2Key: string;
  originalName: string;
  contentType: string;
  byteSize: number;
  /** The browser MUST send `headers` exactly with `url` (they are signed). */
  upload: { url: string; method: "PUT"; headers: Record<string, string>; expiresAt: string };
};

export type CompletedFile = {
  id: string;
  status: "AVAILABLE" | "REJECTED";
  originalName: string;
  contentType: string;
  byteSize: number;
  reason?: string;
};

function requirePrisma(): PrismaClient {
  const prisma = getPrisma();
  if (!prisma) {
    throw new AdminError(
      "SERVICE_UNAVAILABLE",
      "File storage is temporarily unavailable — the database is not configured.",
    );
  }
  return prisma;
}

function requireStorage() {
  const storage = getStorage();
  if (!storage) {
    throw new AdminError(
      "SERVICE_UNAVAILABLE",
      "File storage is not configured on this server yet.",
    );
  }
  return storage;
}

/** True when the name has a supported (jpg/jpeg/png) extension. */
function buildDentalKeySafe(originalName: string): boolean {
  const ext = extensionOf(originalName);
  return ext !== null && familyOfExtension(ext) !== null;
}

async function writeAudit(
  tx: PrismaTx,
  data: {
    staffId: string | null;
    action: string;
    entityId: string | null;
    metadata?: Prisma.InputJsonValue;
  },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      staffId: data.staffId,
      action: data.action,
      entityType: "DentalFile",
      entityId: data.entityId,
      ...(data.metadata !== undefined ? { metadata: data.metadata } : {}),
    },
  });
}

type LoadedFile = {
  id: string;
  recordId: string;
  r2Key: string;
  originalName: string;
  contentType: string;
  byteSize: number;
  status: string;
  cleanupAfter: Date;
  record: { deletedAt: Date | null };
};

/** Loads a file + its record's soft-delete flag; 404 when either is gone. */
async function loadFile(db: PrismaTx, fileId: string): Promise<LoadedFile> {
  const file = await db.dentalFile.findUnique({
    where: { id: fileId },
    select: {
      id: true,
      recordId: true,
      r2Key: true,
      originalName: true,
      contentType: true,
      byteSize: true,
      status: true,
      cleanupAfter: true,
      record: { select: { deletedAt: true } },
    },
  });
  if (!file || file.record.deletedAt) {
    throw new AdminError("NOT_FOUND", "File not found.");
  }
  return file;
}

/* ------------------------------------------------------------------ *
 * Upload init — reserve row + key first, presign only after commit
 * ------------------------------------------------------------------ */

export async function initDentalFileUpload(
  recordId: string,
  input: InitDentalFileInput,
  staffId: string,
): Promise<UploadTicket> {
  const prisma = requirePrisma();
  const storage = requireStorage();

  // Declared type must be in the allow-list AND agree with the extension.
  if (!matchesFamily(input.originalName, input.contentType)) {
    throw new AdminError(
      "VALIDATION_ERROR",
      "Only JPEG or PNG images are allowed, and the file name must match the type.",
      { contentType: "File type is not allowed." },
    );
  }

  // F-3 — service-level size guard (defense-in-depth beyond the route's zod
  // schema): the DECLARED size must be a positive integer within the hard
  // cap. This cannot make the presigned PUT itself enforce a size (see
  // storage/r2.ts — Content-Length is not part of the signature); the real
  // object is re-checked against storage at complete (oversize + size
  // equality + magic bytes) before it can ever become AVAILABLE.
  if (!Number.isInteger(input.byteSize) || input.byteSize < 1 || input.byteSize > MAX_FILE_BYTES) {
    throw new AdminError(
      "VALIDATION_ERROR",
      "Files must be between 1 byte and 10 MB.",
      { byteSize: "File size is not allowed." },
    );
  }

  const record = await prisma.dentalRecord.findUnique({
    where: { id: recordId },
    select: { id: true, deletedAt: true },
  });
  if (!record || record.deletedAt) throw new AdminError("NOT_FOUND", "Dental record not found.");

  // Registry-first reservation: R2KeyRegistry + DentalFile are created in
  // ONE transaction, so a retired key can never be re-issued and a failed
  // reservation never leaves a half-created row.
  let reserved: { fileId: string; r2Key: string } | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < MAX_RESERVE_ATTEMPTS && !reserved; attempt += 1) {
    const fileId = newFileId();
    // Extension must be supported BEFORE entering the transaction (throws
    // a validation error for anything that is not jpg/jpeg/png).
    if (!buildDentalKeySafe(input.originalName)) {
      throw new AdminError("VALIDATION_ERROR", "That file type is not supported.");
    }

    try {
      reserved = await prisma.$transaction(async (tx) => {
        // F-5 — lock the RECORD row FIRST. Concurrent upload inits for the
        // same record serialize on this FOR UPDATE lock, so the file count
        // below is always taken against a stable set: two racing requests
        // can never both pass the cap check and over-admit. The lock also
        // guards the patientId read so the row and key always agree.
        const [locked] = await tx.$queryRaw<Array<{ patientId: string; deletedAt: Date | null }>>`
          SELECT r."patientId", r."deletedAt"
            FROM "DentalRecord" r
           WHERE r."id" = ${recordId}
           FOR UPDATE`;
        if (!locked || locked.deletedAt) {
          throw new AdminError("NOT_FOUND", "Dental record not found.");
        }

        // F-5 — configurable per-record file cap, checked inside the locked
        // transaction. Hitting the limit is an explicit 409 CONFLICT; uploads
        // are never silently truncated or dropped.
        const maxFiles = getDentalMaxFilesPerRecord();
        const [{ count }] = await tx.$queryRaw<Array<{ count: number }>>`
          SELECT COUNT(*)::int AS count
            FROM "DentalFile"
           WHERE "recordId" = ${recordId}`;
        if (count >= maxFiles) {
          throw new AdminError(
            "CONFLICT",
            `This record already has the maximum of ${maxFiles} files. Delete an existing file before uploading another.`,
            { files: "File limit reached for this record." },
          );
        }

        const finalKey = buildDentalKey({
          patientId: locked.patientId,
          recordId,
          fileId,
          originalName: input.originalName,
        }).key;

        await tx.r2KeyRegistry.create({ data: { r2Key: finalKey } });
        await tx.dentalFile.create({
          data: {
            id: fileId,
            recordId,
            r2Key: finalKey,
            originalName: input.originalName.slice(0, 255),
            contentType: input.contentType,
            byteSize: input.byteSize,
            status: "PENDING",
            cleanupAfter: cleanupAfterFor(new Date()),
            uploadedBy: staffId,
          },
          select: { id: true },
        });
        return { fileId, r2Key: finalKey };
      });
    } catch (error) {
      lastError = error;
      const isKeyCollision =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
      if (!isKeyCollision) throw error;
      // File-id collision → retry with a fresh id (KK test path).
    }
  }

  if (!reserved) {
    if (lastError) throw lastError;
    throw new AdminError("CONFLICT", "Could not reserve a unique storage key — please retry.");
  }

  // Presign AFTER the commit: a presigned URL for an unreserved key can
  // never exist.
  const ticket = await storage.presignPut({
    key: reserved.r2Key,
    contentType: input.contentType,
    expiresInSeconds: URL_TTL_SECONDS,
  });

  return {
    fileId: reserved.fileId,
    r2Key: reserved.r2Key,
    originalName: input.originalName,
    contentType: input.contentType,
    byteSize: input.byteSize,
    upload: {
      url: ticket.url,
      method: ticket.method,
      headers: ticket.headers,
      expiresAt: new Date(Date.now() + URL_TTL_SECONDS * 1000).toISOString(),
    },
  };
}

/* ------------------------------------------------------------------ *
 * Upload complete — server-side verification from STORAGE
 * ------------------------------------------------------------------ */

async function rejectFile(
  db: PrismaClient,
  fileId: string,
  staffId: string,
  reason: string,
): Promise<CompletedFile> {
  const updated = await db.$transaction(async (tx) => {
    const current = await tx.dentalFile.findUnique({
      where: { id: fileId },
      select: { id: true, status: true, originalName: true, contentType: true, byteSize: true },
    });
    if (!current) throw new AdminError("NOT_FOUND", "File not found.");
    if (current.status !== "PENDING") {
      // Another request already decided (idempotent replay).
      return { ...current, status: current.status as CompletedFile["status"], reason };
    }
    const row = await tx.dentalFile.update({
      where: { id: fileId },
      data: { status: "REJECTED" },
      select: {
        id: true,
        status: true,
        originalName: true,
        contentType: true,
        byteSize: true,
      },
    });
    await writeAudit(tx, {
      staffId,
      action: "dentalfile.rejected",
      entityId: fileId,
      metadata: { reason },
    });
    return { ...row, reason };
  });
  return updated as CompletedFile;
}

/**
 * Verifies the uploaded object against storage and flips PENDING →
 * AVAILABLE (audited `dentalfile.upload`) or PENDING → REJECTED (audited
 * `dentalfile.rejected`). A REJECTED object is never served; cleanup Job B
 * sweeps it once its cleanupAfter window has closed.
 *
 * Idempotent: replaying on an already-AVAILABLE file returns the current
 * state without a second audit row.
 */
export async function completeDentalFileUpload(
  fileId: string,
  staffId: string,
): Promise<CompletedFile> {
  const prisma = requirePrisma();
  const storage = requireStorage();
  const file = await loadFile(prisma, fileId);

  if (file.status === "AVAILABLE") {
    return {
      id: file.id,
      status: "AVAILABLE",
      originalName: file.originalName,
      contentType: file.contentType,
      byteSize: file.byteSize,
    };
  }
  if (file.status !== "PENDING") {
    throw new AdminError("CONFLICT", `This file is ${file.status.toLowerCase()} and cannot be verified.`);
  }

  // 1. Object must exist.
  const head = await storage.headObject(file.r2Key);
  if (!head.found) {
    return rejectFile(prisma, fileId, staffId, "object_missing");
  }
  // 2. F-3 — hard oversize rejection BEFORE the declared-size comparison:
  // whatever the client claimed at init, an object above the hard cap can
  // never become AVAILABLE (belt-and-braces for rows created before the
  // service-level init guard). A presigned PUT cannot bind the body size
  // cryptographically (Content-Length is unsigned — see storage/r2.ts), so
  // this HEAD-based check is the enforcement point. The rejected object is
  // REJECTED here and physically swept by cleanup Job B after its window.
  if (head.size > MAX_FILE_BYTES) {
    return rejectFile(
      prisma,
      fileId,
      staffId,
      `oversize:limit=${MAX_FILE_BYTES}:actual=${head.size}`,
    );
  }
  // 3. Size must match what the client declared at init.
  if (head.size !== file.byteSize) {
    return rejectFile(
      prisma,
      fileId,
      staffId,
      `size_mismatch:expected=${file.byteSize}:actual=${head.size}`,
    );
  }
  // 4. Declared type must still agree with the extension.
  if (!matchesFamily(file.originalName, file.contentType)) {
    return rejectFile(prisma, fileId, staffId, "family_mismatch");
  }
  // 5. Magic bytes read FROM STORAGE must match the extension's family.
  const read = await storage.readObjectRange(file.r2Key, 0, MAGIC_READ_BYTES - 1);
  if (!read.found || !matchesMagicBytes(file.originalName, read.bytes)) {
    return rejectFile(prisma, fileId, staffId, "magic_bytes");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const current = await tx.dentalFile.findUnique({
      where: { id: fileId },
      select: { status: true },
    });
    if (!current) throw new AdminError("NOT_FOUND", "File not found.");
    if (current.status !== "PENDING") {
      return {
        id: fileId,
        status: current.status as CompletedFile["status"],
        originalName: file.originalName,
        contentType: file.contentType,
        byteSize: file.byteSize,
      } satisfies CompletedFile;
    }
    const row = await tx.dentalFile.update({
      where: { id: fileId },
      data: { status: "AVAILABLE" },
      select: {
        id: true,
        status: true,
        originalName: true,
        contentType: true,
        byteSize: true,
      },
    });
    await writeAudit(tx, {
      staffId,
      action: "dentalfile.upload",
      entityId: fileId,
      metadata: {
        recordId: file.recordId,
        byteSize: file.byteSize,
        contentType: file.contentType,
      },
    });
    return { ...row, status: row.status as CompletedFile["status"] } satisfies CompletedFile;
  });
  return updated;
}

/* ------------------------------------------------------------------ *
 * Secure download — short-lived presigned GET + audited access
 * ------------------------------------------------------------------ */

export async function getDentalFileUrl(
  fileId: string,
  staffId: string,
): Promise<{ url: string; expiresAt: string }> {
  const prisma = requirePrisma();
  const storage = requireStorage();
  const file = await loadFile(prisma, fileId);

  if (file.status !== "AVAILABLE") {
    throw new AdminError("CONFLICT", "This file is not available for download.");
  }

  const signed = await storage.presignGet({
    key: file.r2Key,
    expiresInSeconds: URL_TTL_SECONDS,
  });

  await prisma.auditLog.create({
    data: {
      staffId,
      action: "dentalfile.download",
      entityType: "DentalFile",
      entityId: fileId,
      metadata: { recordId: file.recordId, expiresAt: signed.expiresAt },
    },
  });

  return { url: signed.url, expiresAt: signed.expiresAt };
}

/* ------------------------------------------------------------------ *
 * Deletion — intent first, guarded physical delete best-effort
 * ------------------------------------------------------------------ */

export type DeleteFileResult = {
  deleted: boolean;
  /** True when the object removal is queued for cleanup Job A. */
  queued: boolean;
};

/**
 * ADMIN delete: claims the file (status → DELETING + intent audit, atomically)
 * and then attempts the guarded physical deletion immediately. When the URL
 * TTL has not elapsed yet, another live lease holder exists, or storage is
 * not configured, the row simply stays DELETING and cleanup Job A finishes
 * the job — the intent audit is already durable either way.
 */
export async function deleteDentalFile(
  fileId: string,
  staffId: string,
): Promise<DeleteFileResult> {
  const prisma = requirePrisma();

  const claimed = await prisma.$transaction(async (tx) => {
    const file = await loadFile(tx, fileId);
    if (file.status === "DELETING") return { r2Key: file.r2Key, cleanupAfter: file.cleanupAfter, fresh: false };

    await tx.dentalFile.update({
      where: { id: fileId },
      data: { status: "DELETING" },
    });
    await writeAudit(tx, {
      staffId,
      action: "dentalfile.delete",
      entityId: fileId,
      metadata: { trigger: "admin", recordId: file.recordId },
    });
    return { r2Key: file.r2Key, cleanupAfter: file.cleanupAfter, fresh: true };
  });

  const storage = getStorage();
  if (!storage) {
    // No storage configured → nothing physical to do; Job A picks it up
    // once storage exists.
    return { deleted: false, queued: true };
  }

  const outcome = await deleteRowBackedFile(
    prisma,
    storage,
    { id: fileId, r2Key: claimed.r2Key, cleanupAfter: claimed.cleanupAfter },
    null, // admin path: the cleanup lease must be FREE to proceed
  );

  if (outcome === "deleted" || outcome === "already_absent") {
    return { deleted: true, queued: false };
  }
  return { deleted: false, queued: true };
}
