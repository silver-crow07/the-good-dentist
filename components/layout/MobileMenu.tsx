"use client";

import { Clock, MessageCircle, Phone } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { ButtonLink } from "@/components/ui/button";
import {
  BOOK_APPOINTMENT_HREF,
  BOOK_APPOINTMENT_LABEL,
  CLINIC_OPENING_HOURS,
  CLINIC_PHONE_DIAL,
  CLINIC_PHONE_NUMBER,
  NAV_LINKS,
} from "@/lib/constants";
import { cn } from "@/lib/utils";
import { buildBookingMessage, buildWhatsAppUrl } from "@/lib/whatsapp";

const whatsappUrl = buildWhatsAppUrl(buildBookingMessage());

type MobileMenuProps = {
  open: boolean;
  onClose: () => void;
};

export function MobileMenu({ open, onClose }: MobileMenuProps) {
  const pathname = usePathname();

  return (
    <div
      id="mobile-menu"
      className={cn(
        "overflow-hidden border-t border-line bg-surface/95 backdrop-blur-lg transition-[max-height,opacity] duration-300 ease-out lg:hidden",
        open ? "max-h-[36rem] opacity-100" : "max-h-0 opacity-0",
      )}
    >
      <nav aria-label="Mobile" className="container-page pb-6 pt-4">
        <ul className="flex flex-col">
          {NAV_LINKS.map((link, index) => {
            const active =
              link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            return (
              <li
                key={link.href}
                className="border-b border-line-soft last:border-b-0"
                style={{ transitionDelay: open ? `${60 + index * 45}ms` : "0ms" }}
              >
                <Link
                  href={link.href}
                  onClick={onClose}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center justify-between py-3.5 text-base font-medium transition-colors",
                    active ? "text-primary" : "text-ink hover:text-primary",
                  )}
                >
                  {link.label}
                  <span aria-hidden="true" className="text-xs text-muted">
                    0{index + 1}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="mt-5 flex flex-col gap-3">
          <ButtonLink
            href={BOOK_APPOINTMENT_HREF}
            onClick={onClose}
            size="lg"
            className="w-full"
          >
            {BOOK_APPOINTMENT_LABEL}
          </ButtonLink>
          <ButtonLink
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            variant="outline"
            size="lg"
            className="w-full"
          >
            <MessageCircle aria-hidden="true" className="size-4" />
            Book via WhatsApp
          </ButtonLink>
        </div>

        <div className="mt-5 flex flex-col gap-2 border-t border-line-soft pt-4 text-sm text-muted">
          <a
            href={CLINIC_PHONE_DIAL}
            className="flex items-center gap-2 transition-colors hover:text-primary"
          >
            <Phone aria-hidden="true" className="size-4 text-primary" />
            {CLINIC_PHONE_NUMBER}
          </a>
          <p className="flex items-center gap-2">
            <Clock aria-hidden="true" className="size-4 text-primary" />
            {CLINIC_OPENING_HOURS}
          </p>
        </div>
      </nav>
    </div>
  );
}
