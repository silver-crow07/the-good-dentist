"use client";

/**
 * Reschedule dialog — picks a new start time via the EXISTING public
 * availability API (GET /api/appointments/availability, with the
 * appointment's doctorSlug so busy intervals match the right clinician),
 * then submits through the EXISTING conflict-safe PATCH /api/appointments/[id]
 * (advisory lock + exclusion constraint + audit log — no duplicated logic).
 *
 * Unavailable slots render disabled and clearly marked; if the target is
 * taken between load and submit (409), slots refresh and the server's safe
 * message is shown. No data leaves React state.
 */

import { CalendarClock, LoaderCircle, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { FieldLabel, Input } from "@/components/ui/field";
import type { AdminAppointment } from "@/lib/client/admin";
import { ApiClientError, updateAdminAppointment } from "@/lib/client/admin";
import { fetchAvailability, type AvailabilityResult } from "@/lib/client/appointments";
import { formatClinicTime } from "@/lib/client/format";
import { cn } from "@/lib/utils";

type AvailabilityState =
  | { fetchKey: string; status: "loading" }
  | { fetchKey: string; status: "error"; message: string }
  | { fetchKey: string; status: "ready"; data: AvailabilityResult };

/** Clinic-local `YYYY-MM-DD` of an instant, formatted in the CLINIC zone. */
function clinicDayKey(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

type RescheduleDialogProps = {
  appointment: AdminAppointment;
  timezone: string;
  todayKey: string;
  onClose: () => void;
  onRescheduled: (updated: AdminAppointment) => void;
};

export function RescheduleDialog({
  appointment,
  timezone,
  todayKey,
  onClose,
  onRescheduled,
}: RescheduleDialogProps) {
  const [dateKey, setDateKey] = useState(() => clinicDayKey(appointment.startsAt, timezone));
  const [selectedStart, setSelectedStart] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [availability, setAvailability] = useState<AvailabilityState | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const fetchKey = `${dateKey}|${appointment.service.slug}|${appointment.doctor.slug}|${reloadToken}`;

  useEffect(() => {
    const controller = new AbortController();
    fetchAvailability(dateKey, appointment.service.slug, controller.signal, appointment.doctor.slug)
      .then((data) => {
        if (controller.signal.aborted) return;
        setAvailability({ fetchKey, status: "ready", data });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        setAvailability({
          fetchKey,
          status: "error",
          message:
            error instanceof ApiClientError
              ? error.message
              : "Could not load available times. Please try again.",
        });
      });
    return () => controller.abort();
  }, [fetchKey, dateKey, appointment.service.slug, appointment.doctor.slug]);

  // Derived loading: stale state (different fetchKey) never renders as if fresh.
  const current = availability && availability.fetchKey === fetchKey ? availability : null;

  async function submit() {
    if (!selectedStart || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const updated = await updateAdminAppointment(appointment.publicId, {
        startsAt: selectedStart,
      });
      onRescheduled(updated);
    } catch (error) {
      if (error instanceof ApiClientError) {
        setSubmitError(error.message);
        // 409 = the slot was just taken — refresh what is still bookable.
        if (error.code === "CONFLICT") {
          setSelectedStart(null);
          setReloadToken((token) => token + 1);
        }
      } else {
        setSubmitError("Something went wrong while rescheduling. Please try again.");
      }
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-ink/50 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Reschedule appointment for ${appointment.patient.fullName}`}
      onClick={(event) => {
        event.stopPropagation();
        onClose();
      }}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-lift sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
              <CalendarClock aria-hidden="true" className="size-5 text-primary" />
              Reschedule
            </h2>
            <p className="mt-0.5 text-sm text-muted">
              {appointment.service.name} · {appointment.doctor.name}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close reschedule dialog"
            className="flex size-9 items-center justify-center rounded-xl border border-line text-ink transition-colors hover:bg-line-soft"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <FieldLabel htmlFor="reschedule-date" required>
                New date
              </FieldLabel>
              <Input
                id="reschedule-date"
                type="date"
                value={dateKey}
                min={todayKey}
                onChange={(event) => {
                  setDateKey(event.target.value);
                  setSelectedStart(null);
                  setSubmitError(null);
                }}
              />
            </div>
            <p className="pb-3 text-xs text-muted">{timezone}</p>
          </div>

          {!current || current.status === "loading" ? (
            <div aria-busy="true" className="mt-4 animate-pulse" role="status">
              <span className="sr-only">Loading available times…</span>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {Array.from({ length: 8 }, (_, i) => (
                  <div key={i} className="h-9 rounded-xl bg-line-soft" />
                ))}
              </div>
            </div>
          ) : current.status === "error" ? (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-sm text-red-700">{current.message}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => setReloadToken((token) => token + 1)}
              >
                <RefreshCw aria-hidden="true" className="size-4" />
                Try again
              </Button>
            </div>
          ) : current.data.closed ? (
            <p className="mt-4 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-muted">
              The clinic is closed on this date — choose another day.
            </p>
          ) : (
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
                {current.data.service.name} · {current.data.service.durationMinutes} min
              </p>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {current.data.slots.map((slot) => {
                  const isCurrent = slot.start === appointment.startsAt;
                  const isSelected = slot.start === selectedStart;
                  const disabled = !slot.available || isCurrent;
                  return (
                    <button
                      key={slot.start}
                      type="button"
                      disabled={disabled}
                      aria-pressed={isSelected}
                      title={
                        isCurrent
                          ? "Current appointment time"
                          : slot.available
                            ? "Available"
                            : "Unavailable"
                      }
                      onClick={() => {
                        setSelectedStart(slot.start);
                        setSubmitError(null);
                      }}
                      className={cn(
                        "rounded-xl border px-2 py-2 text-sm font-medium transition-colors",
                        isSelected
                          ? "border-primary bg-primary text-white shadow-soft"
                          : isCurrent
                            ? "cursor-not-allowed border-dashed border-muted/40 bg-line-soft text-muted"
                            : slot.available
                              ? "border-line bg-white text-ink hover:border-primary/50 hover:bg-mint"
                              : "cursor-not-allowed border-line-soft bg-line-soft/60 text-muted/60 line-through",
                      )}
                    >
                      {slot.label}
                      {isCurrent ? (
                        <span className="block text-[10px] font-normal no-underline">
                          current
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted">
                <span className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="size-2.5 rounded-full border border-line bg-white" />
                  Available
                </span>
                <span className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="size-2.5 rounded-full bg-line" />
                  Unavailable
                </span>
                <span className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="size-2.5 rounded-full border border-dashed border-muted/50" />
                  Current time
                </span>
              </div>
            </div>
          )}

          {submitError ? (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {submitError}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-4">
          <p className="hidden text-xs text-muted sm:block">
            Now: {formatClinicTime(appointment.startsAt, timezone)}
          </p>
          <div className="flex flex-1 justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!selectedStart || submitting}
              aria-busy={submitting}
              onClick={() => void submit()}
            >
              {submitting ? (
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <CalendarClock aria-hidden="true" className="size-4" />
              )}
              Move appointment
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
