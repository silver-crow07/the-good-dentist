/**
 * GET /api/appointments/availability?date=YYYY-MM-DD&serviceSlug=…&doctorSlug=…
 *
 * Public. Returns the clinic's slots for one date and treatment, computed
 * server-side from the database schedule. `doctorSlug` is optional (staff
 * reschedule targets a specific clinician; public booking uses the default).
 * No patient data is involved.
 *
 * Responses:
 *   200 { date, timezone, closed, service, doctor, slots: [{ start, label, available }] }
 *   400 VALIDATION_ERROR   — bad date / unknown or inactive treatment
 *   429 RATE_LIMITED       — per-IP abuse control
 *   503 SERVICE_UNAVAILABLE — database/schedule not configured
 */

import { NextRequest } from "next/server";

import { clientIp, handleRouteError, jsonError, jsonOk, jsonRateLimited } from "@/lib/server/api";
import { AppointmentError, getAvailability } from "@/lib/server/appointments";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { availabilityQuerySchema, safeParseWith } from "@/lib/server/validation";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const ip = clientIp(request);
  const limit = checkRateLimit(`availability:${ip}`, 300, 60_000);
  if (!limit.ok) return jsonRateLimited(limit.retryAfterMs);

  const query = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = safeParseWith(availabilityQuerySchema, query);
  if (!parsed.ok) {
    return jsonError("VALIDATION_ERROR", "Please choose a valid date and treatment.", parsed.fields);
  }

  try {
    const payload = await getAvailability({
      date: parsed.data.date,
      serviceSlug: parsed.data.serviceSlug,
      doctorSlug: parsed.data.doctorSlug,
    });
    return jsonOk(payload);
  } catch (error) {
    if (error instanceof AppointmentError) {
      return jsonError(error.code, error.message, error.fields);
    }
    return handleRouteError(error, "appointments/availability");
  }
}
