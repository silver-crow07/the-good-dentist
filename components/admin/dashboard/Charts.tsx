import type { AppointmentStatusKey } from "@/lib/client/admin";
import { weekdayShortOfDateKey } from "@/lib/client/format";

/**
 * Hand-rolled SVG/CSS charts for the dashboard — no chart library, so the
 * admin panel adds zero new dependencies. Both charts expose their numbers as
 * text (counts are also present in the stat cards and tables), keeping them
 * readable to screen readers.
 */

/* ------------------------------------------------------------------ *
 * Status distribution donut
 * ------------------------------------------------------------------ */

const SEGMENTS: Array<{ key: AppointmentStatusKey; label: string; color: string }> = [
  { key: "PENDING", label: "Pending", color: "#d97706" },
  { key: "CONFIRMED", label: "Confirmed", color: "#5f7327" },
  { key: "COMPLETED", label: "Completed", color: "#171914" },
  { key: "CANCELLED", label: "Cancelled", color: "#78716c" },
  { key: "NO_SHOW", label: "No-show", color: "#be123c" },
];

const RADIUS = 64;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function StatusDonut({ byStatus }: { byStatus: Record<AppointmentStatusKey, number> }) {
  const total = SEGMENTS.reduce((sum, segment) => sum + (byStatus[segment.key] ?? 0), 0);

  // Prefix-sum offsets computed purely (no render-time mutation).
  const arcs = SEGMENTS.map((segment, index) => {
    const count = byStatus[segment.key] ?? 0;
    const length = total > 0 ? (count / total) * CIRCUMFERENCE : 0;
    const offset = SEGMENTS.slice(0, index).reduce((sum, previous) => {
      const previousCount = byStatus[previous.key] ?? 0;
      return sum + (total > 0 ? (previousCount / total) * CIRCUMFERENCE : 0);
    }, 0);
    return { ...segment, count, length, offset };
  });

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
      <div className="relative shrink-0">
        <svg viewBox="0 0 160 160" className="size-40" role="img" aria-label="Appointments by status">
          <circle
            cx="80"
            cy="80"
            r={RADIUS}
            fill="none"
            stroke="#eef1e5"
            strokeWidth="20"
          />
          {total > 0
            ? arcs
                .filter((arc) => arc.length > 0)
                .map((arc) => (
                  <circle
                    key={arc.key}
                    cx="80"
                    cy="80"
                    r={RADIUS}
                    fill="none"
                    stroke={arc.color}
                    strokeWidth="20"
                    strokeDasharray={`${arc.length} ${CIRCUMFERENCE - arc.length}`}
                    strokeDashoffset={-arc.offset}
                    transform="rotate(-90 80 80)"
                  />
                ))
            : null}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold text-ink tabular-nums">{total}</span>
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
            total
          </span>
        </div>
      </div>

      <ul className="w-full space-y-2.5">
        {arcs.map((arc) => (
          <li key={arc.key} className="flex items-center gap-2.5 text-sm">
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: arc.color }}
            />
            <span className="text-ink/80">{arc.label}</span>
            <span className="ml-auto font-semibold text-ink tabular-nums">{arc.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Next-7-days bar chart
 * ------------------------------------------------------------------ */

export function WeekBars({ week }: { week: Array<{ date: string; count: number }> }) {
  const max = Math.max(1, ...week.map((day) => day.count));
  const hasAny = week.some((day) => day.count > 0);

  return (
    <div>
      <div className="flex h-40 items-end gap-2 sm:gap-3">
        {week.map((day) => (
          <div key={day.date} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
            <span
              className="text-xs font-semibold text-ink tabular-nums"
              aria-hidden={day.count === 0}
            >
              {day.count > 0 ? day.count : ""}
            </span>
            <div
              className="w-full rounded-t-md transition-all"
              style={{
                height: day.count > 0 ? `${Math.max(8, (day.count / max) * 100)}%` : "4px",
                backgroundColor: day.count > 0 ? "#5f7327" : "#eef1e5",
              }}
              title={`${day.count} appointment${day.count === 1 ? "" : "s"}`}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2 border-t border-line pt-2 sm:gap-3">
        {week.map((day) => (
          <div key={day.date} className="min-w-0 flex-1 text-center">
            <span className="block truncate text-xs font-medium text-muted">
              {weekdayShortOfDateKey(day.date)}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">
        {hasAny
          ? "Confirmed and pending appointments starting each day (clinic time)."
          : "No appointments scheduled for the next 7 days."}
      </p>
    </div>
  );
}
