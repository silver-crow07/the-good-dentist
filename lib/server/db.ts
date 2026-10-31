/**
 * Prisma client singleton.
 *
 * Prisma 7 uses a driver adapter (`@prisma/adapter-pg` → `pg`). The client is
 * created lazily and cached on `globalThis` so Next.js dev-mode hot reloads
 * do not open a new connection pool per reload.
 *
 * When `DATABASE_URL` is missing the app must NOT crash marketing pages —
 * `getPrisma()` returns `null` and booking endpoints answer 503 with a safe
 * message (see docs/BACKEND.md; the database is genuinely required for
 * bookings, and the UI says so rather than faking success).
 */

// Relative import (not `@/…`) so plain-Node scripts (prisma/seed.ts,
// scripts/*.ts via tsx) resolve the generated client without alias config.
import { PrismaClient } from "../../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { isDatabaseConfigured } from "./env";

// Cached across HMR in development.
const globalForPrisma = globalThis as unknown as {
  __prisma?: PrismaClient;
};

/**
 * Force `timezone=UTC` on every pooled connection.
 *
 * `@prisma/adapter-pg` serializes DateTime values as NAIVE strings built from
 * the UTC components ("2026-11-02 03:30:00", no offset — see its
 * `formatDateTime`). PostgreSQL interprets such literals in the SESSION time
 * zone, so if the server default is not UTC (our dev database initialises
 * with Asia/Calcutta) every timestamptz is silently stored shifted by the
 * zone offset — a data-integrity bug that round-trips through Prisma and is
 * invisible to app-level tests.
 *
 * The pg driver only forwards a whitelist of startup parameters (user,
 * database, application_name, options, …) — a `timezone=UTC` query param is
 * dropped, but `options=-c timezone=UTC` reaches the server and is applied
 * per session. Clinic-local (Asia/Kolkata) conversion stays exclusively in
 * `lib/server/schedule.ts`; the database only ever stores UTC instants.
 *
 * An `options` param already present in DATABASE_URL is respected as-is.
 */
export function withUtcSession(connectionString: string | undefined): string | undefined {
  if (!connectionString) return connectionString;
  if (/[?&]options=/.test(connectionString)) return connectionString;
  const sep = connectionString.includes("?") ? "&" : "?";
  return `${connectionString}${sep}options=-c%20timezone%3DUTC`;
}

/**
 * Transaction client type — Prisma 7 removed `Prisma.TransactionClient`;
 * derive it by omitting the client-level methods from `PrismaClient`.
 */
export type PrismaTx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;

export function getPrisma(): PrismaClient | null {
  if (!isDatabaseConfigured()) return null;

  if (!globalForPrisma.__prisma) {
    const adapter = new PrismaPg({
      connectionString: withUtcSession(process.env.DATABASE_URL),
    });
    globalForPrisma.__prisma = new PrismaClient({ adapter });
  }
  return globalForPrisma.__prisma;
}

/**
 * Verifies the database is reachable. Used by endpoint guards so a broken
 * connection surfaces as 503 (safe) instead of an unhandled 500.
 */
export async function pingDatabase(): Promise<boolean> {
  const prisma = getPrisma();
  if (!prisma) return false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
