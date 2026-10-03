"use client";

import { Menu, MessageCircle, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Logo } from "@/components/layout/Logo";
import { MobileMenu } from "@/components/layout/MobileMenu";
import { ButtonLink } from "@/components/ui/button";
import {
  BOOK_APPOINTMENT_HREF,
  BOOK_APPOINTMENT_LABEL,
  NAV_LINKS,
} from "@/lib/constants";
import { cn } from "@/lib/utils";
import { buildBookingMessage, buildWhatsAppUrl } from "@/lib/whatsapp";

const whatsappUrl = buildWhatsAppUrl(buildBookingMessage());

export function Navbar() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [lastPathname, setLastPathname] = useState(pathname);

  // Close the mobile menu whenever the route changes (adjust-state-in-render).
  if (lastPathname !== pathname) {
    setLastPathname(pathname);
    setMenuOpen(false);
  }

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 border-b transition-all duration-300",
        scrolled || menuOpen
          ? "border-line bg-surface/85 shadow-sm backdrop-blur-lg"
          : "border-transparent bg-surface/60 backdrop-blur-md",
      )}
    >
      <div className="container-page flex h-16 items-center justify-between gap-4 md:h-20">
        <Logo />

        <nav
          aria-label="Primary"
          className="hidden items-center gap-1 lg:flex"
        >
          {NAV_LINKS.map((link) => {
            const active =
              link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-full px-3.5 py-2 text-sm font-medium transition-colors duration-200",
                  active
                    ? "text-primary"
                    : "text-ink/75 hover:bg-mint hover:text-primary",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          <ButtonLink
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            variant="outline"
            size="icon"
            aria-label="Book via WhatsApp (opens in a new tab)"
          >
            <MessageCircle aria-hidden="true" className="size-[1.15rem]" />
          </ButtonLink>
          <ButtonLink href={BOOK_APPOINTMENT_HREF} size="md">
            {BOOK_APPOINTMENT_LABEL}
          </ButtonLink>
        </div>

        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          className="flex size-11 items-center justify-center rounded-xl border border-line bg-white text-ink transition-colors hover:border-primary/40 hover:text-primary lg:hidden"
        >
          {menuOpen ? (
            <X aria-hidden="true" className="size-5" />
          ) : (
            <Menu aria-hidden="true" className="size-5" />
          )}
        </button>
      </div>

      <MobileMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
    </header>
  );
}
