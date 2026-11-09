/**
 * Browser-side helpers for the admin API.
 *
 * Same conventions as lib/client/appointments.ts: failures surface as
 * `ApiClientError` with the server's safe error code and optional field
 * messages, so components never parse response bodies themselves. Nothing is
 * persisted outside React state — no localStorage, no client-side secrets.
 */

import { ApiClientError, type ApiErrorBody } from "./appointments";

// Re-exported so admin consumers can import everything from this module.
export { ApiClientError };

export type AppointmentStatusKey =
  | "PENDING"
  | "CONFIRMED"
  | "CANCELLED"
  | "COMPLETED"
  | "NO_SHOW";

export type AdminStats = {
  timezone: string;
  generatedAt: string;
  totals: { appointments: number; patients: number };
  today: { date: string; total: number } & Record<AppointmentStatusKey, number>;
  byStatus: Record<AppointmentStatusKey, number>;
  week: Array<{ date: string; count: number }>;
  upcoming: Array<{
    publicId: string;
    startsAt: string;
    status: AppointmentStatusKey;
    service: string;
    doctor: string;
    patient: { fullName: string; phone: string };
  }>;
  recentActivity: Array<{
    id: string;
    action: string;
    entityType: string;
    entityId: string | null;
    staffName: string | null;
    createdAt: string;
  }>;
};

export type AdminStaff = { fullName: string; role: "ADMIN" | "STAFF" };

async function readError(response: Response): Promise<ApiClientError> {
  let body: ApiErrorBody = {};
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    // Non-JSON error body — fall back to a generic message below.
  }
  return new ApiClientError(
    response.status,
    body.error?.code ?? "INTERNAL",
    body.error?.message ?? "Something went wrong. Please try again.",
    body.error?.fields,
  );
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new ApiClientError(
      0,
      "NETWORK",
      "We could not reach the server. Check your connection and try again.",
    );
  }
  if (!response.ok) throw await readError(response);
  return (await response.json()) as T;
}

