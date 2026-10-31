/**
 * Server-side staff authentication.
 *
 * Design:
 *  - Passwords are hashed with scrypt (node:crypto — memory-hard, no native
 *    build dependencies) using a per-user random salt. Stored as
 *    `scrypt$N,r,p$salt$hash` and verified with a timing-safe comparison.
 *  - Sessions are opaque random tokens. The cookie value is
 *    `<token>.<HMAC-SHA256(SESSION_SECRET, token)>`; the database stores only
 *    the SHA-256 of the full cookie value, so a database leak does not yield
 *    usable cookies and a secret leak does not yield database rows.
 *  - The cookie is HttpOnly, SameSite=Lax, Secure in production, Path=/.
 *  - There is no public registration endpoint — staff accounts are created
 *    offline via `scripts/create-staff.ts`.
 *  - CSRF: SameSite=Lax already blocks cross-site cookie sending on POST;
 *    `assertSameOrigin` additionally rejects state-changing requests whose
 *    Origin/Referer does not match the host.
 */

import {
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

import type { cookies } from "next/headers";

import { getSessionCookieName, getSessionSecret } from "./env";
import { getPrisma } from "./db";

// Re-exported so route handlers can import everything session-related from
// one module (also prevents Vite-SSR "not a function" link errors in tests).
export { getSessionCookieName };

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 64;
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type SessionStaff = {
  id: string;
  email: string;
  fullName: string;
  role: "ADMIN" | "STAFF";
};

/* ------------------------------------------------------------------ *
 * Passwords
 * ------------------------------------------------------------------ */

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH, SCRYPT_PARAMS);
  const { N, r, p } = SCRYPT_PARAMS;
  return `scrypt$${N},${r},${p}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return false;

  const [paramsPart, saltPart, hashPart] = parts.slice(1);
  const [n, r, p] = (paramsPart ?? "").split(",").map(Number);
  if (!n || !r || !p) return false;

  try {
    const salt = Buffer.from(saltPart ?? "", "base64");
    const expected = Buffer.from(hashPart ?? "", "base64");
    const derived = await scrypt(password, salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: SCRYPT_PARAMS.maxmem,
    });
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Session tokens
 * ------------------------------------------------------------------ */

function signToken(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token).digest("base64url");
}

function hashCookieValue(cookieValue: string): string {
  return createHash("sha256").update(cookieValue).digest("hex");
}

/** Builds a signed cookie value and its database row id. */
export function mintSessionValue(): { cookieValue: string; sessionId: string } | null {
  const secret = getSessionSecret();
  if (!secret) return null;
  const token = randomBytes(32).toString("base64url");
  const cookieValue = `${token}.${signToken(token, secret)}`;
  return { cookieValue, sessionId: hashCookieValue(cookieValue) };
}

/** Verifies the signature of a cookie value; returns its row id or null. */
export function verifySessionValue(cookieValue: string): string | null {
  const secret = getSessionSecret();
  if (!secret) return null;

  const separator = cookieValue.lastIndexOf(".");
  if (separator <= 0) return null;
  const token = cookieValue.slice(0, separator);
  const provided = cookieValue.slice(separator + 1);
  const expected = signToken(token, secret);

  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return null;
  }
  return hashCookieValue(cookieValue);
}

export async function createSession(staffId: string): Promise<string | null> {
  const minted = mintSessionValue();
  if (!minted) return null;

  const prisma = getPrisma();
  if (!prisma) return null;

  await prisma.staffSession.create({
    data: {
      id: minted.sessionId,
      staffId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  return minted.cookieValue;
}

/** Resolves a cookie value to an active staff member, or null. */
export async function getSessionStaff(cookieValue: string): Promise<SessionStaff | null> {
  const sessionId = verifySessionValue(cookieValue);
  if (!sessionId) return null;

  const prisma = getPrisma();
  if (!prisma) return null;

  const session = await prisma.staffSession.findUnique({
    where: { id: sessionId },
    include: { staff: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    // Expired — remove eagerly.
    await prisma.staffSession.delete({ where: { id: sessionId } }).catch(() => undefined);
    return null;
  }
  if (!session.staff.active) return null;

  return {
    id: session.staff.id,
    email: session.staff.email,
    fullName: session.staff.fullName,
    role: session.staff.role as SessionStaff["role"],
  };
}

export async function destroySession(cookieValue: string): Promise<void> {
  const sessionId = verifySessionValue(cookieValue);
  if (!sessionId) return;
  const prisma = getPrisma();
  if (!prisma) return;
  await prisma.staffSession.deleteMany({ where: { id: sessionId } });
}

/** Revokes every session of one staff member (password rotation, offboarding). */
export async function destroyAllSessionsForStaff(staffId: string): Promise<number> {
  const prisma = getPrisma();
  if (!prisma) return 0;
  const result = await prisma.staffSession.deleteMany({ where: { staffId } });
  return result.count;
}

/* ------------------------------------------------------------------ *
 * Request helpers for route handlers
 * ------------------------------------------------------------------ */

/** Reads the session cookie from an incoming request (route handlers). */
export function readSessionCookie(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  const name = `${getSessionCookieName()}=`;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(name)) {
      return decodeURIComponent(trimmed.slice(name.length));
    }
  }
  return null;
}

/** Resolves the signed-in staff member for a route-handler request. */
export async function getSessionFromRequest(
  request: Request,
): Promise<SessionStaff | null> {
  const cookieValue = readSessionCookie(request);
  if (!cookieValue) return null;
  return getSessionStaff(cookieValue);
}

/** Cookie options for setting/clearing the session cookie. */
export function sessionCookieOptions(maxAgeSeconds?: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(maxAgeSeconds !== undefined ? { maxAge: maxAgeSeconds } : {}),
  };
}

/**
 * CSRF defence-in-depth for state-changing requests. SameSite=Lax already
 * prevents cross-site cookie submission; this additionally rejects requests
 * whose Origin (or Referer) clearly points at a different host.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const host = request.headers.get("host");
  if (!host) return false;

  const source = origin ?? referer;
  if (!source) {
    // No Origin/Referer: not a browser-initiated cross-site form post we can
    // detect; the SameSite cookie still blocks cross-site credential use.
    return true;
  }
  try {
    return new URL(source).host === host;
  } catch {
    return false;
  }
}

/** Type-only helper so `cookies()` typing stays in one place if needed later. */
export type CookieStore = typeof cookies;
