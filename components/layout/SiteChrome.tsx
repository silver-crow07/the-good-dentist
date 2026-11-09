"use client";

/**
 * Conditional wrapper for the public site chrome (Navbar, Footer, floating
 * WhatsApp button, structured data).
 *
 * The root layout is shared by the marketing site and the admin panel
 * (Option C — see the Phase 3 plan). On admin routes this component renders
 * nothing, so the admin shell owns the full viewport; on every public route
 * it renders its children unchanged.
 *
 * `usePathname` is resolved during SSR as well, so there is no flash of the
 * public header on admin pages.
 */

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { isAdminPath } from "@/lib/admin-path";

export function SiteChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // No pathname (defensive): show the site chrome rather than risk a blank page.
  if (pathname !== null && isAdminPath(pathname)) return null;
  return <>{children}</>;
}
