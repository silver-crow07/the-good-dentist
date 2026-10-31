/**
 * /api/appointments/[id] — STAFF ONLY (session cookie required).
 *
 * id is the public-safe appointment id (`apt_` + 16 hex), never the
 * sequential database id.
 *
 * GET   → 200 full appointment incl. patient contact (staff view)
 *         401 when unauthenticated, 404 when unknown/invalid id
 * PATCH → 200 after an allowed status transition and/or reschedule
 *         409 on invalid transitions / overlapping reschedule targets
 *
 * Status transitions are validated server-side (see VALID_TRANSITIONS):
 *   PENDING → CONFIRMED | CANCELLED
 *   CONFIRMED → CANCELLED | COMPLETED | NO_SHOW
 *   CANCELLED / COMPLETED / NO_SHOW are terminal.
 */

import { NextRequest, NextResponse } from "next/server";

import { handleRouteError, jsonError, jsonOk } from "@/lib/server/api";
import { AppointmentError, updateAppointment, getAppointmentByPublicId } from "@/lib/server/appointments";
import { requireStaff } from "@/lib/server/guard";
import { parseJsonBody, safeParseWith, updateAppointmentSchema } from "@/lib/server/validation";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const guard = await requireStaff(_request);
  if (guard.response) return guard.response;

  const { id } = await context.params;
  try {
    const appointment = await getAppointmentByPublicId(id);
    return jsonOk({ appointment });
  } catch (error) {
    if (error instanceof AppointmentError) {
      return jsonError(error.code, error.message, error.fields);
    }
    return handleRouteError(error, "appointments/[id]/get");
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const guard = await requireStaff(request);
  if (guard.response) return guard.response;

  const body = parseJsonBody(await request.text());
  if (body === undefined || body === null || typeof body !== "object") {
    return jsonError("VALIDATION_ERROR", "Invalid request body.");
  }
  const parsed = safeParseWith(updateAppointmentSchema, body);
  if (!parsed.ok) {
    return jsonError("VALIDATION_ERROR", "Please review the highlighted fields.", parsed.fields);
  }

  const { id } = await context.params;
  try {
    const appointment = await updateAppointment(id, {
      ...parsed.data,
      staffId: guard.staff.id,
    });
    return jsonOk({ appointment });
  } catch (error) {
    if (error instanceof AppointmentError) {
      return jsonError(error.code, error.message, error.fields);
    }
    return handleRouteError(error, "appointments/[id]/patch");
  }
}

// Explicitly refuse other methods with a clear message.
export async function DELETE() {
  return NextResponse.json(
    { error: { code: "NOT_FOUND", message: "Use PATCH to update an appointment." } },
    { status: 405, headers: { Allow: "GET, PATCH" } },
  );
}
