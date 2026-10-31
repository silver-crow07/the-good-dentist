import { Clock, Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import Link from "next/link";

import { Logo } from "@/components/layout/Logo";
import { services } from "@/data/services";
import {
  CLINIC_ADDRESS,
  CLINIC_EMAIL,
  CLINIC_EMAIL_LINK,
  CLINIC_NAME,
  CLINIC_OPENING_HOURS,
  CLINIC_PHONE_DIAL,
  CLINIC_PHONE_NUMBER,
  FOOTER_QUICK_LINKS,
} from "@/lib/constants";
import { buildBookingMessage, buildWhatsAppUrl } from "@/lib/whatsapp";

const FOOTER_SERVICE_SLUGS = [
  "general-dentistry",
  "dental-cleaning",
  "root-canal-treatment",
  "dental-implants",
  "cosmetic-dentistry",
];

const footerServices = FOOTER_SERVICE_SLUGS.flatMap((slug) => {
  const service = services.find((entry) => entry.slug === slug);
  return service ? [{ href: `/services/${service.slug}`, label: service.title }] : [];
});

const whatsappUrl = buildWhatsAppUrl(buildBookingMessage());

const contactRows = [
  {
    id: "phone",
    icon: Phone,
    label: "Phone",
    value: CLINIC_PHONE_NUMBER,
    href: CLINIC_PHONE_DIAL,
  },
  {
    id: "whatsapp",
    icon: MessageCircle,
    label: "WhatsApp",
    value: CLINIC_PHONE_NUMBER,
    href: whatsappUrl,
    external: true,
  },
  {
    id: "email",
    icon: Mail,
    label: "Email",
    value: CLINIC_EMAIL,
    href: CLINIC_EMAIL_LINK,
  },
  { id: "address", icon: MapPin, label: "Address", value: CLINIC_ADDRESS },
  {
    id: "hours",
    icon: Clock,
    label: "Opening Hours",
    value: CLINIC_OPENING_HOURS,
  },
];

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-line bg-white">
      <div className="container-page grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-12 lg:gap-8 lg:py-16">
        <div className="lg:col-span-4">
          <Logo />
          <p className="mt-5 max-w-xs text-sm leading-relaxed text-muted">
            Thoughtful dental care in a welcoming environment — focused on your
            long-term oral health.
          </p>
          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            {CLINIC_NAME}
          </p>
        </div>

        <nav aria-label="Quick links" className="lg:col-span-2">
          <h2 className="text-sm font-semibold text-ink">Quick Links</h2>
          <ul className="mt-4 space-y-2.5">
            {FOOTER_QUICK_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="text-sm text-muted transition-colors hover:text-primary"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label="Services" className="lg:col-span-3">
          <h2 className="text-sm font-semibold text-ink">Services</h2>
          <ul className="mt-4 space-y-2.5">
            {footerServices.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="text-sm text-muted transition-colors hover:text-primary"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="lg:col-span-3">
          <h2 className="text-sm font-semibold text-ink">Contact</h2>
          <ul className="mt-4 space-y-3">
            {contactRows.map((row) => {
              const Icon = row.icon;
              const content = (
                <span className="flex items-start gap-2.5">
                  <Icon
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-primary"
                  />
                  <span>
                    <span className="block text-xs uppercase tracking-[0.12em] text-muted">
                      {row.label}
                    </span>
                    <span className="text-sm text-ink transition-colors group-hover:text-primary">
                      {row.value}
                    </span>
                  </span>
                </span>
              );

              return (
                <li key={row.id}>
                  {"href" in row && row.href ? (
                    <a
                      href={row.href}
                      target={"external" in row ? "_blank" : undefined}
                      rel={"external" in row ? "noopener noreferrer" : undefined}
                      className="group inline-block transition-colors hover:text-primary"
                    >
                      {content}
                    </a>
                  ) : (
                    <span className="inline-block">{content}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <div className="border-t border-line-soft">
        <div className="container-page flex flex-col gap-3 pb-24 pt-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:pb-6">
          <p>
            © {year} {CLINIC_NAME}. All rights reserved.
          </p>
          <div className="flex items-center gap-5">
            <Link href="/privacy" className="transition-colors hover:text-primary">
              Privacy Policy
            </Link>
            <Link href="/terms" className="transition-colors hover:text-primary">
              Terms
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
