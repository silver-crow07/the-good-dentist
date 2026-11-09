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
  /** Optional — staff reschedule: compute slots for a specific clinician. */
  doctorSlug: slugSchema.optional(),
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

/* ------------------------------------------------------------------ *
 * Admin panel (Phase C) — patients + clinical notes
 * ------------------------------------------------------------------ */

/** Query for GET /api/admin/patients — paginated directory + search. */
export const adminPatientsQuerySchema = z.object({
  page: z.coerce.number().int().min(1, "Page must be 1 or more.").max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1, "Page size must be 1–100.").max(100).optional(),
  /** Matches patient name (insensitive), phone digits (≥3) or email. */
  q: z.string().trim().max(100, "Search is too long.").optional(),
});

export type AdminPatientsQuery = z.infer<typeof adminPatientsQuerySchema>;

/** POST /api/admin/patients — same shape the booking flow already validates. */
export const createPatientSchema = patientInputSchema;

/**
 * PATCH /api/admin/patients/[id] — partial update; at least one field must
 * be present. `email: ""` or `email: null` CLEARS the address; omitting the
 * key leaves it unchanged.
 */
export const updatePatientSchema = z
  .object({
    fullName: nameSchema.optional(),
    phone: phoneSchema.optional(),
    email: z
      .string()
      .max(200, "Email address is too long.")
      .transform((value) => value.trim())
      .pipe(z.string().regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, "Enter a valid email address.").or(z.literal("")))
      .transform((value) => (value === "" ? null : value))
      .nullable()
      .optional(),
  })
  .refine(
    (value) =>
      value.fullName !== undefined || value.phone !== undefined || value.email !== undefined,
    "Provide at least one field to update.",
  );

export type UpdatePatientInput = z.infer<typeof updatePatientSchema>;

/** POST /api/admin/patients/[id]/notes — internal clinical note body. */
export const clinicalNoteSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Write the note before saving.")
    .max(2000, "Note is too long (2000 characters max)."),
});

export type ClinicalNoteInput = z.infer<typeof clinicalNoteSchema>;

/* ------------------------------------------------------------------ *
 * Admin panel (Phase D) — dental records + private file storage
 * ------------------------------------------------------------------ */

/**
 * Query for GET /api/admin/dental-records — chronological treatment
 * history. `patientId` narrows to one patient's own history; `from`/`to`
 * filter on the clinic-local treatment DATE (inclusive); `q` searches the
 * diagnosis or the patient's name.
 */
export const adminDentalRecordsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1, "Page must be 1 or more.").max(10_000).optional(),
    pageSize: z.coerce.number().int().min(1, "Page size must be 1–100.").max(100).optional(),
    patientId: z.string().trim().min(1).max(100).optional(),
    from: dateKeySchema.optional(),
    to: dateKeySchema.optional(),
    q: z.string().trim().max(100, "Search is too long.").optional(),
  })
  .refine((value) => !(value.from && value.to) || value.from <= value.to, {
    message: "The range start must be on or before the range end.",
    path: ["from"],
  });

export type AdminDentalRecordQuery = z.infer<typeof adminDentalRecordsQuerySchema>;

/** POST /api/admin/dental-records — create one record (ADMIN only). */
export const createDentalRecordSchema = z
  .object({
    patientId: z.string().trim().min(1, "Choose a patient.").max(100),
    treatmentDate: dateKeySchema,
    diagnosis: z
      .string()
      .trim()
      .min(1, "Enter the diagnosis.")
      .max(500, "Diagnosis is too long (500 characters max)."),
    treatmentDetails: z
      .string()
      .trim()
      .min(1, "Enter the treatment details.")
      .max(5000, "Treatment details are too long (5000 characters max)."),
    clinicalNotes: z
      .string()
      .trim()
      .max(5000, "Notes are too long (5000 characters max).")
      .optional(),
  })
  .strict();

export type CreateDentalRecordInput = z.infer<typeof createDentalRecordSchema>;

