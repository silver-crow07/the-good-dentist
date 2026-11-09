"use client";

/**
 * Settings (Phase B) — READ-ONLY.
 *
 * Shows the signed-in staff member's own profile plus the database-owned
 * rules the booking engine enforces: weekly clinic hours, appointment slot
 * interval and booking policy. There are no edit controls by design — these
 * values are seeded/owned server-side, and changing them is a separately
 * approved future feature.
 */

import {
  CalendarDays,
  CircleAlert,
  Clock,
  Info,
  RefreshCw,
  ShieldCheck,
  User,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ApiClientError,
  fetchAdminSettings,
  type AdminSettings,
} from "@/lib/client/admin";
import {
  formatMinutesOfDay,
  initialsOf,
  weekdayLongName,
} from "@/lib/client/format";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; settings: AdminSettings };

function formatJoined(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function SettingsView() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const load = useCallback((signal?: AbortSignal) => {
    fetchAdminSettings(signal)
      .then((settings) => {
        if (signal?.aborted) return;
        setState({ status: "ready", settings });
      })
      .catch((error: unknown) => {
        if (signal?.aborted) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({
          status: "error",
          message:
            error instanceof ApiClientError
              ? error.message
              : "Could not load settings. Please try again.",
        });
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (state.status === "loading") {
    return (
      <div aria-busy="true" aria-live="polite" className="animate-pulse space-y-4">
        <span className="sr-only">Loading settings…</span>
        <div className="h-40 rounded-2xl bg-card" />
        <div className="h-48 rounded-2xl bg-card" />
        <div className="h-64 rounded-2xl bg-card" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div
        role="alert"
        className="mx-auto mt-10 flex max-w-md flex-col items-center gap-3 rounded-2xl border border-line bg-card px-6 py-10 text-center shadow-soft"
      >
        <CircleAlert aria-hidden="true" className="size-9 text-red-600" />
        <p className="text-sm font-medium text-ink">Could not load settings</p>
        <p className="text-sm leading-relaxed text-muted">{state.message}</p>
        <Button onClick={() => load()} variant="outline" size="sm" className="mt-1">
          <RefreshCw aria-hidden="true" className="size-4" />
          Try again
        </Button>
      </div>
    );
  }

  const { settings } = state;

  return (
    <div className="space-y-4">
      {/* Read-only banner */}
      <p className="flex items-start gap-2 rounded-2xl border border-primary/20 bg-mint px-4 py-3 text-sm text-primary-deep">
        <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        Read-only view — clinic schedule and booking rules are managed
        server-side by the clinic administrator.
      </p>

      {/* Staff profile + clinic basics */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-line bg-card p-5 shadow-soft">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <User aria-hidden="true" className="size-4 text-primary" />
            Staff profile
          </h2>
          <div className="mt-4 flex items-center gap-4">
            <span
              aria-hidden="true"
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-mint text-base font-bold text-primary"
            >
              {initialsOf(settings.staff.fullName)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-ink">
                {settings.staff.fullName}
              </p>
              <p className="truncate text-sm text-muted">{settings.staff.email}</p>
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line-soft pt-4 text-sm">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted">Role</dt>
              <dd className="mt-1">
                <Badge variant={settings.staff.role === "ADMIN" ? "primary" : "muted"}>
                  {settings.staff.role === "ADMIN" ? "Administrator" : "Staff"}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted">Joined</dt>
              <dd className="mt-1 text-ink">{formatJoined(settings.staff.joinedAt)}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-2xl border border-line bg-card p-5 shadow-soft">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <ShieldCheck aria-hidden="true" className="size-4 text-primary" />
            Booking rules
          </h2>
          <dl className="mt-4 space-y-4 text-sm">
            <div className="flex items-start justify-between gap-3 border-b border-line-soft pb-3">
              <div>
                <dt className="font-medium text-ink">Appointment interval</dt>
                <dd className="mt-0.5 text-xs text-muted">
                  Every bookable slot starts on this grid.
                </dd>
              </div>
              <span className="shrink-0 rounded-full bg-mint px-3 py-1 text-sm font-semibold text-primary tabular-nums">
                {settings.slotIntervalMinutes} min
              </span>
            </div>
            <div className="flex items-start justify-between gap-3">
              <div>
                <dt className="font-medium text-ink">Booking policy</dt>
                <dd className="mt-0.5 text-xs text-muted">
                  {settings.bookingPolicy === "MANUAL_APPROVAL"
                    ? "Website requests arrive as PENDING — staff confirm each one."
                    : "New website bookings are confirmed automatically."}
                </dd>
              </div>
              <span className="shrink-0 rounded-full bg-mint px-3 py-1 text-xs font-semibold text-primary">
                {settings.bookingPolicy === "MANUAL_APPROVAL" ? "Manual approval" : "Auto-confirm"}
              </span>
            </div>
            <div className="flex items-start justify-between gap-3 border-t border-line-soft pt-3">
              <div>
                <dt className="font-medium text-ink">Clinic</dt>
                <dd className="mt-0.5 text-xs text-muted">
                  {settings.clinic.name} · {settings.clinic.timezone}
                </dd>
              </div>
            </div>
          </dl>
        </section>
      </div>

      {/* Weekly hours */}
      <section className="rounded-2xl border border-line bg-card shadow-soft">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <CalendarDays aria-hidden="true" className="size-4 text-primary" />
            Clinic hours
          </h2>
          <span className="text-xs text-muted">{settings.clinic.timezone}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                <th scope="col" className="px-5 py-3 font-semibold">Day</th>
                <th scope="col" className="px-5 py-3 font-semibold">Hours</th>
                <th scope="col" className="px-5 py-3 font-semibold">Break</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {settings.hours.map((hour) => (
                <tr key={hour.weekday} className="transition-colors hover:bg-mint/50">
                  <td className="whitespace-nowrap px-5 py-3 font-medium text-ink">
                    {weekdayLongName(hour.weekday)}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-ink/80">
                    {hour.closed ? (
                      <span className="inline-flex items-center gap-1.5 text-muted">
                        <span aria-hidden="true" className="size-2 rounded-full bg-stone-400" />
                        Closed
                      </span>
                    ) : (
                      <>
                        {formatMinutesOfDay(hour.opensAtMinutes)} –{" "}
                        {formatMinutesOfDay(hour.closesAtMinutes)}
                      </>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-muted">
                    {!hour.closed &&
                    hour.breakStartMinutes !== null &&
                    hour.breakEndMinutes !== null ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Clock aria-hidden="true" className="size-3.5" />
                        {formatMinutesOfDay(hour.breakStartMinutes)} –{" "}
                        {formatMinutesOfDay(hour.breakEndMinutes)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
