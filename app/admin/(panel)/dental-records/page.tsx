import type { Metadata } from "next";

import { DentalRecordsView } from "@/components/admin/dental-records/DentalRecordsView";
import { getCurrentStaff } from "@/lib/server/session";

export const metadata: Metadata = {
  title: "Dental Records",
};

/**
 * /admin/dental-records — chronological dental-record history (Phase D).
 * ADMIN only: the nav entry is hidden for STAFF and the API re-checks with
 * requireRole() on every request. The role prop only drives UI affordances.
 */
export default async function AdminDentalRecordsPage() {
  const staff = await getCurrentStaff();
  const role = staff?.role === "ADMIN" ? "ADMIN" : "STAFF";

  return <DentalRecordsView role={role} />;
}
