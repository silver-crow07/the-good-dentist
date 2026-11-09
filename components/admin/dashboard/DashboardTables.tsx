import {
  CalendarDays,
  CalendarOff,
  CircleUser,
  FileText,
  Package,
  Stethoscope,
  Users,
} from "lucide-react";

import { StatusBadge } from "@/components/admin/StatusBadge";
import type { AdminStats } from "@/lib/client/admin";
import { formatActivityAction, formatClinicDateTime, formatRelativeTime } from "@/lib/client/format";

/**
 * Dashboard tables: upcoming appointments (left) and the recent audit-trail
 * activity feed (right). Both render explicit empty states.
 */

export function UpcomingTable({
  upcoming,
  timezone,
}: {
  upcoming: AdminStats["upcoming"];
  timezone: string;
}) {
  return (
    <section className="flex flex-col rounded-2xl border border-line bg-card shadow-soft">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
        <h2 className="text-sm font-semibold text-ink">Upcoming appointments</h2>
        <span className="rounded-full bg-mint px-2.5 py-0.5 text-xs font-semibold text-primary tabular-nums">
          {upcoming.length}
        </span>
      </div>

      {upcoming.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
          <CalendarOff aria-hidden="true" className="size-8 text-muted/60" />
          <p className="text-sm font-medium text-ink">Nothing scheduled yet</p>
          <p className="max-w-xs text-xs leading-relaxed text-muted">
            New booking requests and confirmed appointments will appear here.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                <th scope="col" className="px-5 py-3 font-semibold">When</th>
                <th scope="col" className="px-5 py-3 font-semibold">Patient</th>
                <th scope="col" className="px-5 py-3 font-semibold">Contact</th>
                <th scope="col" className="px-5 py-3 font-semibold">Treatment</th>
                <th scope="col" className="px-5 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {upcoming.map((appointment) => (
                <tr key={appointment.publicId} className="transition-colors hover:bg-mint/50">
                  <td className="whitespace-nowrap px-5 py-3.5 text-ink">
                    {formatClinicDateTime(appointment.startsAt, timezone)}
                  </td>
                  <td className="px-5 py-3.5 font-medium text-ink">
                    {appointment.patient.fullName}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3.5">
                    <a
                      href={`tel:${appointment.patient.phone.replace(/[^\d+]/g, "")}`}
                      className="text-ink/80 transition-colors hover:text-primary"
                    >
                      {appointment.patient.phone}
                    </a>
                  </td>
                  <td className="px-5 py-3.5 text-ink/80">
                    {appointment.service}
                    <span className="block text-xs text-muted">{appointment.doctor}</span>
                  </td>
                  <td className="px-5 py-3.5">
                    <StatusBadge status={appointment.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const ENTITY_ICON = {
  appointment: CalendarDays,
  patient: Users,
  staff: CircleUser,
  inventory: Package,
  dentalRecord: Stethoscope,
  dentalRecordFile: Stethoscope,
} as const;

export function ActivityFeed({ entries }: { entries: AdminStats["recentActivity"] }) {
  return (
    <section className="flex flex-col rounded-2xl border border-line bg-card shadow-soft">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
        <h2 className="text-sm font-semibold text-ink">Recent activity</h2>
        <span className="text-xs text-muted">Audit trail</span>
      </div>

      {entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
          <FileText aria-hidden="true" className="size-8 text-muted/60" />
          <p className="text-sm font-medium text-ink">No activity yet</p>
          <p className="max-w-xs text-xs leading-relaxed text-muted">
            Sign-ins, status changes and staff actions are recorded here.
          </p>
        </div>
      ) : (
        <ul className="max-h-[26rem] flex-1 divide-y divide-line-soft overflow-y-auto px-5">
          {entries.map((entry) => {
            const Icon = ENTITY_ICON[entry.entityType as keyof typeof ENTITY_ICON] ?? FileText;
            return (
              <li key={entry.id} className="flex items-start gap-3 py-3.5">
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-mint text-primary"
                >
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink">{formatActivityAction(entry.action)}</p>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {entry.staffName ?? "System"}
                    {" · "}
                    {formatRelativeTime(entry.createdAt)}
                    {entry.entityId ? (
                      <span className="ml-1.5 font-mono text-[11px] text-muted/70">
                        {entry.entityId}
                      </span>
                    ) : null}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
