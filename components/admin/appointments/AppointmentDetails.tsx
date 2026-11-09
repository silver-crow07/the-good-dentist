"use client";

/**
 * Appointment details dialog — loads the full staff view from the EXISTING
 * GET /api/appointments/[id] and exposes the staff actions, all of which go
 * through the EXISTING audited endpoints:
 *
 *   Confirm / Complete / No-show → PATCH { status }   (VALID_TRANSITIONS)
 *   Cancel                       → POST …/cancel      (optional reason)
 *   Reschedule                   → dialog → availability API + PATCH
 *
 * The server re-checks every transition and conflict; nothing here decides
 * permissions or business rules — it only surfaces them.
 */

import {
  CalendarClock,
  CalendarOff,
  CircleAlert,
  CircleCheck,
  CircleX,
  LoaderCircle,
  Mail,
  Phone,
  RefreshCw,
  User,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { RescheduleDialog } from "@/components/admin/appointments/RescheduleDialog";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import type { AdminAppointment } from "@/lib/client/admin";
import {
  ApiClientError,
  cancelAdminAppointment,
  fetchAdminAppointment,
  updateAdminAppointment,
} from "@/lib/client/admin";
import { formatClinicDateTime, formatClinicTime, formatRelativeTime } from "@/lib/client/format";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; appointment: AdminAppointment };

type AppointmentDetailsProps = {
  publicId: string;
  timezone: string;
  todayKey: string;
  onClose: () => void;
  /** Called after any successful mutation so the list behind can refresh. */
  onUpdated: () => void;
};

