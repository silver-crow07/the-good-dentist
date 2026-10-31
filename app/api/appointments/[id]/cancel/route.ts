/**
 * POST /api/appointments/[id]/cancel — STAFF ONLY (session cookie required).
 *
 * Body: { reason? } — optional free-text cancellation reason (bounded).
 * Cancelling frees the slot for other patients (cancellation is not a
 * slot-reserving status).
 *
 * Responses: 200 cancelled appointment · 401 unauthenticated ·
 *            404 unknown id · 409 already terminal · 503 DB unavailable
 */

import { NextRequest } from "next/server";

import { handleRouteError, jsonError, jsonOk } from "@/lib/server/api";
import { AppointmentError, cancelAppointment } from "@/lib/server/appointments";
import { requireStaff } from "@/lib/server/guard";
import { cancelAppointmentSchema, parseJsonBody, safeParseWith } from "@/lib/server/validation";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const guard = await requireStaff(request);
  if (guard.response) return guard.response;

  const text = await request.text();
  let body: unknown = {};
  if (text.trim() !== "") {
    body = parseJsonBody(text);
    if (body === undefined || body === null || typeof body !== "object") {
      return jsonError("VALIDATION_ERROR", "Invalid request body.");
    }
  }
  const parsed = safeParseWith(cancelAppointmentSchema, body);
  if (!parsed.ok) {
    return jsonError("VALIDATION_ERROR", "Please review the highlighted fields.", parsed.fields);
  }

  const { id } = await context.params;
  try {
    const appointment = await cancelAppointment(id, parsed.data.reason, guard.staff.id);
    return jsonOk({ appointment, message: "Appointment cancelled." });
  } catch (error) {
    if (error instanceof AppointmentError) {
      return jsonError(error.code, error.message, error.fields);
    }
    return handleRouteError(error, "appointments/[id]/cancel");
  }
}
