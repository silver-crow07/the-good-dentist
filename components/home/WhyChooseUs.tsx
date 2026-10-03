import { ArrowRight, CircleCheck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { Reveal } from "@/components/shared/Reveal";
import { SectionHeading } from "@/components/shared/SectionHeading";
import { BOOK_APPOINTMENT_HREF } from "@/lib/constants";

const features = [
  {
    id: "personalised-care",
    title: "Personalised care",
    description: "Treatment plans shaped around your needs, not a template.",
  },
  {
    id: "modern-approach",
    title: "Modern treatment approach",
    description: "Current techniques explained in plain, honest language.",
  },
  {
    id: "comfortable-environment",
    title: "Comfortable environment",
    description: "Calm surroundings designed to put patients at ease.",
  },
  {
    id: "transparent-communication",
    title: "Transparent communication",
    description: "Options, timings and costs discussed before treatment starts.",
  },
  {
    id: "experienced-professionals",
    title: "Experienced professionals",
    description: "Care delivered by qualified, attentive clinicians.",
  },
  {
    id: "long-term-health",
    title: "Focus on long-term oral health",
    description: "Advice that protects your smile well beyond one visit.",
  },
];

export function WhyChooseUs() {
  return (
    <section
      id="why-choose-us"
      aria-labelledby="why-choose-us-heading"
      className="section-pad bg-mint/60"
    >
      <div className="container-page grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <Reveal className="relative">
          <Image
            src="/images/why-choose-us.svg"
            alt="Illustration of the clinic interior at The Good Dentist"
            width={1000}
            height={800}
            sizes="(min-width: 1024px) 48vw, 100vw"
            loading="lazy"
            className="h-auto w-full rounded-[1.75rem] border border-primary/10 shadow-soft"
          />
          <div className="absolute -bottom-5 right-4 hidden rounded-2xl border border-primary/15 bg-white px-5 py-4 shadow-soft sm:block">
            <p className="text-xs uppercase tracking-[0.16em] text-muted">
              Patient-first
            </p>
            <p className="mt-1 text-lg font-semibold text-primary">
              Comfort at every step
            </p>
          </div>
        </Reveal>

        <Reveal delay={120}>
          <SectionHeading
            id="why-choose-us-heading"
            eyebrow="Why Choose Us"
            title={
              <>
                Why Choose
                <br />
                The Good Dentist?
              </>
            }
            description="A premium private clinic experience that stays warm, clear and unhurried."
          />

          <ul className="mt-8 grid gap-x-6 gap-y-5 sm:grid-cols-2">
            {features.map((feature) => (
              <li key={feature.id} className="flex items-start gap-3">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-white text-primary shadow-sm">
                  <CircleCheck aria-hidden="true" className="size-4" />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-ink">
                    {feature.title}
                  </span>
                  <span className="mt-0.5 block text-sm leading-snug text-muted">
                    {feature.description}
                  </span>
                </span>
              </li>
            ))}
          </ul>

          <Link
            href={BOOK_APPOINTMENT_HREF}
            className="group mt-9 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-white shadow-soft transition-all duration-200 hover:bg-primary-deep hover:shadow-lift"
          >
            Book a visit
            <ArrowRight
              aria-hidden="true"
              className="size-4 transition-transform duration-300 group-hover:translate-x-1"
            />
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
