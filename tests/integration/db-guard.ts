/**
 * Safety guard for integration tests that WIPE rows.
 *
 * The integration suites deliberately delete all Appointment / Patient /
 * AuditLog / Staff / StaffSession rows before and after they run (clinic
 * config, doctors and services are NEVER touched). That is only acceptable
 * against a disposable database — pointing them at a shared or production
 * database by accident would destroy real bookings and staff accounts.
 *
 * Policy (fail closed):
 *   - `NODE_ENV === "production"` → always refuse.
 *   - Unparseable / relative URL → always refuse.
 *   - Loopback host (localhost / 127.0.0.1 / ::1) → allow: this project's
 *     local dev database IS the documented test bed, and its data is the
 *     disposable booking rows only.
 *   - Any other (remote) host → allow ONLY when the database name ends in
 *     `_test` (e.g. `the_good_dentist_test` on a managed server).
 *
 * The error message never echoes credentials — only host + database name.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Pure predicate — unit-tested in tests/unit/db-guard.test.ts. */
export function isDisposableDatabaseUrl(
  url: string,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): boolean {
  if (nodeEnv === "production") return false;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false; // fail closed on anything we cannot positively identify
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") return false;

  const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, "") || "");
  if (!dbName) return false;

  if (LOOPBACK_HOSTS.has(parsed.hostname)) return true;
  return dbName.endsWith("_test");
}

/** Host + database name only — never the password or full connection string. */
function describeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, "") || "?");
    return `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}/${dbName}`;
  } catch {
    return "(unparseable connection string)";
  }
}

/**
 * Throws (loudly, before any query runs) when `url` does not look like a
 * disposable database. No-op when no URL is configured — the suites then
 * skip themselves and cannot wipe anything.
 */
export function assertDisposableDatabase(url: string | undefined): void {
  if (!url) return;
  if (isDisposableDatabaseUrl(url)) return;
  throw new Error(
    `Refusing to run integration tests against ${describeUrl(url)} — ` +
      `these suites WIPE appointment/patient/staff rows. Use your local dev ` +
      `database, or a remote database whose name ends in "_test" via ` +
      `TEST_DATABASE_URL. (Set nothing to production-test: NODE_ENV=production always refuses.)`,
  );
}
