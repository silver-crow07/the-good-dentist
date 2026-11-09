/**
 * Browser-side helpers for the appointment API.
 *
 * Errors are surfaced as `ApiClientError` with the server's safe error code
 * and optional per-field messages — components never need to parse response
 * bodies themselves. No patient data is stored anywhere except React state.
 */

export type ApiErrorBody = {
  error?: { code?: string; message?: string; fields?: Record<string, string> };
};

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export type AvailabilitySlot = {
  /** ISO instant the appointment would start. */
  start: string;
  /** Display label, e.g. "9:00 AM". */
  label: string;
  available: boolean;
};

export type AvailabilityResult = {
  date: string;
  timezone: string;
  closed: boolean;
  service: {
    slug: string;
    name: string;
    durationMinutes: number;
    durationIsProvisional: boolean;
  };
  doctor: { slug: string; name: string };
  slots: AvailabilitySlot[];
};

export type BookedAppointment = {
  publicId: string;
  status: "PENDING" | "CONFIRMED";
  startsAt: string;
  endsAt: string;
  service: { slug: string; name: string };
  doctor: { slug: string; name: string };
};

export type BookingRequestBody = {
  patient: { fullName: string; phone: string; email?: string };
  serviceSlug: string;
  startsAt: string;
  patientNotes?: string;
};

async function readError(response: Response): Promise<ApiClientError> {
  let body: ApiErrorBody = {};
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    // Non-JSON error body (e.g. proxy page) — fall back to generic text.
  }
  return new ApiClientError(
    response.status,
    body.error?.code ?? "INTERNAL",
    body.error?.message ?? "Something went wrong. Please try again.",
    body.error?.fields,
  );
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? "GET";
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (cause) {
    // Network failure (offline, server down) — never silently "succeed".
    console.warn(`[api] ${method} ${url}: network error`, cause);
    throw new ApiClientError(
      0,
      "NETWORK",
      "We could not reach the clinic's booking system. Check your connection and try again, or book via WhatsApp.",
    );
  }
  if (!response.ok) {
    // Safe diagnostic: the on-screen message stays generic, but the browser
    // console records exactly which endpoint failed and with which public
    // error code — enough to distinguish a 503 (DB not configured) from a
    // 400 (bad request) or a 429 without exposing any response payloads.
    const error = await readError(response);
    console.warn(`[api] ${method} ${url}: HTTP ${response.status} ${error.code}`);
    throw error;
  }
  return (await response.json()) as T;
}

/** Loads availability for one date + treatment (optionally a specific clinician — staff reschedule). */
export function fetchAvailability(
  date: string,
  serviceSlug: string,
  signal?: AbortSignal,
  doctorSlug?: string,
): Promise<AvailabilityResult> {
  const params = new URLSearchParams({ date, serviceSlug });
  if (doctorSlug) params.set("doctorSlug", doctorSlug);
  return requestJson<AvailabilityResult>(`/api/appointments/availability?${params.toString()}`, {
    signal,
    headers: { accept: "application/json" },
  });
}

/** Submits an appointment request (server re-validates everything). */
export function requestAppointment(body: BookingRequestBody): Promise<{
  appointment: BookedAppointment;
  message: string;
}> {
  return requestJson<{ appointment: BookedAppointment; message: string }>("/api/appointments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
