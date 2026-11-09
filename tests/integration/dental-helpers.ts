/**
 * Shared helpers for the Phase D integration suites (NOT a test file —
 * vitest only collects test files under the tests directory).
 *
 * Every dental suite WIPES the booking + dental tables before and after it
 * runs (clinic config / doctors / services are NEVER touched), so the
 * disposable-database guard from db-guard.ts applies to all of them.
 */

import { expect } from "vitest";
import { NextRequest } from "next/server";

import { POST as loginPost } from "@/app/api/auth/login/route";

export const HOST = "localhost:3000";
export const ORIGIN = `http://${HOST}`;

/** Builds a same-origin NextRequest exactly like the existing suites. */
export function makeRequest(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string>; ip?: string } = {},
  ip: string,
): NextRequest {
  const headers = new Headers(init.headers);
  if (!headers.has("host")) headers.set("host", HOST);
  if (!headers.has("origin")) headers.set("origin", ORIGIN);
  headers.set("x-forwarded-for", ip);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(`${ORIGIN}${path}`, {
    method: init.method ?? "GET",
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

/** Signs in through the real login route and returns the session cookie. */
export async function login(email: string, password: string, ip: string): Promise<string> {
  const response = await loginPost(
    makeRequest(
      "/api/auth/login",
      { method: "POST", body: { email, password }, ip },
      ip,
    ),
  );
  expect(response.status).toBe(200);
  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = /tgd_session=([^;]+)/.exec(setCookie);
  expect(match).toBeTruthy();
  return `tgd_session=${match?.[1] ?? ""}`;
}

export function authed(cookie: string, extra: Record<string, string> = {}) {
  return { headers: { cookie, ...extra } };
}

/**
 * Route context for the Phase D `[id]` / `files/[fileId]` handlers, derived
 * from the request path (Next 16 params are promises). The returned object
 * carries BOTH keys so it satisfies either handler signature; the extra
 * property is harmless under structural typing.
 */
export function routeCtx(pathname: string): {
  params: Promise<{ id: string; fileId: string }>;
} {
  const parts = pathname.split("?")[0].split("/").filter(Boolean);
  // ["api", "admin", "dental-records", <id | "files">, …]
  const segment = parts[3] ?? "";
  const id = segment === "files" ? (parts[4] ?? "") : segment;
  return { params: Promise.resolve({ id, fileId: id }) };
}

/**
 * Wipes EVERY row the Phase D suites own, plus the booking/auth rows the
 * existing suites also wipe. Order respects foreign keys (children first);
 * R2KeyRegistry rows are permanent tombstones but still disposable on a
 * throwaway database. Clinic config / doctors / services are untouched.
 */
export async function wipeAllData(prisma: {
  storageDeletionReceipt: { deleteMany: (args: object) => Promise<unknown> };
  dentalFile: { deleteMany: (args: object) => Promise<unknown> };
  dentalRecord: { deleteMany: (args: object) => Promise<unknown> };
  r2KeyRegistry: { deleteMany: (args: object) => Promise<unknown> };
  storageScanState: { deleteMany: (args: object) => Promise<unknown> };
  clinicalNote: { deleteMany: (args: object) => Promise<unknown> };
  appointment: { deleteMany: (args: object) => Promise<unknown> };
  patient: { deleteMany: (args: object) => Promise<unknown> };
  auditLog: { deleteMany: (args: object) => Promise<unknown> };
  staffSession: { deleteMany: (args: object) => Promise<unknown> };
  staff: { deleteMany: (args: object) => Promise<unknown> };
}): Promise<void> {
  await prisma.storageDeletionReceipt.deleteMany({});
  await prisma.dentalFile.deleteMany({});
  await prisma.dentalRecord.deleteMany({});
  await prisma.r2KeyRegistry.deleteMany({});
  await prisma.storageScanState.deleteMany({});
  await prisma.clinicalNote.deleteMany({});
  await prisma.appointment.deleteMany({});
  await prisma.patient.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.staffSession.deleteMany({});
  await prisma.staff.deleteMany({});
}

/** Padded JPEG byte buffer starting with the real magic bytes. */
export function jpegBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(Math.max(size, 3));
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  for (let i = 3; i < bytes.length; i += 1) bytes[i] = i % 251;
  return bytes;
}

/** Padded PNG byte buffer starting with the real magic bytes. */
export function pngBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(Math.max(size, 8));
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  for (let i = 8; i < bytes.length; i += 1) bytes[i] = i % 251;
  return bytes;
}