/** PATCH /api/admin/dental-records/[id] — at least one field required. */
export const updateDentalRecordSchema = z
  .object({
    treatmentDate: dateKeySchema.optional(),
    diagnosis: z
      .string()
      .trim()
      .min(1, "Enter the diagnosis.")
      .max(500, "Diagnosis is too long (500 characters max).")
      .optional(),
    treatmentDetails: z
      .string()
      .trim()
      .min(1, "Enter the treatment details.")
      .max(5000, "Treatment details are too long (5000 characters max).")
      .optional(),
    clinicalNotes: z
      .string()
      .trim()
      .max(5000, "Notes are too long (5000 characters max).")
      .optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.treatmentDate !== undefined ||
      value.diagnosis !== undefined ||
      value.treatmentDetails !== undefined ||
      value.clinicalNotes !== undefined,
    "Provide at least one field to update.",
  );

export type UpdateDentalRecordInput = z.infer<typeof updateDentalRecordSchema>;

/**
 * POST /api/admin/dental-records/[id]/files — upload-init. The client
 * declares the file it is ABOUT to PUT to R2; the server re-validates
 * type/size here AND again at upload-complete (magic bytes + HEAD size),
 * so a lying client can never make a bad object AVAILABLE.
 */
export const initDentalFileSchema = z
  .object({
    originalName: z
      .string()
      .trim()
      .min(1, "File name is required.")
      .max(255, "File name is too long."),
    contentType: z
      .string()
      .trim()
      .min(1, "Content type is required.")
      .max(100, "Content type is too long."),
    byteSize: z
      .number()
      .int("Size must be a whole number of bytes.")
      .min(1, "File is empty.")
      .max(10 * 1024 * 1024, "Files must be 10 MB or smaller."),
  })
  .strict();

export type InitDentalFileInput = z.infer<typeof initDentalFileSchema>;

/**
 * POST /api/admin/dental-records/files/[fileId]/complete — no body: the
 * server re-reads the object from storage (HEAD size + magic bytes) and
 * decides AVAILABLE vs REJECTED itself.
 */
export const completeDentalFileSchema = z.object({}).strict();

export type CompleteDentalFileInput = z.infer<typeof completeDentalFileSchema>;

/**
 * POST /api/admin/dental-records/cleanup — a manual FULL run (Jobs A–D).
 * Body is optional and strict (no parameters in V1; the throttle and the
 * soft time budget are enforced server-side).
 */
export const manualCleanupSchema = z
  .object({
    /** Present ⇒ the caller explicitly accepts a full orphan sweep (Job D). */
    confirm: z.literal(true).optional(),
  })
  .strict()
  .optional();

export type ManualCleanupInput = z.infer<typeof manualCleanupSchema>;

/* ------------------------------------------------------------------ *
 * Admin panel (Phase B) — appointment list query
 * ------------------------------------------------------------------ */

/**
 * Query for GET /api/admin/appointments.
 *
 *  - List mode (default): paginated, sorted by start time ascending.
 *    `date` filters to one clinic-local day inside the pagination.
 *  - Range mode: `from`/`to` fetch every appointment in the clinic-local
 *    window for the calendar views — no pagination (a lone bound is a
 *    single-day range).
 *  - `q` searches patient name (case-insensitive), phone (digits) and the
 *    public appointment id.
 */
export const adminAppointmentsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1, "Page must be 1 or more.").max(10_000).optional(),
    pageSize: z.coerce.number().int().min(1, "Page size must be 1–100.").max(100).optional(),
    q: z.string().trim().max(100, "Search is too long.").optional(),
    status: appointmentStatusSchema.optional(),
    date: dateKeySchema.optional(),
    from: dateKeySchema.optional(),
    to: dateKeySchema.optional(),
    doctorSlug: slugSchema.optional(),
    serviceSlug: slugSchema.optional(),
  })
  .refine((value) => !(value.date && (value.from || value.to)), {
    message: "Provide either a single date or a date range — not both.",
    path: ["date"],
  })
  .refine((value) => !(value.from && value.to) || value.from <= value.to, {
    message: "The range start must be on or before the range end.",
    path: ["from"],
  });

export type AdminAppointmentsQuery = z.infer<typeof adminAppointmentsQuerySchema>;

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
