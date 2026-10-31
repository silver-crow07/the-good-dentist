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
