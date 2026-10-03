import { ArrowRight } from "lucide-react";

import { DoctorCard } from "@/components/shared/DoctorCard";
import { Reveal } from "@/components/shared/Reveal";
import { SectionHeading } from "@/components/shared/SectionHeading";
import { ButtonLink } from "@/components/ui/button";
import { getFeaturedDoctor } from "@/data/doctors";

export function DoctorPreview() {
  const doctor = getFeaturedDoctor();

  return (
    <section
      id="our-dentist"
      aria-labelledby="our-dentist-heading"
      className="section-pad bg-surface"
    >
      <div className="container-page">
        <Reveal className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <SectionHeading
            id="our-dentist-heading"
            eyebrow="Meet Your Dentist"
            title="Care delivered with a gentle, patient-first approach."
            description="Get to know the clinician behind your treatment — qualifications, experience and areas of focus."
          />
          <ButtonLink href="/doctors" variant="outline" className="shrink-0">
            Our Dentists
            <ArrowRight aria-hidden="true" className="size-4" />
          </ButtonLink>
        </Reveal>

        <Reveal className="mt-10" delay={100}>
          <DoctorCard doctor={doctor} />
        </Reveal>
      </div>
    </section>
  );
}
