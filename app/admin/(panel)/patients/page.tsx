import type { Metadata } from "next";

import { PatientsView } from "@/components/admin/patients/PatientsView";
import { getCurrentStaff } from "@/lib/server/session";

export const metadata: Metadata = {
  title: "Patients",
};

/**
 * /admin/patients — patient directory (search, pagination, registration).
 * The session role is resolved SERVER-side here and passed as a prop so the
 * UI can hide ADMIN-only affordances; the API re-checks every action with
 * requireRole() regardless. Fail-closed: a missing session (impossible —
 * the layout redirects first) renders the limited STAFF view.
 */
export default async function AdminPatientsPage() {
  const staff = await getCurrentStaff();
  const role = staff?.role === "ADMIN" ? "ADMIN" : "STAFF";

  return <PatientsView role={role} />;
}
