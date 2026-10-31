/**
 * POST /api/auth/login — staff sign-in (no public registration exists).
 *
 * Body: { email, password }
 * Success: sets the HttpOnly session cookie and returns minimal staff info.
 * Failure: 401 with a constant message ("Invalid email or password.") — the
 * response never reveals whether the account exists. Verification runs scrypt
 * even for unknown emails to keep timing uniform.
 *
 * Abuse controls: per-IP (5/min) and per-account (15 per 15 min).
 */

import { NextResponse } from "next/server";

import {
  clientIp,
  handleRouteError,
  jsonError,
  jsonOk,
  jsonRateLimited,
} from "@/lib/server/api";
import {
  createSession,
  getSessionCookieName,
  isSameOrigin,
  sessionCookieOptions,
  SESSION_TTL_MS,
  verifyPassword,
} from "@/lib/server/auth";
import { getPrisma } from "@/lib/server/db";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { loginSchema, parseJsonBody, safeParseWith } from "@/lib/server/validation";

export const runtime = "nodejs";

const INVALID_MESSAGE = "Invalid email or password.";

/**
 * Dummy hash (of a random throwaway password) used to equalise response
 * timing when the account does not exist. Verified, never accepted: the
 * comparison target is not any real account's hash.
 */
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    // Imported lazily so this module stays light for cold starts.
    dummyHashPromise = import("@/lib/server/auth").then(({ hashPassword }) =>
      hashPassword(`dummy-${Math.random().toString(36)}`),
    );
  }
  return dummyHashPromise;
}

export async function POST(request: Request) {
  const ip = clientIp(request);

  const ipLimit = checkRateLimit(`login:${ip}`, 5, 60_000);
  if (!ipLimit.ok) return jsonRateLimited(ipLimit.retryAfterMs);

  if (!isSameOrigin(request)) {
    return jsonError("FORBIDDEN", "Invalid request origin.");
  }

  const body = parseJsonBody(await request.text());
  if (body === undefined || body === null || typeof body !== "object") {
    return jsonError("VALIDATION_ERROR", "Invalid request body.");
  }
  const parsed = safeParseWith(loginSchema, body);
  if (!parsed.ok) {
    return jsonError("VALIDATION_ERROR", "Enter your email and password.", parsed.fields);
  }

  const email = parsed.data.email.toLowerCase();

  const accountLimit = checkRateLimit(`login-email:${email}`, 15, 15 * 60_000);
  if (!accountLimit.ok) return jsonRateLimited(accountLimit.retryAfterMs);

  const prisma = getPrisma();
  if (!prisma) {
    return jsonError("SERVICE_UNAVAILABLE", "Staff sign-in is temporarily unavailable.");
  }

  try {
    const staff = await prisma.staff.findUnique({ where: { email } });
    const storedHash = staff?.active ? staff.passwordHash : await getDummyHash();
    const passwordOk = await verifyPassword(parsed.data.password, storedHash);

    if (!staff || !staff.active || !passwordOk) {
      return jsonError("UNAUTHORIZED", INVALID_MESSAGE);
    }

    const cookieValue = await createSession(staff.id);
    if (!cookieValue) {
      return jsonError("SERVICE_UNAVAILABLE", "Staff sign-in is temporarily unavailable.");
    }

    await prisma.auditLog
      .create({
        data: {
          staffId: staff.id,
          action: "staff.login",
          entityType: "staff",
          entityId: staff.id,
        },
      })
      .catch(() => undefined); // audit failure must not block sign-in

    const response = jsonOk({
      staff: { fullName: staff.fullName, role: staff.role },
    });
    response.cookies.set(getSessionCookieName(), cookieValue, {
      ...sessionCookieOptions(Math.floor(SESSION_TTL_MS / 1000)),
    });
    return response;
  } catch (error) {
    return handleRouteError(error, "auth/login");
  }
}

// Login is POST-only.
export async function GET() {
  return NextResponse.json(
    { error: { code: "NOT_FOUND", message: "Use POST to sign in." } },
    { status: 405, headers: { Allow: "POST" } },
  );
}
