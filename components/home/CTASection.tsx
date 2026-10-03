import { ArrowRight, Phone } from "lucide-react";
import type { ReactNode } from "react";

import { Reveal } from "@/components/shared/Reveal";
import { WhatsAppButton } from "@/components/shared/WhatsAppButton";
import { ButtonLink } from "@/components/ui/button";
import {
  BOOK_APPOINTMENT_HREF,
  CLINIC_PHONE_DIAL,
  CLINIC_PHONE_NUMBER,
} from "@/lib/constants";

type CTASectionProps = {
  id?: string;
  title?: ReactNode;
  description?: string;
};

export function CTASection({
  id = "book",
  title = (
    <>
      Ready to Take Care
      <br />
      of Your Smile?
    </>
  ),
  description = "Book online in a few steps, or send us a message on WhatsApp and our team will help you find the right time.",
}: CTASectionProps) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="section-pad">
      <div className="container-page">
        <Reveal>
          <div className="relative overflow-hidden rounded-[1.75rem] bg-primary px-6 py-12 text-white shadow-lift sm:px-10 sm:py-14 lg:px-16 lg:py-16">
            <div
              className="pointer-events-none absolute inset-0 opacity-50"
              aria-hidden="true"
              style={{
                backgroundImage:
                  "linear-gradient(to right, rgba(255,255,255,0.14) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.14) 1px, transparent 1px)",
                backgroundSize: "56px 56px",
                maskImage:
                  "radial-gradient(ellipse 70% 80% at 70% 30%, black 30%, transparent 100%)",
                WebkitMaskImage:
                  "radial-gradient(ellipse 70% 80% at 70% 30%, black 30%, transparent 100%)",
              }}
            />

            <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-12">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
                  Book Your Visit
                </p>
                <h2
                  id={`${id}-heading`}
                  className="mt-4 text-3xl font-semibold leading-[1.12] sm:text-4xl lg:text-[2.6rem]"
                >
                  {title}
                </h2>
                <p className="mt-4 max-w-xl text-base leading-relaxed text-white/75">
                  {description}
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row lg:flex-col xl:min-w-72">
                <ButtonLink
                  href={BOOK_APPOINTMENT_HREF}
                  variant="light"
                  size="lg"
                  className="w-full"
                >
                  Book Online
                  <ArrowRight aria-hidden="true" className="size-4" />
                </ButtonLink>
                <WhatsAppButton
                  variant="onDark"
                  size="lg"
                  className="w-full bg-transparent"
                />
                <a
                  href={CLINIC_PHONE_DIAL}
                  className="inline-flex items-center justify-center gap-2 text-sm font-medium text-white/80 transition-colors hover:text-white"
                >
                  <Phone aria-hidden="true" className="size-4" />
                  {CLINIC_PHONE_NUMBER}
                </a>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
