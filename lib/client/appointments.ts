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
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    // Network failure (offline, server down) — never silently "succeed".
    throw new ApiClientError(
      0,
      "NETWORK",
      "We could not reach the clinic's booking system. Check your connection and try again, or book via WhatsApp.",
    );
  }
  if (!response.ok) throw await readError(response);
  return (await response.json()) as T;
}

/** Loads availability for one date + treatment. */
export function fetchAvailability(
  date: string,
  serviceSlug: string,
  signal?: AbortSignal,
): Promise<AvailabilityResult> {
  const params = new URLSearchParams({ date, serviceSlug });
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
