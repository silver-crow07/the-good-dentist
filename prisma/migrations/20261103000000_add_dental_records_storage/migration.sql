-- Phase D — dental records + private file storage (hand-written SQL).
--
-- Prisma PSL cannot express the partial unique index on
-- StorageDeletionReceipt (one PENDING event per key), so — like the
-- Appointment_noDoctorOverlap exclusion constraint in 0_init — the whole
-- migration is written by hand and applied with `prisma migrate deploy`.
-- DDL ONLY: no INSERT statements, no data backfill.

-- CreateEnum
CREATE TYPE "DentalFileStatus" AS ENUM ('PENDING', 'AVAILABLE', 'REJECTED', 'DELETING');

-- CreateTable (dental records — soft-deleted via deletedAt, purged by Job C)
CREATE TABLE "DentalRecord" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "treatmentDate" DATE NOT NULL,
    "diagnosis" TEXT NOT NULL,
    "treatmentDetails" TEXT NOT NULL,
    "clinicalNotes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "DentalRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable (uploaded X-ray/image files; r2Key is immutable)
CREATE TABLE "DentalFile" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "r2Key" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "status" "DentalFileStatus" NOT NULL DEFAULT 'PENDING',
    "cleanupAfter" TIMESTAMP(3) NOT NULL,
    "cleanupAttempts" INTEGER NOT NULL DEFAULT 0,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DentalFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable (orphan reconciler singleton: durable cursor + lease)
CREATE TABLE "StorageScanState" (
    "id" TEXT NOT NULL,
    "lastScannedKey" TEXT,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageScanState_pkey" PRIMARY KEY ("id")
);

-- CreateTable (one ROW per deletion EVENT; r2Key alone is not an identity)
CREATE TABLE "StorageDeletionReceipt" (
    "id" TEXT NOT NULL,
    "r2Key" TEXT NOT NULL,
    "eventNo" INTEGER NOT NULL,
    "evidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "StorageDeletionReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable (permanent key tombstones — rows are NEVER deleted)
CREATE TABLE "R2KeyRegistry" (
    "r2Key" TEXT NOT NULL,
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "R2KeyRegistry_pkey" PRIMARY KEY ("r2Key")
);

-- CreateIndex
CREATE INDEX "DentalRecord_patientId_treatmentDate_idx" ON "DentalRecord"("patientId", "treatmentDate");
CREATE INDEX "DentalRecord_treatmentDate_idx" ON "DentalRecord"("treatmentDate");
CREATE INDEX "DentalRecord_deletedAt_idx" ON "DentalRecord"("deletedAt");

-- CreateIndex (r2Key uniqueness is the row-side half of the key guard)
CREATE UNIQUE INDEX "DentalFile_r2Key_key" ON "DentalFile"("r2Key");
CREATE INDEX "DentalFile_recordId_createdAt_idx" ON "DentalFile"("recordId", "createdAt");
CREATE INDEX "DentalFile_status_cleanupAfter_idx" ON "DentalFile"("status", "cleanupAfter");

-- CreateIndex (event identity: (r2Key, eventNo) — never reused)
CREATE UNIQUE INDEX "StorageDeletionReceipt_r2Key_eventNo_key" ON "StorageDeletionReceipt"("r2Key", "eventNo");
CREATE INDEX "StorageDeletionReceipt_completedAt_idx" ON "StorageDeletionReceipt"("completedAt");

-- CreateIndex (raw partial unique: at most ONE pending event per key at any
-- time, lease-independently — a second pending intent must ABORT)
CREATE UNIQUE INDEX "StorageDeletionReceipt_onePending"
    ON "StorageDeletionReceipt"("r2Key")
    WHERE "completedAt" IS NULL;

-- AddForeignKey (records vanish with their patient)
ALTER TABLE "DentalRecord" ADD CONSTRAINT "DentalRecord_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (author retained; SET NULL keeps records when staff leave)
ALTER TABLE "DentalRecord" ADD CONSTRAINT "DentalRecord_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey (files vanish with their record)
ALTER TABLE "DentalFile" ADD CONSTRAINT "DentalFile_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "DentalRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (uploader retained; SET NULL keeps files when staff leave)
ALTER TABLE "DentalFile" ADD CONSTRAINT "DentalFile_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
