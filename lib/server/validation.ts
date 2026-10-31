/**
 * Zod request schemas + helpers for the appointment API.
 *
 * Server-side validation is authoritative — the frontend validation is only
 * a courtesy. Every public field is bounded (length, pattern, enum) so the
 * database never sees unbounded or malformed input.
 */

import { z } from "zod";

import type { ApiFieldErrors } from "./api";

/* ------------------------------------------------------------------ *
 * Building blocks
 * ------------------------------------------------------------------ */

/** Digits only after normalisation; 7–15 digits (matches the frontend rule). */
export const phoneSchema = z
  .string()
  .max(30, "Phone number is too long.")
  .transform((value) => value.replace(/[^\d]/g, ""))
  .pipe(z.string().regex(/^\d{7,15}$/, "Please enter a valid phone number."));

export const emailSchema = z
  .string()
  .max(200, "Email address is too long.")
  .transform((value) => value.trim())
  .pipe(
    z
      .string()
      .regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, "Enter a valid email address.")
      .or(z.literal(""))
  )
  .transform((value) => (value === "" ? undefined : value))
  // Email is OPTIONAL: the browser client omits the key entirely when the
  // field is left blank (JSON.stringify drops undefined), so validation must
  // accept a missing value as well as an empty string.
  .optional();

export const nameSchema = z
  .string()
  .trim()
  .min(2, "Please enter the patient's full name.")
  .max(120, "Name is too long.");

/** kebab-case slug as used across the site (`root-canal-treatment`). */
export const slugSchema = z
  .string()
  .trim()
  .min(1, "This field is required.")
  .max(100, "Too long.")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Invalid value.");

export const dateKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be formatted YYYY-MM-DD.");

/** ISO instant with explicit timezone offset or Z (e.g. `…T09:00:00+05:30`). */
export const isoInstantSchema = z
  .string()
  .max(40, "Invalid timestamp.")
  .refine((value) => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})$/.test(value)) {
      return false;
    }
    return !Number.isNaN(Date.parse(value));
  }, "startsAt must be an ISO-8601 instant with timezone (e.g. 2026-11-02T09:00:00+05:30).");

/* ------------------------------------------------------------------ *
 * Public booking
 * ------------------------------------------------------------------ */

export const patientInputSchema = z.object({
  fullName: nameSchema,
  phone: phoneSchema,
  email: emailSchema,
});

export const createAppointmentSchema = z.object({
  patient: patientInputSchema,
  serviceSlug: slugSchema,
  /** Optional — defaults to the clinic's configured active dentist. */
  doctorSlug: slugSchema.optional(),
  startsAt: isoInstantSchema,
  /** Non-clinical scheduling note only (bounded). */
  patientNotes: z.string().trim().max(500, "Note is too long (500 characters max).").optional(),
});

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;

export const availabilityQuerySchema = z.object({
  date: dateKeySchema,
  serviceSlug: slugSchema,
});

/* ------------------------------------------------------------------ *
 * Staff-only
 * ------------------------------------------------------------------ */

export const APPOINTMENT_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "CANCELLED",
  "COMPLETED",
  "NO_SHOW",
] as const;

export const appointmentStatusSchema = z.enum(APPOINTMENT_STATUSES);

export const updateAppointmentSchema = z
  .object({
    status: appointmentStatusSchema.optional(),
    cancellationReason: z.string().trim().max(300, "Reason is too long.").optional(),
    /** Reschedule target — same duration, re-checked against availability. */
    startsAt: isoInstantSchema.optional(),
  })
  .refine(
    (value) => value.status !== undefined || value.startsAt !== undefined,
    "Provide at least one of: status, startsAt.",
  );

export const cancelAppointmentSchema = z.object({
  reason: z.string().trim().max(300, "Reason is too long.").optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().max(200).regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, "Invalid email."),
  password: z.string().min(1, "Password is required.").max(200, "Password is too long."),
});

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/** Zod issues → `{ "field.path": "message" }` for the API error envelope. */
export function zodFieldsFromError(error: z.ZodError): ApiFieldErrors {
  const fields: ApiFieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_";
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

/**
 * Runs `schema.safeParse` and returns either the typed data or the first
 * field-error map (never throws).
 */
export function safeParseWith<T>(
  schema: z.ZodType<T>,
  input: unknown,
): { ok: true; data: T } | { ok: false; fields: ApiFieldErrors } {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, fields: zodFieldsFromError(result.error) };
}

/** Guarded JSON body parse — invalid JSON becomes a validation error. */
export function parseJsonBody(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
