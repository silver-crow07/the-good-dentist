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
  return NextResponse.json(
    { error: { code, message, ...(fields ? { fields } : {}) } },
    { status: STATUS_BY_CODE[code], ...init },
  );
}

export function jsonOk<T>(body: T, init?: ResponseInit): NextResponse<T> {
  return NextResponse.json(body, { status: 200, ...init });
}

export function jsonCreated<T>(body: T): NextResponse<T> {
  return NextResponse.json(body, { status: 201 });
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
  // Log the stack for operators; nothing here is returned to the client.
  console.error(`[api] ${context}:`, error instanceof Error ? error.message : error);
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
