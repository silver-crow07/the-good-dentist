/**
 * Consistent JSON helpers for API route handlers.
 *
 * Every error response uses the same safe envelope:
 *   { error: { code, message, fields? } }
 *
 * Raw database / stack details never reach the client — unexpected errors are
 * logged server-side (without patient data) and replaced with a generic
 * message.
 */

import { NextResponse } from "next/server";

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL";

export type ApiFieldErrors = Record<string, string>;

export type ApiErrorBody = {
  error: {
    code: ApiErrorCode;
    message: string;
    fields?: ApiFieldErrors;
  };
};

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  RATE_LIMITED: 429,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL: 500,
};

export function jsonError(
  code: ApiErrorCode,
  message: string,
  fields?: ApiFieldErrors,
  init?: ResponseInit,
): NextResponse<ApiErrorBody> {
  // Errors are never cacheable: default every error response to
  // Cache-Control: no-store (callers may still pass their own headers —
  // e.g. Retry-After — which are preserved; an explicit Cache-Control from
  // the caller wins). This makes the documented "all responses are
  // no-store" claim true for 4xx/5xx paths too.
  const headers = new Headers(init?.headers);
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-store");
  return NextResponse.json(
    { error: { code, message, ...(fields ? { fields } : {}) } },
    { status: STATUS_BY_CODE[code], ...init, headers },
  );
}

export function jsonOk<T>(body: T, init?: ResponseInit): NextResponse<T> {
  return NextResponse.json(body, { status: 200, ...init });
}

export function jsonCreated<T>(body: T, init?: ResponseInit): NextResponse<T> {
  return NextResponse.json(body, { status: 201, ...init });
}

/** 429 with a Retry-After header and a safe message. */
export function jsonRateLimited(retryAfterMs: number): NextResponse<ApiErrorBody> {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return jsonError(
    "RATE_LIMITED",
    "Too many requests — please wait a moment and try again.",
    undefined,
    { headers: { "Retry-After": String(seconds) } },
  );
}

/**
 * Last-resort handler for unexpected route errors: log server-side, return a
 * generic 500 with no internals. `context` is a short label for the log line
 * (never patient data).
 */
export function handleRouteError(error: unknown, context: string): NextResponse<ApiErrorBody> {
  // Diagnostic logging (server-side ONLY — nothing here reaches the client).
  // Error instances log message + STACK, as this function documents. We log
  // `error.stack` deliberately and never the whole error object, so attached
  // driver/driver-adapter extras (Prisma `meta`, request configs, headers)
  // can never leak credentials, cookies, PHI or signed URLs into logs.
  // Non-Error values are coerced to a string for the same reason.
  if (error instanceof Error) {
    console.error(`[api] ${context}: ${error.stack ?? error.message}`);
  } else {
    console.error(`[api] ${context}: ${String(error)}`);
  }
  return jsonError(
    "INTERNAL",
    "Something went wrong on our side. Please try again, or book via WhatsApp.",
  );
}

/** Client IP for rate limiting; falls back to a shared bucket when absent. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}
