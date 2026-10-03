import { ArrowRight, CalendarCheck, Clock, Phone, ShieldCheck } from "lucide-react";
import Image from "next/image";

import { WhatsAppButton } from "@/components/shared/WhatsAppButton";
import { ButtonLink } from "@/components/ui/button";
import {
  BOOK_APPOINTMENT_HREF,
  CLINIC_OPENING_HOURS,
  CLINIC_PHONE_DIAL,
  CLINIC_PHONE_NUMBER,
} from "@/lib/constants";

export function Hero() {
  return (
    <section aria-labelledby="hero-heading" className="relative overflow-hidden">
      <div className="grid-surface pointer-events-none absolute inset-0" aria-hidden="true" />

      <div className="container-page relative grid items-center gap-12 pb-16 pt-12 lg:grid-cols-12 lg:gap-12 lg:pb-24 lg:pt-20">
        <div className="lg:col-span-6">
          <p className="inline-flex items-center gap-2.5 rounded-full border border-primary/15 bg-mint px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-primary-soft"
            />
            Modern Dental Clinic
          </p>

          <h1
            id="hero-heading"
            className="mt-7 text-[2.6rem] font-semibold leading-[1.04] tracking-tight text-ink sm:text-[3.4rem] xl:text-[3.9rem]"
          >
            Your Smile Deserves
            <span className="mt-1 block text-primary">
              Thoughtful Dental Care.
            </span>
          </h1>

          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
            Modern, compassionate dental care designed around your comfort,
            confidence, and long-term oral health.
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
            <ButtonLink href={BOOK_APPOINTMENT_HREF} size="lg" className="sm:px-8">
              Book an Appointment
              <ArrowRight aria-hidden="true" className="size-4" />
            </ButtonLink>
            <WhatsAppButton size="lg" />
          </div>

          <dl className="mt-10 flex flex-wrap gap-x-12 gap-y-5 border-t border-line pt-7">
            <div>
              <dt className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-muted">
                <Clock aria-hidden="true" className="size-4 text-primary" />
                Opening Hours
              </dt>
              <dd className="mt-2 text-sm font-medium text-ink">
                {CLINIC_OPENING_HOURS}
              </dd>
            </div>
            <div>
              <dt className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-muted">
                <Phone aria-hidden="true" className="size-4 text-primary" />
                Call the Clinic
              </dt>
              <dd className="mt-2 text-sm font-medium text-ink">
                <a
                  href={CLINIC_PHONE_DIAL}
                  className="transition-colors hover:text-primary"
                >
                  {CLINIC_PHONE_NUMBER}
                </a>
              </dd>
            </div>
          </dl>
        </div>

        <div className="relative lg:col-span-6">
          <div
            aria-hidden="true"
            className="absolute -right-6 -top-6 hidden h-48 w-48 rounded-full bg-mint sm:block"
          />

          <Image
            src="/images/hero-clinic.svg"
            alt="Illustration of a calm, modern dental treatment room at The Good Dentist"
            width={960}
            height={1040}
            priority
            sizes="(min-width: 1024px) 46vw, (min-width: 640px) 80vw, 100vw"
            className="relative z-10 h-auto w-full rounded-[1.75rem] border border-line shadow-lift"
          />

          <div className="absolute bottom-6 left-2 z-20 hidden items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3 shadow-soft sm:flex">
            <span className="flex size-10 items-center justify-center rounded-xl bg-mint text-primary">
              <ShieldCheck aria-hidden="true" className="size-5" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-ink">
                Transparent communication
              </span>
              <span className="block text-xs text-muted">
                Every step explained first
              </span>
            </span>
          </div>

          <div className="absolute -right-1 top-8 z-20 hidden items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3 shadow-soft sm:flex">
            <span className="flex size-10 items-center justify-center rounded-xl bg-mint text-primary">
              <CalendarCheck aria-hidden="true" className="size-5" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-ink">
                Book online
              </span>
              <span className="block text-xs text-muted">
                Or reserve via WhatsApp
              </span>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
