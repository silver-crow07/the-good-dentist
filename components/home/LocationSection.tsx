import { Clock, Mail, MapPin, MessageCircle, Navigation, Phone } from "lucide-react";
import Image from "next/image";

import { Reveal } from "@/components/shared/Reveal";
import { SectionHeading } from "@/components/shared/SectionHeading";
import { ButtonLink } from "@/components/ui/button";
import {
  CLINIC_ADDRESS,
  CLINIC_DIRECTIONS_URL,
  CLINIC_EMAIL,
  CLINIC_EMAIL_LINK,
  CLINIC_OPENING_HOURS,
  CLINIC_PHONE_DIAL,
  CLINIC_PHONE_NUMBER,
} from "@/lib/constants";
import { buildBookingMessage, buildWhatsAppUrl } from "@/lib/whatsapp";

type LocationDetail = {
  id: string;
  icon: typeof MapPin;
  label: string;
  value: string;
  href?: string;
  external?: boolean;
};

const details: LocationDetail[] = [
  {
    id: "address",
    icon: MapPin,
    label: "Address",
    value: CLINIC_ADDRESS,
  },
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
    href: buildWhatsAppUrl(buildBookingMessage()),
    external: true,
  },
  {
    id: "email",
    icon: Mail,
    label: "Email",
    value: CLINIC_EMAIL,
    href: CLINIC_EMAIL_LINK,
  },
  {
    id: "hours",
    icon: Clock,
    label: "Opening Hours",
    value: CLINIC_OPENING_HOURS,
  },
];

export function LocationSection() {
  return (
    <section
      id="visit"
      aria-labelledby="visit-heading"
      className="section-pad border-t border-line bg-white"
    >
      <div className="container-page grid gap-10 lg:grid-cols-2 lg:gap-16">
        <Reveal>
          <SectionHeading
            id="visit-heading"
            eyebrow="Visit Us"
            title="Visit The Good Dentist."
            description="Find us, reach us, or plan your visit — everything you need in one place."
          />

          <dl className="mt-8 grid gap-x-8 gap-y-6 sm:grid-cols-2">
            {details.map((detail) => {
              const Icon = detail.icon;
              const hasLink = Boolean(detail.href);

              return (
                <div key={detail.id}>
                  <dt className="flex items-center gap-3 text-xs uppercase tracking-[0.14em] text-muted">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-mint text-primary">
                      <Icon aria-hidden="true" className="size-4" />
                    </span>
                    {detail.label}
                  </dt>
                  <dd className="mt-2 pl-12 text-sm font-medium text-ink">
                    {hasLink ? (
                      <a
                        href={detail.href}
                        target={detail.external ? "_blank" : undefined}
                        rel={detail.external ? "noopener noreferrer" : undefined}
                        className="transition-colors hover:text-primary"
                      >
                        {detail.value}
                      </a>
                    ) : (
                      detail.value
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <ButtonLink
              href={CLINIC_DIRECTIONS_URL}
              target="_blank"
              rel="noopener noreferrer"
              size="lg"
            >
              <Navigation aria-hidden="true" className="size-4" />
              Get Directions
            </ButtonLink>
            <ButtonLink
              href={buildWhatsAppUrl(buildBookingMessage())}
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
          <div className="overflow-hidden rounded-[1.75rem] border border-line bg-mint shadow-soft">
            <div className="relative aspect-[4/3] w-full">
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
            <div className="flex items-center justify-between gap-4 border-t border-line bg-white px-5 py-4">
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
                className="shrink-0"
              >
                Directions
              </ButtonLink>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
