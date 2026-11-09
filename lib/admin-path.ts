/**
 * Single source of truth for "is this route part of the admin panel?".
 *
 * Used by the conditional site chrome (components/layout/SiteChrome.tsx) to
 * hide the public Navbar/Footer/WhatsApp button on admin routes. Kept as a
 * pure function in lib/ (not components/) so it can be unit-tested without
 * rendering React.
 *
 * Matches `/admin` and `/admin/…` only — `/adminfoo` is NOT an admin route.
 */
export function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}
