import type { Metadata } from "next";
import Image from "next/image";
import { CircleCheck } from "lucide-react";

import { CTASection } from "@/components/home/CTASection";
import { DoctorCard } from "@/components/shared/DoctorCard";
import { PageHero } from "@/components/shared/PageHero";
import { Reveal } from "@/components/shared/Reveal";
import { SectionHeading } from "@/components/shared/SectionHeading";
import { getFeaturedDoctor } from "@/data/doctors";
import { CLINIC_IMAGES } from "@/lib/constants";

export const metadata: Metadata = {
  title: "About",
  description:
    "Learn about the approach behind The Good Dentist — calm, transparent and patient-first dental care.",
  alternates: { canonical: "/about" },
};

const values = [
  {
    id: "comfort",
    title: "Comfort first",
    description: "Unhurried visits and a calm environment for every patient.",
  },
  {
    id: "clarity",
    title: "Clear communication",
    description: "Options explained in plain language before treatment begins.",
  },
  {
    id: "cleanliness",
    title: "Cleanliness",
    description: "Careful hygiene standards across every treatment room.",
  },
  {
    id: "continuity",
    title: "Long-term thinking",
    description: "Advice that protects your oral health beyond a single visit.",
  },
];

export default function AboutPage() {
  const doctor = getFeaturedDoctor();

  return (
    <>
      <PageHero
        eyebrow="About the clinic"
        title="Dentistry with a calm, considered approach."
        description="The Good Dentist is a modern dental clinic built around a simple idea: dental care should feel clear, comfortable and unhurried from the moment you arrive."
      />

      <section aria-labelledby="about-approach-heading" className="section-pad bg-surface">
        <div className="container-page grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <Reveal>
            <SectionHeading
              id="about-approach-heading"
              eyebrow="Our Approach"
              title="Care that starts with listening."
            />
            <div className="mt-5 space-y-4 text-base leading-relaxed text-muted">
              <p>
                Every visit begins with a conversation. We take time to understand
                what brought you in, what you would like to change, and any concerns
                you may have about treatment.
              </p>
              <p>
                From there, options are explained clearly — including timing,
                alternatives and what to expect — so decisions are made together
                rather than rushed. The goal is always the same: healthy teeth,
                comfortable visits and a smile you feel confident about.
              </p>
            </div>
          </Reveal>

          <Reveal delay={120}>
            <Image
              src={CLINIC_IMAGES.aboutClinic}
              alt="Stock photo of a healthcare team, used as a temporary stand-in for the patient-care environment at The Good Dentist"
              width={960}
              height={640}
              sizes="(min-width: 1024px) 48vw, 100vw"
              loading="lazy"
              className="h-auto w-full rounded-[1.75rem] border border-line shadow-soft"
            />
          </Reveal>
        </div>
      </section>

      <section aria-labelledby="about-values-heading" className="section-pad border-y border-line bg-white">
        <div className="container-page">
          <Reveal>
            <SectionHeading
              id="about-values-heading"
              eyebrow="What We Stand For"
              title="The details that shape every visit."
              align="center"
            />
          </Reveal>

          <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {values.map((value, index) => (
              <li key={value.id}>
                <Reveal delay={index * 80} className="h-full">
                  <div className="h-full rounded-2xl border border-line bg-surface p-6 transition duration-300 hover:border-primary/30 hover:shadow-soft">
                    <span className="flex size-10 items-center justify-center rounded-xl bg-mint text-primary">
                      <CircleCheck aria-hidden="true" className="size-5" />
                    </span>
                    <h3 className="mt-4 text-base font-semibold text-ink">
                      {value.title}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted">
                      {value.description}
                    </p>
                  </div>
                </Reveal>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="about-team-heading" className="section-pad bg-surface">
        <div className="container-page">
          <Reveal>
            <SectionHeading
              id="about-team-heading"
              eyebrow="Meet Your Dentist"
              title="The people behind your care."
            />
          </Reveal>
          <Reveal className="mt-8" delay={100}>
            <DoctorCard doctor={doctor} />
          </Reveal>
        </div>
      </section>

      <CTASection />
    </>
  );
}