/** Signs in and returns the minimal staff identity (cookie set server-side). */
export function loginStaff(
  email: string,
  password: string,
): Promise<{ staff: AdminStaff }> {
  return requestJson<{ staff: AdminStaff }>("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

/** Ends the session (idempotent). */
export function logoutStaff(): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>("/api/auth/logout", {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
}

/** Dashboard aggregates for the signed-in staff member. */
export function fetchAdminStats(signal?: AbortSignal): Promise<AdminStats> {
  return requestJson<{ stats: AdminStats }>("/api/admin/stats", {
    headers: { accept: "application/json" },
    cache: "no-store",
    ...(signal ? { signal } : {}),
  }).then((body) => body.stats);
}

/* ------------------------------------------------------------------ *
 * Appointments (Phase B)
 * ------------------------------------------------------------------ */

export type AdminAppointment = {
  publicId: string;
  status: AppointmentStatusKey;
  startsAt: string;
  endsAt: string;
  source: "WEBSITE" | "WHATSAPP" | "STAFF";
  patientNotes: string | null;
  cancellationReason: string | null;
  createdAt: string;
  service: { slug: string; name: string };
  doctor: { slug: string; name: string };
  /** Staff view — includes contact details; never cached outside state. */
  patient: { fullName: string; phone: string; email: string | null };
};

export type AdminAppointmentsParams = {
  page?: number;
  pageSize?: number;
  q?: string;
  status?: AppointmentStatusKey;
  date?: string;
  from?: string;
  to?: string;
  doctorSlug?: string;
  serviceSlug?: string;
};

export type AdminAppointmentsResult = {
  appointments: AdminAppointment[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number } | null;
  range: { from: string; to: string; truncated: boolean } | null;
};

export type AdminAppointmentOptions = {
  doctors: Array<{ slug: string; name: string }>;
  services: Array<{ slug: string; name: string; durationMinutes: number }>;
  timezone: string;
  today: string;
};

export type AdminSettings = {
  staff: { fullName: string; email: string; role: "ADMIN" | "STAFF"; joinedAt: string };
  clinic: { name: string; timezone: string };
  slotIntervalMinutes: number;
  bookingPolicy: "MANUAL_APPROVAL" | "AUTO_CONFIRM";
  hours: Array<{
    weekday: number;
    closed: boolean;
    opensAtMinutes: number;
    closesAtMinutes: number;
    breakStartMinutes: number | null;
    breakEndMinutes: number | null;
  }>;
};

function toQueryString(params: Record<string, string | number | undefined>): URLSearchParams {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  return search;
}

/** Paginated list or bounded range of appointments (staff view, PII). */
export function fetchAdminAppointments(
  params: AdminAppointmentsParams = {},
  signal?: AbortSignal,
): Promise<AdminAppointmentsResult> {
  const search = toQueryString(params);
  return requestJson<AdminAppointmentsResult>(`/api/admin/appointments?${search.toString()}`, {
    headers: { accept: "application/json" },
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
}

/** Filter options + clinic timezone/today key. */
export function fetchAdminAppointmentOptions(signal?: AbortSignal): Promise<AdminAppointmentOptions> {
  return requestJson<AdminAppointmentOptions>("/api/admin/appointments/options", {
    headers: { accept: "application/json" },
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
}

/** One appointment incl. patient contact (existing staff detail endpoint). */
export function fetchAdminAppointment(
  publicId: string,
  signal?: AbortSignal,
): Promise<AdminAppointment> {
  return requestJson<{ appointment: AdminAppointment }>(
    `/api/appointments/${encodeURIComponent(publicId)}`,
    {
      headers: { accept: "application/json" },
      cache: "no-store",
      ...(signal ? { signal } : {}),
    },
  ).then((body) => body.appointment);
}

export type AppointmentUpdate = {
  status?: AppointmentStatusKey;
  cancellationReason?: string;
  startsAt?: string;
};

/** Status transitions + reschedule (existing conflict-safe, audited endpoint). */
export function updateAdminAppointment(
  publicId: string,
  update: AppointmentUpdate,
): Promise<AdminAppointment> {
  return requestJson<{ appointment: AdminAppointment }>(
    `/api/appointments/${encodeURIComponent(publicId)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(update),
    },
  ).then((body) => body.appointment);
}

/** Cancel with an optional reason (existing dedicated cancel endpoint). */
export function cancelAdminAppointment(
  publicId: string,
  reason?: string,
): Promise<AdminAppointment> {
  return requestJson<{ appointment: AdminAppointment }>(
    `/api/appointments/${encodeURIComponent(publicId)}/cancel`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(reason ? { reason } : {}),
    },
  ).then((body) => body.appointment);
}

/** Read-only clinic configuration + own staff profile. */
export function fetchAdminSettings(signal?: AbortSignal): Promise<AdminSettings> {
  return requestJson<{ settings: AdminSettings }>("/api/admin/settings", {
    headers: { accept: "application/json" },
    cache: "no-store",
    ...(signal ? { signal } : {}),
  }).then((body) => body.settings);
}

/* ------------------------------------------------------------------ *
 * Patients (Phase C)
 * ------------------------------------------------------------------ */

export type AdminPatientListItem = {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  createdAt: string;
  appointmentCount: number;
};

export type AdminPatientsParams = {
  page?: number;
  pageSize?: number;
  /** Patient name / phone digits / email. */
  q?: string;
};

export type AdminPatientsResult = {
  /** IANA clinic timezone for date rendering. */
  timezone: string;
  patients: AdminPatientListItem[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

export type AdminPatientAppointment = {
  publicId: string;
  status: AppointmentStatusKey;
  startsAt: string;
  endsAt: string;
  source: "WEBSITE" | "WHATSAPP" | "STAFF";
  service: { slug: string; name: string };
  doctor: { slug: string; name: string };
};

export type AdminTreatmentHistoryItem = {
  service: { slug: string; name: string };
  sessions: number;
  lastAt: string;
};

export type AdminClinicalNote = {
  id: string;
  body: string;
  createdAt: string;
  author: string | null;
};

export type AdminPatientProfile = {
  timezone: string;
  patient: {
    id: string;
    fullName: string;
    phone: string;
    email: string | null;
    createdAt: string;
    updatedAt: string;
    appointmentCount: number;
  };
  appointments: AdminPatientAppointment[];
  treatments: AdminTreatmentHistoryItem[];
  /** ADMIN only — `null` (never note content) for limited STAFF views. */
  clinicalNotes: AdminClinicalNote[] | null;
  clinicalNotesTotal: number | null;
  permissions: { canEdit: boolean; canAddNotes: boolean };
};

export type PatientCreateInput = {
  fullName: string;
  phone: string;
  email?: string;
};

export type PatientUpdateInput = {
  fullName?: string;
  phone?: string;
  /** `""` or `null` clears the address; omit to leave it unchanged. */
  email?: string | null;
};

/** Paginated patient directory (name / phone / email search). */
export function fetchAdminPatients(
  params: AdminPatientsParams = {},
  signal?: AbortSignal,
): Promise<AdminPatientsResult> {
  const search = toQueryString(params);
  return requestJson<AdminPatientsResult>(`/api/admin/patients?${search.toString()}`, {
    headers: { accept: "application/json" },
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
}

/** Complete patient profile (clinical notes only for ADMIN sessions). */
export function fetchAdminPatient(id: string, signal?: AbortSignal): Promise<AdminPatientProfile> {
  return requestJson<AdminPatientProfile>(`/api/admin/patients/${encodeURIComponent(id)}`, {
    headers: { accept: "application/json" },
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
}

/** Register a new patient (ADMIN). */
export function createAdminPatient(input: PatientCreateInput): Promise<AdminPatientListItem> {
  return requestJson<{ patient: AdminPatientListItem }>("/api/admin/patients", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }).then((body) => body.patient);
}

/** Edit patient information (ADMIN). */
export function updateAdminPatient(
  id: string,
  patch: PatientUpdateInput,
): Promise<AdminPatientListItem> {
  return requestJson<{ patient: AdminPatientListItem }>(
    `/api/admin/patients/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    },
  ).then((body) => body.patient);
}

/** Add an internal clinical note (ADMIN). */
export function addClinicalNote(id: string, body: string): Promise<AdminClinicalNote> {
  return requestJson<{ note: AdminClinicalNote }>(
    `/api/admin/patients/${encodeURIComponent(id)}/notes`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body }),
    },
  ).then((result) => result.note);
}

/* ------------------------------------------------------------------ *
 * Dental records + private file storage (Phase D)
 * ------------------------------------------------------------------ */

export type DentalFileStatusKey = "PENDING" | "AVAILABLE" | "REJECTED" | "DELETING";

export type AdminDentalRecordListItem = {
  id: string;
  patientId: string;
  patientName: string;
  /** Clinic-local treatment date (`YYYY-MM-DD`). */
  treatmentDate: string;
  diagnosis: string;
  fileCount: number;
  availableFileCount: number;
  createdAt: string;
  updatedAt: string;
};

export type AdminDentalRecordsParams = {
  page?: number;
  pageSize?: number;
  patientId?: string;
  /** Inclusive treatment-date range (`YYYY-MM-DD`). */
  from?: string;
  to?: string;
  q?: string;
};

export type AdminDentalRecordsResult = {
  timezone: string;
  records: AdminDentalRecordListItem[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

export type AdminDentalFile = {
  id: string;
  originalName: string;
  contentType: string;
  byteSize: number;
  status: DentalFileStatusKey;
  createdAt: string;
  updatedAt: string;
};

export type AdminDentalRecordDetail = {
  timezone: string;
  record: {
    id: string;
    patientId: string;
    patientName: string;
    treatmentDate: string;
    diagnosis: string;
    treatmentDetails: string;
    clinicalNotes: string | null;
    author: string | null;
    createdAt: string;
    updatedAt: string;
  };
  files: AdminDentalFile[];
  /** F-5: total file count for the record (not limited by the list cap). */
  filesTotal: number;
  /** F-5: true when `files` was capped — the list is never silently cut. */
  truncated: boolean;
  permissions: { canEdit: boolean; canDelete: boolean };
};

export type DentalRecordCreateInput = {
  patientId: string;
  treatmentDate: string;
  diagnosis: string;
  treatmentDetails: string;
  clinicalNotes?: string;
};

export type DentalRecordUpdateInput = {
  treatmentDate?: string;
  diagnosis?: string;
  treatmentDetails?: string;
  clinicalNotes?: string;
};

export type DentalFileInitInput = {
  originalName: string;
  contentType: string;
  byteSize: number;
};

export type DentalUploadTicket = {
  id: string;
  upload: {
    url: string;
    method: "PUT";
    /** Signed — the browser MUST send exactly these headers on the PUT. */
    headers: Record<string, string>;
    expiresAt: string;
  };
};

export type DentalCompletedFile = {
  id: string;
  status: "AVAILABLE" | "REJECTED";
  originalName: string;
  contentType: string;
  byteSize: number;
  reason?: string;
};

export type DentalCleanupRun = {
  runId: string;
  mode: "throttle" | "full";
  startedAt: string;
  finishedAt: string;
  t0: string;
  leaseAcquired: boolean;
  stoppedBy: "complete" | "budget" | "deadline" | "lease_busy" | "no_database";
  jobs: Array<{
    job: "sweep" | "delete" | "purge" | "reconcile";
    processed: number;
    counts: Record<string, number>;
    skipped?: string;
    cursorComplete?: boolean;
  }>;
  cursor: string | null;
  cursorCycleComplete: boolean;
};

/** Paginated dental-record history (newest treatment date first). */
export function fetchAdminDentalRecords(
  params: AdminDentalRecordsParams = {},
  signal?: AbortSignal,
): Promise<AdminDentalRecordsResult> {
  const search = toQueryString(params);
  return requestJson<AdminDentalRecordsResult>(`/api/admin/dental-records?${search.toString()}`, {
    headers: { accept: "application/json" },
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
}

/** One record + its files (ADMIN). */
export function fetchAdminDentalRecord(
  id: string,
  signal?: AbortSignal,
): Promise<AdminDentalRecordDetail> {
  return requestJson<AdminDentalRecordDetail>(
    `/api/admin/dental-records/${encodeURIComponent(id)}`,
    {
      headers: { accept: "application/json" },
      cache: "no-store",
      ...(signal ? { signal } : {}),
    },
  );
}

/** Create a dental record (ADMIN, audited). */
export function createAdminDentalRecord(
  input: DentalRecordCreateInput,
): Promise<AdminDentalRecordListItem> {
  return requestJson<{ record: AdminDentalRecordListItem }>("/api/admin/dental-records", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }).then((body) => body.record);
}

/** Edit a dental record (ADMIN, audited). */
export function updateAdminDentalRecord(
  id: string,
  patch: DentalRecordUpdateInput,
): Promise<AdminDentalRecordListItem> {
  return requestJson<{ record: AdminDentalRecordListItem }>(
    `/api/admin/dental-records/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    },
  ).then((body) => body.record);
}

/** Soft-delete a record and queue its files (ADMIN, audited). */
export function deleteAdminDentalRecord(
  id: string,
): Promise<{ recordId: string; filesQueued: number }> {
  return requestJson<{ recordId: string; filesQueued: number }>(
    `/api/admin/dental-records/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}

/** Step 1 of upload — reserves the file and returns the presigned PUT. */
export function initDentalFile(
  recordId: string,
  input: DentalFileInitInput,
): Promise<DentalUploadTicket> {
  return requestJson<{ file: DentalUploadTicket }>(
    `/api/admin/dental-records/${encodeURIComponent(recordId)}/files`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  ).then((body) => body.file);
}

/** Step 2 of upload — server verifies the stored bytes (AVAILABLE/REJECTED). */
export function completeDentalFile(fileId: string): Promise<DentalCompletedFile> {
  return requestJson<{ file: DentalCompletedFile }>(
    `/api/admin/dental-records/files/${encodeURIComponent(fileId)}/complete`,
    { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
  ).then((body) => body.file);
}

/** Short-lived presigned download URL (each call is audited server-side). */
export function fetchDentalFileUrl(fileId: string): Promise<{ url: string; expiresAt: string }> {
  return requestJson<{ url: string; expiresAt: string }>(
    `/api/admin/dental-records/files/${encodeURIComponent(fileId)}/url`,
    { headers: { accept: "application/json" }, cache: "no-store" },
  );
}

/** Delete a file (ADMIN, audited intent first). */
export function deleteDentalFile(
  fileId: string,
): Promise<{ deleted: boolean; queued: boolean }> {
  return requestJson<{ deleted: boolean; queued: boolean }>(
    `/api/admin/dental-records/files/${encodeURIComponent(fileId)}`,
    { method: "DELETE" },
  );
}

/** Manual cleanup — "throttle" sweeps A–C only, "full" runs A–D. */
export function runDentalCleanup(mode: "throttle" | "full"): Promise<DentalCleanupRun> {
  return requestJson<{ run: DentalCleanupRun }>("/api/admin/dental-records/cleanup", {
    method: mode === "full" ? "POST" : "GET",
    headers: { accept: "application/json" },
    cache: "no-store",
  }).then((body) => body.run);
}