export function AppointmentDetails({
  publicId,
  timezone,
  todayKey,
  onClose,
  onUpdated,
}: AppointmentDetailsProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [rescheduling, setRescheduling] = useState(false);

  const load = useCallback(
    (signal?: AbortSignal) => {
      // No synchronous setState here: the initial state is already "loading",
      // and retries flip it in their click handler before calling this.
      fetchAdminAppointment(publicId, signal)
        .then((appointment) => {
          if (signal?.aborted) return;
          setState({ status: "ready", appointment });
        })
        .catch((error: unknown) => {
          if (signal?.aborted) return;
          if (error instanceof DOMException && error.name === "AbortError") return;
          setState({
            status: "error",
            message:
              error instanceof ApiClientError
                ? error.message
                : "Could not load this appointment.",
          });
        });
    },
    [publicId],
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // Escape closes the TOP dialog only: while rescheduling is open, the
  // reschedule dialog owns the Escape key.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !rescheduling) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, rescheduling]);

  const applyUpdate = useCallback(
    (updated: AdminAppointment) => {
      setState({ status: "ready", appointment: updated });
      setActionError(null);
      setCancelling(false);
      setCancelReason("");
      onUpdated();
    },
    [onUpdated],
  );

  async function runAction(action: () => Promise<AdminAppointment>) {
    if (actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      const updated = await action();
      applyUpdate(updated);
    } catch (error) {
      setActionError(
        error instanceof ApiClientError
          ? error.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setActionBusy(false);
    }
  }

  const appointment = state.status === "ready" ? state.appointment : null;

  return (
    <>
      <div
        className="fixed inset-0 z-[60] flex items-end justify-center bg-ink/50 backdrop-blur-sm sm:items-center sm:p-4"
        role="dialog"
        aria-modal="true"
        aria-label="Appointment details"
        onClick={onClose}
      >
        <div
          className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-lift sm:rounded-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-ink">Appointment details</h2>
              <p className="mt-0.5 font-mono text-xs text-muted">{publicId}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close appointment details"
              className="flex size-9 items-center justify-center rounded-xl border border-line text-ink transition-colors hover:bg-line-soft"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {state.status === "loading" ? (
              <div aria-busy="true" role="status" className="animate-pulse space-y-4">
                <span className="sr-only">Loading appointment…</span>
                <div className="h-6 w-40 rounded bg-line-soft" />
                <div className="h-4 w-64 rounded bg-line-soft" />
                <div className="h-4 w-52 rounded bg-line-soft" />
                <div className="h-20 rounded-xl bg-line-soft" />
              </div>
            ) : state.status === "error" ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <CircleAlert aria-hidden="true" className="size-8 text-red-600" />
                <p className="text-sm text-muted">{state.message}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setState({ status: "loading" });
                    load();
                  }}
                >
                  <RefreshCw aria-hidden="true" className="size-4" />
                  Try again
                </Button>
              </div>
            ) : appointment ? (
              <DetailsBody
                appointment={appointment}
                timezone={timezone}
                error={actionError}
                cancelling={cancelling}
                cancelReason={cancelReason}
                onCancelReasonChange={setCancelReason}
                onAbortCancel={() => {
                  setCancelling(false);
                  setCancelReason("");
                  setActionError(null);
                }}
                busy={actionBusy}
                onCancel={() =>
                  runAction(() =>
                    cancelAdminAppointment(publicId, cancelReason.trim() || undefined),
                  )
                }
              />
            ) : null}
          </div>

          {appointment ? (
            <div className="border-t border-line px-5 py-4">
              <ActionBar
                appointment={appointment}
                busy={actionBusy}
                cancelling={cancelling}
                onConfirm={() =>
                  runAction(() => updateAdminAppointment(publicId, { status: "CONFIRMED" }))
                }
                onComplete={() =>
                  runAction(() => updateAdminAppointment(publicId, { status: "COMPLETED" }))
                }
                onNoShow={() =>
                  runAction(() => updateAdminAppointment(publicId, { status: "NO_SHOW" }))
                }
                onStartCancel={() => {
                  setCancelling(true);
                  setActionError(null);
                }}
                onReschedule={() => setRescheduling(true)}
              />
            </div>
          ) : null}
        </div>
      </div>

      {rescheduling && appointment ? (
        <RescheduleDialog
          appointment={appointment}
          timezone={timezone}
          todayKey={todayKey}
          onClose={() => setRescheduling(false)}
          onRescheduled={(updated) => {
            setRescheduling(false);
            applyUpdate(updated);
          }}
        />
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Body (pure presentation over the loaded appointment)
 * ------------------------------------------------------------------ */

type DetailsBodyProps = {
  appointment: AdminAppointment;
  timezone: string;
  error: string | null;
  busy: boolean;
  cancelling: boolean;
  cancelReason: string;
  onCancelReasonChange: (value: string) => void;
  onAbortCancel: () => void;
  onCancel: () => void;
};

function DetailsBody({
  appointment,
  timezone,
  error,
  busy,
  cancelling,
  cancelReason,
  onCancelReasonChange,
  onAbortCancel,
  onCancel,
}: DetailsBodyProps) {
  return (
    <div className="space-y-5">
      {/* Headline */}
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={appointment.status} className="px-3 py-1 text-sm" />
        <span className="rounded-full bg-line-soft px-2.5 py-1 text-xs font-medium text-ink/70">
          {appointment.source === "WEBSITE"
            ? "Website booking"
            : appointment.source === "WHATSAPP"
              ? "WhatsApp"
              : "Created by staff"}
        </span>
        <span className="text-xs text-muted">
          Requested {formatRelativeTime(appointment.createdAt)}
        </span>
      </div>

      {/* When */}
      <div className="rounded-xl border border-line bg-surface px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">When</p>
        <p className="mt-1 text-sm font-medium text-ink">
          {formatClinicDateTime(appointment.startsAt, timezone)}
          {" – "}
          {formatClinicTime(appointment.endsAt, timezone)}
        </p>
        <p className="mt-0.5 text-xs text-muted">Clinic time ({timezone})</p>
      </div>

      {/* Patient */}
      <div className="rounded-xl border border-line px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Patient</p>
        <p className="mt-1.5 flex items-center gap-2 text-sm font-medium text-ink">
          <User aria-hidden="true" className="size-4 text-muted" />
          {appointment.patient.fullName}
        </p>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
          <a
            href={`tel:${appointment.patient.phone.replace(/[^\d+]/g, "")}`}
            className="inline-flex items-center gap-1.5 text-ink/80 transition-colors hover:text-primary"
          >
            <Phone aria-hidden="true" className="size-4 text-muted" />
            {appointment.patient.phone}
          </a>
          {appointment.patient.email ? (
            <a
              href={`mailto:${appointment.patient.email}`}
              className="inline-flex items-center gap-1.5 text-ink/80 transition-colors hover:text-primary"
            >
              <Mail aria-hidden="true" className="size-4 text-muted" />
              {appointment.patient.email}
            </a>
          ) : null}
        </div>
      </div>

      {/* Treatment */}
      <div className="rounded-xl border border-line px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Treatment</p>
        <p className="mt-1.5 text-sm font-medium text-ink">{appointment.service.name}</p>
        <p className="mt-0.5 text-sm text-muted">with {appointment.doctor.name}</p>
      </div>

      {/* Notes / reason */}
      {appointment.patientNotes ? (
        <div className="rounded-xl border border-line px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Patient note
          </p>
          <p className="mt-1.5 whitespace-pre-wrap text-sm text-ink/90">
            {appointment.patientNotes}
          </p>
        </div>
      ) : null}
      {appointment.status === "CANCELLED" && appointment.cancellationReason ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-red-700">
            Cancellation reason
          </p>
          <p className="mt-1.5 whitespace-pre-wrap text-sm text-red-800">
            {appointment.cancellationReason}
          </p>
        </div>
      ) : null}

      {/* Errors */}
      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </p>
      ) : null}

      {/* Inline cancel form */}
      {cancelling ? (
        <div className="rounded-xl border border-red-200 bg-red-50/60 px-4 py-3">
          <label htmlFor="cancel-reason" className="block text-sm font-medium text-ink">
            Cancel this appointment?
            <span className="ml-1.5 text-xs font-normal text-muted">reason optional</span>
          </label>
          <Textarea
            id="cancel-reason"
            value={cancelReason}
            onChange={(event) => onCancelReasonChange(event.target.value)}
            maxLength={300}
            rows={2}
            placeholder="e.g. Patient asked to move to next week"
            className="mt-2"
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onAbortCancel} disabled={busy}>
              Keep appointment
            </Button>
            <Button
              size="sm"
              onClick={onCancel}
              disabled={busy}
              aria-busy={busy}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {busy ? (
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <CircleX aria-hidden="true" className="size-4" />
              )}
              Cancel appointment
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Action bar (footer of the dialog)
 * ------------------------------------------------------------------ */

type ActionBarProps = {
  appointment: AdminAppointment;
  busy: boolean;
  cancelling: boolean;
  onConfirm: () => void;
  onComplete: () => void;
  onNoShow: () => void;
  onStartCancel: () => void;
  onReschedule: () => void;
};

function ActionBar({
  appointment,
  busy,
  cancelling,
  onConfirm,
  onComplete,
  onNoShow,
  onStartCancel,
  onReschedule,
}: ActionBarProps) {
  const status = appointment.status;
  const isPending = status === "PENDING";
  const isConfirmed = status === "CONFIRMED";

  if (!isPending && !isConfirmed) {
    return (
      <p className="text-xs text-muted">
        This appointment is {status === "CANCELLED" ? "cancelled" : "finished"} — no further
        actions are available.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {isPending ? (
        <Button size="sm" onClick={onConfirm} disabled={busy} aria-busy={busy}>
          {busy ? (
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <CircleCheck aria-hidden="true" className="size-4" />
          )}
          Confirm
        </Button>
      ) : null}
      {isConfirmed ? (
        <>
          <Button size="sm" onClick={onComplete} disabled={busy} aria-busy={busy}>
            {busy ? (
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <CircleCheck aria-hidden="true" className="size-4" />
            )}
            Mark completed
          </Button>
          <Button variant="outline" size="sm" onClick={onReschedule} disabled={busy || cancelling}>
            <CalendarClock aria-hidden="true" className="size-4" />
            Reschedule
          </Button>
          <Button variant="outline" size="sm" onClick={onNoShow} disabled={busy || cancelling}>
            <CalendarOff aria-hidden="true" className="size-4" />
            No-show
          </Button>
        </>
      ) : null}
      {!cancelling ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={onStartCancel}
          disabled={busy}
          className="text-red-600 hover:bg-red-50 hover:text-red-700"
        >
          <CircleX aria-hidden="true" className="size-4" />
          Cancel
        </Button>
      ) : null}
    </div>
  );
}
