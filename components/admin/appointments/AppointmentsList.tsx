import { CalendarOff, ChevronRight, Eye, Phone } from "lucide-react";

import { StatusBadge } from "@/components/admin/StatusBadge";
import { Button } from "@/components/ui/button";
import type { AdminAppointment, AdminAppointmentsResult } from "@/lib/client/admin";
import { formatClinicDateTime, formatClinicTime } from "@/lib/client/format";

/**
 * Appointment table for the List and Day views (the Day view reuses it with
 * `timeOnly`, since every row is the same clinic-local day). Pagination
 * footer renders only when the server returned a `pagination` block.
 */

type AppointmentsListProps = {
  result: AdminAppointmentsResult;
  timezone: string;
  /** Day view: show only the wall-clock time instead of date + time. */
  timeOnly?: boolean;
  onSelect: (appointment: AdminAppointment) => void;
  /** Pagination controls (List view only). */
  onPage?: (page: number) => void;
  emptyTitle?: string;
  emptyHint?: string;
};

export function AppointmentsList({
  result,
  timezone,
  timeOnly = false,
  onSelect,
  onPage,
  emptyTitle = "No appointments found",
  emptyHint = "Try adjusting the filters or the search term.",
}: AppointmentsListProps) {
  const { appointments, pagination } = result;

  if (appointments.length === 0) {
    return (
      <section className="flex flex-col rounded-2xl border border-line bg-card shadow-soft">
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
          <CalendarOff aria-hidden="true" className="size-9 text-muted/60" />
          <p className="text-sm font-medium text-ink">{emptyTitle}</p>
          <p className="max-w-sm text-sm leading-relaxed text-muted">{emptyHint}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col rounded-2xl border border-line bg-card shadow-soft">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
              <th scope="col" className="px-5 py-3 font-semibold">When</th>
              <th scope="col" className="px-5 py-3 font-semibold">Patient</th>
              <th scope="col" className="px-5 py-3 font-semibold">Contact</th>
              <th scope="col" className="px-5 py-3 font-semibold">Treatment</th>
              <th scope="col" className="px-5 py-3 font-semibold">Status</th>
              <th scope="col" className="px-5 py-3 text-right font-semibold">
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {appointments.map((appointment) => (
              <tr
                key={appointment.publicId}
                onClick={() => onSelect(appointment)}
                className="cursor-pointer transition-colors hover:bg-mint/50"
              >
                <td className="whitespace-nowrap px-5 py-3.5 text-ink">
                  {timeOnly
                    ? formatClinicTime(appointment.startsAt, timezone)
                    : formatClinicDateTime(appointment.startsAt, timezone)}
                </td>
                <td className="px-5 py-3.5">
                  <span className="block font-medium text-ink">
                    {appointment.patient.fullName}
                  </span>
                  <span className="block text-xs text-muted">{appointment.doctor.name}</span>
                </td>
                <td className="whitespace-nowrap px-5 py-3.5">
                  <a
                    href={`tel:${appointment.patient.phone.replace(/[^\d+]/g, "")}`}
                    onClick={(event) => event.stopPropagation()}
                    className="inline-flex items-center gap-1.5 text-ink/80 transition-colors hover:text-primary"
                  >
                    <Phone aria-hidden="true" className="size-3.5" />
                    {appointment.patient.phone}
                  </a>
                </td>
                <td className="px-5 py-3.5 text-ink/80">
                  {appointment.service.name}
                  <span className="block text-xs text-muted">{appointment.doctor.name}</span>
                </td>
                <td className="px-5 py-3.5">
                  <StatusBadge status={appointment.status} />
                </td>
                <td className="px-5 py-3.5 text-right">
                  <button
                    type="button"
                    aria-label={`View appointment for ${appointment.patient.fullName}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(appointment);
                    }}
                    className="inline-flex items-center gap-1 rounded-full border border-line bg-white px-3 py-1 text-xs font-medium text-ink transition-colors hover:border-primary/40 hover:text-primary"
                  >
                    <Eye aria-hidden="true" className="size-3.5" />
                    View
                    <ChevronRight aria-hidden="true" className="size-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pagination ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3.5">
          <p className="text-xs text-muted">
            <span className="font-semibold text-ink tabular-nums">{pagination.total}</span>{" "}
            appointment{pagination.total === 1 ? "" : "s"} · page{" "}
            <span className="font-semibold text-ink tabular-nums">{pagination.page}</span> of{" "}
            <span className="font-semibold text-ink tabular-nums">{pagination.totalPages}</span>
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page <= 1}
              onClick={() => onPage?.(pagination.page - 1)}
              aria-label="Previous page"
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => onPage?.(pagination.page + 1)}
              aria-label="Next page"
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** Loading placeholder for the table view. */
export function AppointmentsListSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite" className="animate-pulse rounded-2xl border border-line bg-card p-5 shadow-soft">
      <span className="sr-only">Loading appointments…</span>
      <div className="space-y-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-4">
            <div className="h-4 w-28 rounded bg-line-soft" />
            <div className="h-4 w-40 rounded bg-line-soft" />
            <div className="h-4 w-32 rounded bg-line-soft" />
            <div className="ml-auto h-6 w-20 rounded-full bg-line-soft" />
          </div>
        ))}
      </div>
    </div>
  );
}
