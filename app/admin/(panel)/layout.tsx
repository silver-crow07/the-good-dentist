import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AdminShell } from "@/components/admin/AdminShell";
import { getCurrentStaff } from "@/lib/server/session";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Guarded admin shell — every page under /admin except /admin/login renders
 * inside this layout.
 *
 * The session is verified SERVER-side here (HMAC signature → database row →
 * expiry → active check, all in lib/server/auth.ts); the client never decides
 * whether it is signed in. Unauthenticated requests are redirected to the
 * login page before any admin data is queried.
 *
 * Route-group note: login lives at app/admin/login (outside `(panel)`), so
 * the guard can never bounce the login page into a redirect loop.
 */
export default async function AdminPanelLayout({
  children,
}: LayoutProps<"/admin">) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/admin/login");

  return (
    <AdminShell staff={{ fullName: staff.fullName, role: staff.role }}>
      {children}
    </AdminShell>
  );
}
