/**
 * Server-side environment access with safe, explicit failure modes.
 *
 * Rules:
 *  - Secrets are read here only and never exposed to client bundles
 *    (no `NEXT_PUBLIC_` prefix on any of them).
 *  - Nothing is hardcoded as a fallback — a missing variable degrades the
 *    related feature with a clear log line instead of inventing a value.
 *  - `.env` files are git-ignored; `.env.example` documents placeholders.
 */

/** True when a PostgreSQL connection string has been provided. */
export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

/**
 * The session-signing secret. Required for staff authentication; when absent,
 * auth endpoints return 503 instead of falling back to an insecure default.
 */
export function getSessionSecret(): string | null {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret) return null;
  // Refuse trivially short secrets in production.
  if (process.env.NODE_ENV === "production" && secret.length < 32) {
    console.error(
      "[env] SESSION_SECRET is too short for production (minimum 32 characters).",
    );
    return null;
  }
  return secret;
}

export function getSessionCookieName(): string {
  return process.env.SESSION_COOKIE_NAME?.trim() || "tgd_session";
}

/* ------------------------------------------------------------------ *
 * Private object storage (Phase D — Cloudflare R2)
 * ------------------------------------------------------------------ */

export type R2Config = {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

let warnedMissingR2 = false;

/**
 * R2 credentials — server-side ONLY (never `NEXT_PUBLIC_`, never returned
 * from any endpoint). Missing variables degrade to `null`: file endpoints
 * answer 503 and the UI says storage is not configured instead of faking a
 * successful upload. No value is ever invented as a fallback.
 *
 * Local automated tests never read this — they inject an in-memory adapter
 * (see lib/server/storage/index.ts).
 */
export function getR2Config(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const bucket = process.env.R2_BUCKET?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();

  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) {
    if (!warnedMissingR2) {
      warnedMissingR2 = true;
      console.warn(
        "[env] R2 storage is not configured (R2_ACCOUNT_ID / R2_BUCKET / " +
          "R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY) — dental file endpoints " +
          "will return 503 until it is set up.",
      );
    }
    return null;
  }
  return { accountId, bucket, accessKeyId, secretAccessKey };
}

/** Test helper — lets suites assert the warning fires only once. */
export function resetR2ConfigWarningForTests(): void {
  warnedMissingR2 = false;
}

/**
 * Shared secret for the Vercel Cron route (`Authorization: Bearer …`).
 * Required in production: when missing (or < 32 chars) the cron route
 * fails CLOSED with 503 rather than running unauthenticated.
 */
export function getCronSecret(): string | null {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return null;
  if (process.env.NODE_ENV === "production" && secret.length < 32) {
    console.error("[env] CRON_SECRET is too short for production (minimum 32 characters).");
    return null;
  }
  return secret;
}

/** Default/max per-record file cap when DENTAL_MAX_FILES_PER_RECORD is unset/invalid. */
export const DEFAULT_DENTAL_MAX_FILES_PER_RECORD = 50;
export const DENTAL_MAX_FILES_PER_RECORD_HARD_CAP = 500;

/**
 * Maximum number of files ONE dental record may hold (F-5).
 *
 * Configured via `DENTAL_MAX_FILES_PER_RECORD` (optional — no entry in
 * `.env` is required; the default applies). Values that are not plain
 * integers fall back to the default (50); integers outside 1..500 are
 * clamped into that range rather than failing open to "unlimited". Read
 * on every call so tests and deploys can vary it without a restart.
 */
export function getDentalMaxFilesPerRecord(): number {
  const raw = process.env.DENTAL_MAX_FILES_PER_RECORD?.trim();
  if (!raw) return DEFAULT_DENTAL_MAX_FILES_PER_RECORD;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || `${parsed}` !== raw) {
    console.warn(
      `[env] DENTAL_MAX_FILES_PER_RECORD="${raw}" is not an integer — using the default of ${DEFAULT_DENTAL_MAX_FILES_PER_RECORD}.`,
    );
    return DEFAULT_DENTAL_MAX_FILES_PER_RECORD;
  }
  if (parsed < 1 || parsed > DENTAL_MAX_FILES_PER_RECORD_HARD_CAP) {
    console.warn(
      `[env] DENTAL_MAX_FILES_PER_RECORD=${parsed} is outside 1..${DENTAL_MAX_FILES_PER_RECORD_HARD_CAP} — using ${Math.min(Math.max(parsed, 1), DENTAL_MAX_FILES_PER_RECORD_HARD_CAP)} instead.`,
    );
    return Math.min(Math.max(parsed, 1), DENTAL_MAX_FILES_PER_RECORD_HARD_CAP);
  }
  return parsed;
}
