import type { Metadata } from "next";

import { PatientProfileView } from "@/components/admin/patients/PatientProfileView";
import { getCurrentStaff } from "@/lib/server/session";

export const metadata: Metadata = {
  title: "Patient profile",
};

/**
 * /admin/patients/[id] — complete patient profile: identity, appointment
 * history, treatment history and (ADMIN) clinical notes. The role prop only
 * drives UI affordances; the profile API applies the same rule server-side
 * (STAFF responses contain `clinicalNotes: null`, never note content).
 */
export default async function AdminPatientProfilePage({
  params,
}: PageProps<"/admin/patients/[id]">) {
  const { id } = await params;
  const staff = await getCurrentStaff();
  const role = staff?.role === "ADMIN" ? "ADMIN" : "STAFF";

  return <PatientProfileView patientId={id} role={role} />;
}
