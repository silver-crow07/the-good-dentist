import type { Metadata } from "next";

import { AppointmentsView } from "@/components/admin/appointments/AppointmentsView";

export const metadata: Metadata = {
  title: "Appointments",
};

/**
 * /admin/appointments — list + day/week/month calendar over the existing
 * appointment APIs (search, filters, pagination, details, confirm / cancel /
 * complete / no-show / reschedule). Data is fetched client-side from the
 * session-authorized endpoints; this page stays a thin server component.
 */
export default function AdminAppointmentsPage() {
  return <AppointmentsView />;
}
