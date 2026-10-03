import type { Metadata } from "next";
import { Info } from "lucide-react";

import { CTASection } from "@/components/home/CTASection";
import { PageHero } from "@/components/shared/PageHero";
import { Reveal } from "@/components/shared/Reveal";
import { SectionHeading } from "@/components/shared/SectionHeading";
import { DoctorCard } from "@/components/shared/DoctorCard";
import { doctors } from "@/data/doctors";

export const metadata: Metadata = {
  title: "Our Dentist",
  description:
    "Meet the dentists at The Good Dentist — qualifications, experience and areas of expertise.",
  alternates: { canonical: "/doctors" },
};

export default function DoctorsPage() {
  return (
    <>
      <PageHero
        eyebrow="Our dentist"
        title="Meet the people caring for your smile."
        description="Experienced professionals with a gentle, patient-focused approach to dental care."
      />

      <section aria-label="Dentist profiles" className="section-pad bg-surface">
        <div className="container-page">
          <Reveal>
            <SectionHeading
              id="care-team"
              eyebrow="Our team"
              title="Your care team."
              description="The clinicians behind every appointment at The Good Dentist."
            />
          </Reveal>

          <Reveal className="mt-8">
            <div className="flex items-start gap-3 rounded-2xl border border-accent/30 bg-accent/10 p-4 sm:p-5">
              <Info aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-accent-deep" />
              <p className="text-sm leading-relaxed text-ink/80">
                <span className="font-semibold">Placeholder profiles.</span> Names,
                qualifications and portraits below are placeholders — replace them
                with the clinic&apos;s verified dentist details before launch.
              </p>
            </div>
          </Reveal>

          <div className="mt-8 grid gap-6">
            {doctors.map((doctor, index) => (
              <Reveal key={doctor.id} delay={index * 100}>
                <DoctorCard doctor={doctor} />
              </Reveal>
            ))}
          </div>

          <Reveal className="mt-12">
            <SectionHeading
              eyebrow="Our promise"
              title="Care that stays personal."
              description="However many clinicians join the team, the standard stays the same: listen first, explain clearly, treat gently."
            />
          </Reveal>
        </div>
      </section>

      <CTASection />
    </>
  );
}
