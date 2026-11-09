/**
 * Pure helpers for Phase D file storage — no I/O, no Prisma, no network.
 *
 * Everything here is deterministic and unit-tested directly (test ids in
 * brackets): key building [K*], content/type validation [U*], the 48 h grace
 * predicate [G*], cleanup timing, cursor shape, and evidence capture [FM*].
 *
 * Two invariants live in this module on purpose, so no route can drift:
 *  1. Storage keys are ALWAYS server-generated (`dental/{patientId}/
 *     {recordId}/{fileId}.{ext}`) — a user-supplied path never reaches R2.
 *  2. The grace predicate FAILS CLOSED: a missing/unparsable timestamp is
 *     never "old enough". Age only ever defers or blocks a deletion.
 */

import { randomBytes } from "node:crypto";

import type { HeadResult } from "./types";

/** Object namespace the reconciler is allowed to touch (never anything else). */
export const DENTAL_PREFIX = "dental/";

/** JPEG/JPG/PNG only, ≤ 10 MB (plan requirement — enforced server-side). */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Presigned PUT/GET lifetime (seconds). */
export const URL_TTL_SECONDS = 300;

/** Buffer on top of the URL TTL before an abandoned object may be removed. */
export const CLEANUP_BUFFER_SECONDS = 300;

/** `cleanupAfter = createdAt + URL TTL + buffer` (600 s total). */
export const CLEANUP_DELAY_MS = (URL_TTL_SECONDS + CLEANUP_BUFFER_SECONDS) * 1000;

/** 48 h orphan grace — INCLUSIVE at equality (LR6). */
export const GRACE_MS = 48 * 60 * 60 * 1000;

export const ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/png"] as const;
export const ALLOWED_EXTENSIONS = ["jpg", "jpeg", "png"] as const;

export type ImageFamily = "jpeg" | "png";

/* ------------------------------------------------------------------ *
 * Content type / extension validation
 * ------------------------------------------------------------------ */

/** Lower-cased extension without the dot; `null` when there is none. */
export function extensionOf(originalName: string): string | null {
  const base = originalName.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return null;
  return base.slice(dot + 1).toLowerCase();
}

export function familyOfContentType(contentType: string): ImageFamily | null {
  const normalized = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (normalized === "image/jpeg" || normalized === "image/jpg") return "jpeg";
  if (normalized === "image/png") return "png";
  return null;
}

export function familyOfExtension(ext: string): ImageFamily | null {
  const normalized = ext.toLowerCase();
  if (normalized === "jpg" || normalized === "jpeg") return "jpeg";
  if (normalized === "png") return "png";
  return null;
}

export function isSupportedContentType(contentType: string): boolean {
  return familyOfContentType(contentType) !== null;
}

/** The declared type and the file extension must agree (family level). */
export function matchesFamily(originalName: string, contentType: string): boolean {
  const ext = extensionOf(originalName);
  if (!ext) return false;
  const extFamily = familyOfExtension(ext);
  const typeFamily = familyOfContentType(contentType);
  return extFamily !== null && typeFamily !== null && extFamily === typeFamily;
}

/**
 * Magic-byte check on the first bytes read from storage:
 *   JPEG/JPG → `FF D8 FF`, PNG → `89 50 4E 47`.
 * Returns false for anything else (including short reads).
 */
export function matchesMagicBytes(originalName: string, bytes: Uint8Array): boolean {
  const ext = extensionOf(originalName);
  const family = ext ? familyOfExtension(ext) : null;
  if (family === "jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (family === "png") {
    return (
      bytes.length >= 4 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    );
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * Key generation (server-side only — never user-supplied)
 * ------------------------------------------------------------------ */

/**
 * File id used INSIDE the key and as the `DentalFile` primary key.
 * cuid-style (`c` + base36 time + random hex); uniqueness comes from the
 * timestamp + 64 bits of randomness, and any collision is caught by the
 * registry PK inside the init transaction (retry with a fresh id).
 */
export function defaultFileId(): string {
  const time = Date.now().toString(36);
  const random = randomBytes(8).toString("hex");
  return `c${time}${random}`;
}

let fileIdFactory: () => string = defaultFileId;

/** Test-only: force id collisions to exercise the reservation retry loop. */
export function setFileIdFactoryForTests(factory: (() => string) | null): void {
  fileIdFactory = factory ?? defaultFileId;
}

export function newFileId(): string {
  return fileIdFactory();
}

/**
 * Builds the immutable storage key for one file.
 * The extension is the NORMALIZED extension of the original name (lower
 * case, no path components) — the client can never influence the directory.
 */
export function buildDentalKey(params: {
  patientId: string;
  recordId: string;
  fileId: string;
  originalName: string;
}): { key: string; ext: string } {
  const ext = extensionOf(params.originalName);
  if (!ext || !familyOfExtension(ext)) {
    throw new Error("buildDentalKey: unsupported or missing extension");
  }
  const key = `${DENTAL_PREFIX}${params.patientId}/${params.recordId}/${params.fileId}.${ext}`;
  return { key, ext };
}

/* ------------------------------------------------------------------ *
 * Timing
 * ------------------------------------------------------------------ */

/** `cleanupAfter = createdAt + 600 s` (URL TTL 300 s + 300 s buffer). */
export function cleanupAfterFor(createdAt: Date): Date {
  return new Date(createdAt.getTime() + CLEANUP_DELAY_MS);
}

/**
 * 48 h grace, INCLUSIVE at equality, FAILS CLOSED:
 *   - missing/unparsable timestamp → false (never delete),
 *   - future-dated timestamp → false (LR7: negative age is not "old").
 */
export function isGraceElapsed(lastModified: Date | null, t0: Date): boolean {
  if (!lastModified) return false;
  const age = t0.getTime() - lastModified.getTime();
  if (Number.isNaN(age)) return false;
  return age >= GRACE_MS;
}

/** Cursor written by the scanner must always be a key it actually listed. */
export function isShapeValidCursor(key: string | null | undefined): boolean {
  if (key === null || key === undefined) return true;
  return key.startsWith(DENTAL_PREFIX);
}

/* ------------------------------------------------------------------ *
 * Evidence capture (diagnostic only — never authorization)
 * ------------------------------------------------------------------ */

export type ObjectEvidence = {
  size: number;
  /** ISO string, or null when R2 omitted/unparsed the timestamp. */
  lastModified: string | null;
  etag: string | null;
};

/**
 * Snapshot stored on the deletion receipt for the runbook. Deliberately a
 * plain JSON blob with no "identity" semantics: V1 never compares it to
 * decide anything (Round 10/11 — no REPLACED classification exists).
 */
export function captureEvidence(head: HeadResult): ObjectEvidence | null {
  if (!head.found) return null;
  return {
    size: head.size,
    lastModified: head.lastModified ? head.lastModified.toISOString() : null,
    etag: head.etag,
  };
}
