import type { AppointmentStatusKey } from "@/lib/client/admin";
import { cn } from "@/lib/utils";

/**
 * Appointment status pill — the single place status colours/labels are
 * defined, so list, calendar, detail and dashboard views always agree.
 */

const STATUS_STYLE: Record<AppointmentStatusKey, { label: string; className: string }> = {
  PENDING: {
    label: "Pending",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  CONFIRMED: {
    label: "Confirmed",
    className: "border-primary/25 bg-mint text-primary",
  },
  CANCELLED: {
    label: "Cancelled",
    className: "border-red-200 bg-red-50 text-red-700",
  },
  COMPLETED: {
    label: "Completed",
    className: "border-line bg-line-soft text-ink/70",
  },
  NO_SHOW: {
    label: "No-show",
    className: "border-orange-200 bg-orange-50 text-orange-700",
  },
};

export function StatusBadge({
  status,
  className,
}: {
  status: AppointmentStatusKey;
  className?: string;
}) {
  const style = STATUS_STYLE[status];
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        style.className,
        className,
      )}
    >
      {style.label}
    </span>
  );
}

export { STATUS_STYLE };
