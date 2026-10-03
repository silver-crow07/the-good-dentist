import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Reveal } from "@/components/shared/Reveal";
import { SectionHeading } from "@/components/shared/SectionHeading";
import { ServiceCard } from "@/components/services/ServiceCard";
import { getFeaturedServices } from "@/data/services";

export function ServicesPreview() {
  const featured = getFeaturedServices();

  return (
    <section
      id="services"
      aria-labelledby="services-heading"
      className="section-pad bg-surface"
    >
      <div className="container-page">
        <Reveal className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <SectionHeading
            id="services-heading"
            eyebrow="Our Services"
            title={
              <>
                Complete Dental Care,
                <br />
                Under One Roof.
              </>
            }
            description="From routine check-ups to cosmetic and restorative treatment, every service is planned around your comfort and long-term oral health."
          />
          <Link
            href="/services"
            className="group inline-flex shrink-0 items-center gap-2 text-sm font-medium text-primary"
          >
            View all services
            <ArrowRight
              aria-hidden="true"
              className="size-4 transition-transform duration-300 group-hover:translate-x-1"
            />
          </Link>
        </Reveal>

        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((service, index) => (
            <Reveal key={service.slug} delay={(index % 3) * 80}>
              <ServiceCard service={service} className="h-full" />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
