"use client";

/**
 * Admin panel shell — responsive sidebar navigation + top bar.
 *
 * Rendered by the guarded panel layout (app/admin/(panel)/layout.tsx), which
 * has already verified the session server-side; this component only handles
 * presentation and navigation. Only `fullName` and `role` ever reach the
 * client — no ids, no credentials, no other accounts' data.
 *
 * Nav items marked with a `phase` are roadmap placeholders (Phase A build);
 * they become real links when their module ships.
 */

import {
  CalendarDays,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  Package,
  Settings,
  Stethoscope,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { LOGO_SQUARE_SRC } from "@/components/layout/Logo";
import { logoutStaff, type AdminStaff } from "@/lib/client/admin";
import { initialsOf } from "@/lib/client/format";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** Exact-match active state (dashboard is "/admin"). */
  exact?: boolean;
  /** Roadmap placeholder until this module ships. */
  phase?: string;
  /** Hidden entirely for STAFF sessions (the API re-checks anyway). */
  adminOnly?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/admin/appointments", label: "Appointments", icon: CalendarDays },
  { href: "/admin/patients", label: "Patients", icon: Users },
  { href: "/admin/dental-records", label: "Dental Records", icon: Stethoscope, adminOnly: true },
  { href: "/admin/inventory", label: "Inventory", icon: Package, phase: "Phase E" },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

function isActive(pathname: string, item: NavItem): boolean {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}

type NavContentProps = {
  staff: AdminStaff;
  pathname: string;
  onLogout: () => void;
  loggingOut: boolean;
};

function NavContent({ staff, pathname, onLogout, loggingOut }: NavContentProps) {
  return (
    <>
      <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
        <span className="rounded-lg bg-white p-1.5 shadow-soft">
          {/* eslint-disable-next-line @next/next/no-img-element -- brand SVG; see Logo.tsx */}
          <img
            src={LOGO_SQUARE_SRC}
            alt=""
            aria-hidden="true"
            className="size-8 object-contain"
          />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">The Good Dentist</p>
          <p className="truncate text-xs text-white/55">Rooted in care.</p>
        </div>
      </div>

      <nav aria-label="Admin" className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item);
          const Icon = item.icon;

          // Phase D is ADMIN-only: STAFF never sees the entry (the API
          // still answers 403 if the URL is typed directly).
          if (item.adminOnly && staff.role !== "ADMIN") return null;

          if (item.phase) {
            return (
              <span
                key={item.href}
                aria-disabled="true"
                className={cn(
                  "flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium",
                  "text-white/35",
                )}
              >
                <Icon aria-hidden="true" className="size-[1.15rem] shrink-0" />
                <span className="truncate">{item.label}</span>
                <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white/45">
                  {item.phase}
                </span>
              </span>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-150",
                active
                  ? "bg-primary text-white shadow-soft"
                  : "text-white/70 hover:bg-white/10 hover:text-white",
              )}
            >
              <Icon aria-hidden="true" className="size-[1.15rem] shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-white/10 px-4 py-4">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-primary-deep"
          >
            {initialsOf(staff.fullName)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">{staff.fullName}</p>
            <p className="text-xs text-white/55">
              {staff.role === "ADMIN" ? "Administrator" : "Staff"}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onLogout}
          disabled={loggingOut}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-white/20 px-3 py-2 text-sm font-medium text-white/80 transition-colors hover:border-white/40 hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-60"
        >
          {loggingOut ? (
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <LogOut aria-hidden="true" className="size-4" />
          )}
          Sign out
        </button>
      </div>
    </>
  );
}

type AdminShellProps = {
  staff: AdminStaff;
  children: ReactNode;
};

export function AdminShell({ staff, children }: AdminShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  // Close the mobile drawer on navigation (adjust-state-in-render).
  const [lastPathname, setLastPathname] = useState(pathname);
  if (lastPathname !== pathname) {
    setLastPathname(pathname);
    setMobileOpen(false);
  }

  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileOpen]);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logoutStaff();
    } catch {
      // Best effort — navigation below still runs; the guard will re-check.
    }
    router.replace("/admin/login");
    router.refresh();
  }

  const currentLabel =
    NAV_ITEMS.find((item) => isActive(pathname, item))?.label ?? "Dashboard";

  return (
    <div className="flex min-h-screen bg-surface">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-ink lg:flex">
        <NavContent
          staff={staff}
          pathname={pathname}
          onLogout={handleLogout}
          loggingOut={loggingOut}
        />
      </aside>

      {/* Mobile slide-over */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 bg-ink/50 backdrop-blur-sm"
          />
          <aside
            id="admin-mobile-nav"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-ink shadow-lift"
          >
            <NavContent
              staff={staff}
              pathname={pathname}
              onLogout={handleLogout}
              loggingOut={loggingOut}
            />
          </aside>
        </div>
      ) : null}

      {/* Content column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center gap-3 border-b border-line bg-surface/90 px-4 backdrop-blur lg:px-8">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-expanded={mobileOpen}
            aria-controls="admin-mobile-nav"
            aria-label="Open navigation"
            className="flex size-10 items-center justify-center rounded-xl border border-line bg-white text-ink transition-colors hover:border-primary/40 hover:text-primary lg:hidden"
          >
            <Menu aria-hidden="true" className="size-5" />
          </button>

          <h1 className="truncate text-sm font-semibold uppercase tracking-[0.14em] text-muted lg:text-base lg:normal-case lg:tracking-tight lg:text-ink">
            {currentLabel}
          </h1>

          <div className="ml-auto flex items-center gap-2.5">
            <span className="hidden rounded-full bg-mint px-3 py-1 text-xs font-semibold text-primary sm:inline">
              {staff.role === "ADMIN" ? "Administrator" : "Staff"}
            </span>
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              aria-label="Sign out"
              className="flex size-10 items-center justify-center rounded-xl border border-line bg-white text-ink transition-colors hover:border-red-300 hover:text-red-600 disabled:pointer-events-none disabled:opacity-60"
            >
              {loggingOut ? (
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <LogOut aria-hidden="true" className="size-4" />
              )}
            </button>
          </div>
        </header>

        <div className="flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</div>
      </div>
    </div>
  );
}
