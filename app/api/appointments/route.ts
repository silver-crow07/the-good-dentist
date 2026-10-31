/**
 * POST /api/appointments — public booking request.
 *
 * Body: { patient: { fullName, phone, email? }, serviceSlug, doctorSlug?,
 *         startsAt: ISO-8601 instant with offset, patientNotes? }
 *
 * The server re-validates everything (rules, availability, conflicts) — the
 * frontend is never trusted. New requests default to PENDING under the
 * MANUAL_APPROVAL booking policy; patients are told the request was received,
 * never that the appointment is confirmed.
 *
 * Responses:
 *   201 { appointment: { publicId, status, startsAt, endsAt, service, doctor }, message }
 *   400 VALIDATION_ERROR  — invalid body / closed day / lunch / past / beyond close
 *   409 CONFLICT          — slot already taken (ask for another slot)
 *   403 FORBIDDEN         — cross-origin request
 *   429 RATE_LIMITED      — per-IP abuse control
 *   503 SERVICE_UNAVAILABLE — database not configured
 */

import {
  clientIp,
  handleRouteError,
  jsonCreated,
  jsonError,
  jsonRateLimited,
} from "@/lib/server/api";
import { AppointmentError, createBooking } from "@/lib/server/appointments";
import { isSameOrigin } from "@/lib/server/auth";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { createAppointmentSchema, parseJsonBody, safeParseWith } from "@/lib/server/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const ip = clientIp(request);

  // Abuse controls: short burst + daily ceiling per IP.
  const burst = checkRateLimit(`booking:${ip}`, 6, 60_000);
  if (!burst.ok) return jsonRateLimited(burst.retryAfterMs);
  const daily = checkRateLimit(`booking-day:${ip}`, 30, 24 * 60 * 60 * 1000);
  if (!daily.ok) {
    return jsonError(
      "RATE_LIMITED",
      "You have made a lot of booking requests today — please try again later or book via WhatsApp.",
    );
  }

  // CSRF defence-in-depth (SameSite=Lax already applies to the cookie).
  if (!isSameOrigin(request)) {
    return jsonError("FORBIDDEN", "Invalid request origin.");
  }

  const body = parseJsonBody(await request.text());
  if (body === undefined || body === null || typeof body !== "object") {
    return jsonError("VALIDATION_ERROR", "Invalid request body.");
  }

  const parsed = safeParseWith(createAppointmentSchema, body);
  if (!parsed.ok) {
    return jsonError("VALIDATION_ERROR", "Please review the highlighted fields.", parsed.fields);
  }

  try {
    const appointment = await createBooking(parsed.data);
    return jsonCreated({
      appointment,
      message:
        appointment.status === "CONFIRMED"
          ? "Your appointment is confirmed. We look forward to seeing you."
          : "Your appointment request has been received — the clinic team will contact you to confirm.",
    });
  } catch (error) {
    if (error instanceof AppointmentError) {
      return jsonError(error.code, error.message, error.fields);
    }
    return handleRouteError(error, "appointments/create");
  }
}
