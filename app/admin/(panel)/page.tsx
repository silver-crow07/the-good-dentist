import type { Metadata } from "next";

import { DashboardView } from "@/components/admin/dashboard/DashboardView";

export const metadata: Metadata = {
  title: "Dashboard",
};

/**
 * /admin — dashboard. Data is fetched client-side from GET /api/admin/stats
 * (session-authorized) so loading, error and retry states are explicit; the
 * page itself stays a thin server component.
 */
export default function AdminDashboardPage() {
  return <DashboardView />;
}
