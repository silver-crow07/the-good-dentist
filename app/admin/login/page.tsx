import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/admin/LoginForm";
import { getCurrentStaff } from "@/lib/server/session";

export const metadata: Metadata = {
  title: "Staff sign in",
  robots: { index: false, follow: false },
};

/**
 * /admin/login — the ONLY sign-in entry point. Reuses the existing session
 * system; already-authenticated staff are sent straight to the dashboard.
 */
export default async function AdminLoginPage() {
  const staff = await getCurrentStaff();
  if (staff) redirect("/admin");

  return (
    <div className="flex min-h-[75vh] items-center justify-center px-4 py-12 sm:py-16">
      <LoginForm />
    </div>
  );
}
