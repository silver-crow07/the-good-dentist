import type { Metadata } from "next";

import { DentalRecordDetailView } from "@/components/admin/dental-records/DentalRecordDetailView";
import { getCurrentStaff } from "@/lib/server/session";

export const metadata: Metadata = {
  title: "Dental record",
};

/**
 * /admin/dental-records/[id] — one record: diagnosis, treatment details,
 * notes and its private image files (Phase D). ADMIN only — the API
 * re-checks the role server-side on every action.
 */
export default async function AdminDentalRecordPage({
  params,
}: PageProps<"/admin/dental-records/[id]">) {
  const { id } = await params;
  const staff = await getCurrentStaff();
  const role = staff?.role === "ADMIN" ? "ADMIN" : "STAFF";

  return <DentalRecordDetailView recordId={id} role={role} />;
}
