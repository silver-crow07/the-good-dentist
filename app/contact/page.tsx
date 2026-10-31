import type { Metadata } from "next";
import { Clock, Mail, MapPin, MessageCircle, Navigation, Phone, User } from "lucide-react";
import Image from "next/image";

import { CTASection } from "@/components/home/CTASection";
import { FAQ } from "@/components/home/FAQ";
import { PageHero } from "@/components/shared/PageHero";
import { Reveal } from "@/components/shared/Reveal";
import { ButtonLink } from "@/components/ui/button";
import {
  CLINIC_ADDRESS,
  CLINIC_CONTACT_PERSON,
  CLINIC_DIRECTIONS_URL,
  CLINIC_EMAIL,
  CLINIC_EMAIL_LINK,
  CLINIC_HOURS_SCHEDULE,
  CLINIC_PHONE_DIAL,
  CLINIC_PHONE_NUMBER,
} from "@/lib/constants";
import { buildBookingMessage, buildWhatsAppUrl } from "@/lib/whatsapp";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Contact The Good Dentist — phone, WhatsApp, email, clinic address and opening hours (Mon–Sat, closed Sunday).",
  alternates: { canonical: "/contact" },
};

const whatsappUrl = buildWhatsAppUrl(buildBookingMessage());

type ContactChannel = {
  id: string;
  icon: typeof Phone;
  label: string;
  value: string;
  href?: string;
  external?: boolean;
  action?: string;
  /** Extra lines (e.g. the lunch break and Sunday rows of the schedule). */
  lines?: string[];
};

const channels: ContactChannel[] = [
  {
    id: "phone",
    icon: Phone,
    label: "Phone",
    value: CLINIC_PHONE_NUMBER,
    href: CLINIC_PHONE_DIAL,
    action: "Call the clinic",
  },
  {
    id: "whatsapp",
    icon: MessageCircle,
    label: "WhatsApp",
    value: CLINIC_PHONE_NUMBER,
    href: whatsappUrl,
    action: "Message on WhatsApp",
    external: true,
  },
  {
    id: "email",
    icon: Mail,
    label: "Email",
    value: CLINIC_EMAIL,
    href: CLINIC_EMAIL_LINK,
    action: "Send an email",
  },
  {
    id: "contact-person",
    icon: User,
    label: "Contact Person",
    value: CLINIC_CONTACT_PERSON,
  },
  {
    id: "address",
    icon: MapPin,
    label: "Address",
    value: CLINIC_ADDRESS,
    action: "Get directions",
    href: CLINIC_DIRECTIONS_URL,
    external: true,
  },
  {
    id: "hours",
    icon: Clock,
    label: "Opening Hours",
    value: CLINIC_HOURS_SCHEDULE[0],
    lines: [...CLINIC_HOURS_SCHEDULE.slice(1)],
  },
];

export default function ContactPage() {
  return (
    <>
      <PageHero
        eyebrow="Contact"
        title="Visit The Good Dentist."
        description="Questions about treatment, timing or availability? Reach the clinic directly — we reply during opening hours."
      />

      <section aria-label="Contact options" className="section-pad bg-surface">
        <div className="container-page grid items-start gap-10 lg:grid-cols-2 lg:gap-14">
          <Reveal>
            <div className="grid gap-4 sm:grid-cols-2">
              {channels.map((channel) => {
                const Icon = channel.icon;
                const body = (
                  <span className="flex h-full flex-col gap-3 rounded-2xl border border-line bg-white p-5 transition duration-300 hover:border-primary/30 hover:shadow-soft">
                    <span className="flex size-10 items-center justify-center rounded-xl bg-mint text-primary">
                      <Icon aria-hidden="true" className="size-5" />
                    </span>
                    <span className="block">
                      <span className="block text-xs uppercase tracking-[0.14em] text-muted">
                        {channel.label}
                      </span>
                      <span className="mt-1 block text-sm font-semibold text-ink">
                        {channel.value}
                      </span>
                      {channel.lines?.map((line) => (
                        <span
                          key={line}
                          className="mt-1 block text-sm text-muted"
                        >
                          {line}
                        </span>
                      ))}
                    </span>
                    {channel.action ? (
                      <span className="mt-auto text-xs font-medium text-primary">
                        {channel.action}
                      </span>
                    ) : null}
                  </span>
                );

                return (
                  <div key={channel.id}>
                    {channel.href ? (
                      <a
                        href={channel.href}
                        target={channel.external ? "_blank" : undefined}
                        rel={channel.external ? "noopener noreferrer" : undefined}
                        className="block h-full"
                      >
                        {body}
                      </a>
                    ) : (
                      body
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <ButtonLink href={CLINIC_PHONE_DIAL} size="lg">
                <Phone aria-hidden="true" className="size-4" />
                Call the Clinic
              </ButtonLink>
              <ButtonLink
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                variant="outline"
                size="lg"
              >
                <MessageCircle aria-hidden="true" className="size-4" />
                Book via WhatsApp
              </ButtonLink>
            </div>
          </Reveal>

          <Reveal delay={120}>
            <div className="overflow-hidden rounded-[1.75rem] border border-line bg-white shadow-soft">
              <div className="relative aspect-[4/3] w-full bg-mint">
                <Image
                  src="/images/map-placeholder.svg"
                  alt="Illustrative map placeholder for The Good Dentist, Kumbalgodu, Bengaluru"
                  width={800}
                  height={560}
                  sizes="(min-width: 1024px) 46vw, 100vw"
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                <div>
                  <p className="text-sm font-semibold text-ink">{CLINIC_ADDRESS}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    Open the location on Google Maps for the live view and directions.
                  </p>
                </div>
                <ButtonLink
                  href={CLINIC_DIRECTIONS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="outline"
                  size="sm"
                >
                  <Navigation aria-hidden="true" className="size-4" />
                  Get Directions
                </ButtonLink>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <FAQ />
      <CTASection />
    </>
  );
}
