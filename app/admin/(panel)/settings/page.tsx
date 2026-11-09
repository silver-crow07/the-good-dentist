import type { Metadata } from "next";

import { SettingsView } from "@/components/admin/SettingsView";

export const metadata: Metadata = {
  title: "Settings",
};

/**
 * /admin/settings — READ-ONLY view of the signed-in staff profile and the
 * database-owned clinic schedule (hours, slot interval, booking policy).
 */
export default function AdminSettingsPage() {
  return <SettingsView />;
}
