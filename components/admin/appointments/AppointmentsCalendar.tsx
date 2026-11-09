import { ChevronLeft, ChevronRight } from "lucide-react";

import { StatusBadge } from "@/components/admin/StatusBadge";
import type { AdminAppointment, AdminAppointmentsResult } from "@/lib/client/admin";
import {
  addDaysKey,
  firstOfMonthKey,
  monthGridKeys,
  monthLabel,
  monthLabelShort,
  partsOfDateKey,
  startOfWeekKey,
  weekDayKeys,
} from "@/lib/admin/calendar";
import {
  formatClinicTime,
  formatDateKeyLong,
  formatWeekRangeLabel,
  weekdayShortOfDateKey,
} from "@/lib/client/format";
import { cn } from "@/lib/utils";

/**
 * Day / Week / Month calendar views.
 *
 * Pure rendering over the server's range result — the parent fetches
 * exactly the clinic-local days each view displays and wraps this in
 * loading/error states. Clicking a day number opens the Day view; clicking
 * a chip opens the details dialog. All times render in the clinic timezone
 * passed down from the options endpoint (never the browser's zone).
 */

export type CalendarView = "list" | "day" | "week" | "month";

type CalendarProps = {
  view: Exclude<CalendarView, "list">;
  anchorKey: string;
  todayKey: string;
  result: AdminAppointmentsResult;
  timezone: string;
  onSelect: (appointment: AdminAppointment) => void;
  onOpenDay: (dateKey: string) => void;
};

/** Status colour dot shared by week/month chips. */
function StatusDot({ status }: { status: AdminAppointment["status"] }) {
  const color =
    status === "PENDING"
      ? "bg-amber-500"
      : status === "CONFIRMED"
        ? "bg-primary"
        : status === "CANCELLED"
          ? "bg-stone-400"
          : status === "NO_SHOW"
            ? "bg-rose-600"
            : "bg-ink";
  return <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", color)} />;
}

/** Clinic-local `YYYY-MM-DD` of an instant — formatted in the CLINIC zone. */
function clinicDayKey(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function byDay(
  result: AdminAppointmentsResult,
  timezone: string,
): Map<string, AdminAppointment[]> {
  const map = new Map<string, AdminAppointment[]>();
  for (const appointment of result.appointments) {
    const key = clinicDayKey(appointment.startsAt, timezone);
    const bucket = map.get(key);
    if (bucket) bucket.push(appointment);
    else map.set(key, [appointment]);
  }
  return map;
}

export function AppointmentsCalendar(props: CalendarProps) {
  const { view } = props;
  if (view === "day") return <DayView {...props} />;
  if (view === "week") return <WeekView {...props} />;
  return <MonthView {...props} />;
}

/* ------------------------------------------------------------------ *
 * Day
 * ------------------------------------------------------------------ */

function DayView({ anchorKey, result, timezone, onSelect }: CalendarProps) {
  const items = result.appointments;

  return (
    <section className="rounded-2xl border border-line bg-card shadow-soft">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
        <h2 className="text-sm font-semibold text-ink">{formatDateKeyLong(anchorKey)}</h2>
        <span className="rounded-full bg-mint px-2.5 py-0.5 text-xs font-semibold text-primary tabular-nums">
          {items.length}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
          <p className="text-sm font-medium text-ink">No appointments on this day</p>
          <p className="max-w-sm text-sm text-muted">
            Use the arrows above to move to another day, or clear the filters.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-line-soft">
          {items.map((appointment) => (
            <li key={appointment.publicId}>
              <button
                type="button"
                onClick={() => onSelect(appointment)}
                className="flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-mint/50"
              >
                <span className="w-20 shrink-0 text-sm font-semibold text-ink tabular-nums">
                  {formatClinicTime(appointment.startsAt, timezone)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">
                    {appointment.patient.fullName}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {appointment.service.name} · {appointment.doctor.name}
                  </span>
                </span>
                <StatusBadge status={appointment.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Week
 * ------------------------------------------------------------------ */

function WeekView({
  anchorKey,
  todayKey,
  result,
  timezone,
  onSelect,
  onOpenDay,
}: CalendarProps) {
  const days = weekDayKeys(startOfWeekKey(anchorKey));
  const grouped = byDay(result, timezone);

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card shadow-soft">
      <div className="grid grid-cols-7 divide-x divide-line border-b border-line">
        {days.map((dayKey) => {
          const isToday = dayKey === todayKey;
          return (
            <div key={dayKey} className={cn("px-2 py-2.5 text-center", isToday && "bg-mint")}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                {weekdayShortOfDateKey(dayKey)}
              </p>
              <button
                type="button"
                onClick={() => onOpenDay(dayKey)}
                aria-label={`Open ${formatDateKeyLong(dayKey)}`}
                className={cn(
                  "mt-0.5 inline-flex size-7 items-center justify-center rounded-full text-sm font-semibold tabular-nums transition-colors",
                  isToday ? "bg-primary text-white" : "text-ink hover:bg-line-soft",
                )}
              >
                {partsOfDateKey(dayKey).day}
              </button>
            </div>
          );
        })}
      </div>

      <div className="grid min-h-[18rem] grid-cols-7 divide-x divide-line">
        {days.map((dayKey) => {
          const items = grouped.get(dayKey) ?? [];
          return (
            <div key={dayKey} className="space-y-1.5 p-1.5">
              {items.length === 0 ? (
                <p className="px-1 py-3 text-center text-xs text-muted/70">—</p>
              ) : (
                items.map((appointment) => (
                  <button
                    key={appointment.publicId}
                    type="button"
                    onClick={() => onSelect(appointment)}
                    title={`${formatClinicTime(appointment.startsAt, timezone)} · ${appointment.patient.fullName} · ${appointment.service.name}`}
                    className="flex w-full items-start gap-1.5 rounded-lg border border-line bg-surface px-1.5 py-1.5 text-left transition-colors hover:border-primary/40 hover:bg-mint"
                  >
                    <span className="mt-0.5">
                      <StatusDot status={appointment.status} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] font-semibold text-ink tabular-nums">
                        {formatClinicTime(appointment.startsAt, timezone)}
                      </span>
                      <span className="block truncate text-[11px] text-muted">
                        {appointment.patient.fullName}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Month
 * ------------------------------------------------------------------ */

const MONTH_CHIP_LIMIT = 2;

function MonthView({
  anchorKey,
  todayKey,
  result,
  timezone,
  onSelect,
  onOpenDay,
}: CalendarProps) {
  const { year, month } = partsOfDateKey(anchorKey);
  const grid = monthGridKeys(year, month);
  const monthPrefix = firstOfMonthKey(anchorKey).slice(0, 7); // "2026-11"
  const grouped = byDay(result, timezone);

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card shadow-soft">
      <div className="grid grid-cols-7 divide-x divide-line border-b border-line bg-surface">
        {grid.slice(0, 7).map((dayKey) => (
          <div key={dayKey} className="px-2 py-2 text-center">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              {weekdayShortOfDateKey(dayKey)}
            </span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {grid.map((dayKey, index) => {
          const inMonth = dayKey.startsWith(monthPrefix);
          const isToday = dayKey === todayKey;
          const items = grouped.get(dayKey) ?? [];
          const visible = items.slice(0, MONTH_CHIP_LIMIT);
          const hidden = items.length - visible.length;

          return (
            <div
              key={dayKey}
              className={cn(
                "min-h-[6.5rem] border-b border-r border-line p-1.5",
                (index + 1) % 7 === 0 && "border-r-0",
                !inMonth && "bg-surface/60",
              )}
            >
              <button
                type="button"
                onClick={() => onOpenDay(dayKey)}
                aria-label={`Open ${formatDateKeyLong(dayKey)}`}
                className={cn(
                  "inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums transition-colors",
                  isToday
                    ? "bg-primary text-white"
                    : inMonth
                      ? "text-ink hover:bg-line-soft"
                      : "text-muted/70 hover:bg-line-soft",
                )}
              >
                {partsOfDateKey(dayKey).day}
              </button>

              <div className="mt-1 space-y-1">
                {visible.map((appointment) => (
                  <button
                    key={appointment.publicId}
                    type="button"
                    onClick={() => onSelect(appointment)}
                    title={`${formatClinicTime(appointment.startsAt, timezone)} · ${appointment.patient.fullName}`}
                    className="flex w-full items-center gap-1 rounded-md border border-line bg-surface px-1.5 py-1 text-left transition-colors hover:border-primary/40 hover:bg-mint"
                  >
                    <StatusDot status={appointment.status} />
                    <span className="shrink-0 text-[10px] font-semibold text-ink tabular-nums">
                      {formatClinicTime(appointment.startsAt, timezone)}
                    </span>
                    <span className="truncate text-[10px] text-muted">
                      {appointment.patient.fullName.split(" ")[0]}
                    </span>
                  </button>
                ))}
                {hidden > 0 ? (
                  <button
                    type="button"
                    onClick={() => onOpenDay(dayKey)}
                    className="w-full rounded-md px-1.5 py-0.5 text-left text-[10px] font-semibold text-primary hover:underline"
                  >
                    +{hidden} more
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Toolbar navigation (used by AppointmentsView)
 * ------------------------------------------------------------------ */

export function CalendarNavButtons({
  onPrev,
  onNext,
  onToday,
  label,
  compactLabel,
}: {
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  label: string;
  compactLabel?: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={onPrev}
        aria-label="Previous period"
        className="flex size-9 items-center justify-center rounded-xl border border-line bg-white text-ink transition-colors hover:border-primary/40 hover:text-primary"
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
      </button>
      <span className="min-w-[9rem] px-1 text-center text-sm font-semibold text-ink">
        <span className="hidden sm:inline">{label}</span>
        <span className="sm:hidden">{compactLabel ?? label}</span>
      </span>
      <button
        type="button"
        onClick={onNext}
        aria-label="Next period"
        className="flex size-9 items-center justify-center rounded-xl border border-line bg-white text-ink transition-colors hover:border-primary/40 hover:text-primary"
      >
        <ChevronRight aria-hidden="true" className="size-4" />
      </button>
      <button
        type="button"
        onClick={onToday}
        className="ml-1 rounded-xl border border-line bg-white px-3 py-2 text-xs font-semibold text-ink transition-colors hover:border-primary/40 hover:text-primary"
      >
        Today
      </button>
    </div>
  );
}

/** Title for the calendar toolbar of the current view/anchor. */
export function calendarLabel(
  view: Exclude<CalendarView, "list">,
  anchorKey: string,
): { label: string; compact: string } {
  if (view === "day") {
    const label = formatDateKeyLong(anchorKey);
    return { label, compact: label };
  }
  if (view === "week") {
    const start = startOfWeekKey(anchorKey);
    const end = addDaysKey(start, 6);
    const label = formatWeekRangeLabel(start, end);
    return { label, compact: label };
  }
  const { year, month } = partsOfDateKey(anchorKey);
  return { label: monthLabel(year, month), compact: monthLabelShort(year, month) };
}
