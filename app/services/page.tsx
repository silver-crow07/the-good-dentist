import type { Metadata } from "next";

import { CTASection } from "@/components/home/CTASection";
import { PageHero } from "@/components/shared/PageHero";
import { Reveal } from "@/components/shared/Reveal";
import { ServiceCard } from "@/components/services/ServiceCard";
import { services } from "@/data/services";

export const metadata: Metadata = {
  title: "Dental Services",
  description:
    "Explore the complete range of treatments at The Good Dentist — general dentistry, cleaning, root canal, implants, whitening, cosmetics, aligners and children's dentistry.",
  alternates: { canonical: "/services" },
};

export default function ServicesPage() {
  return (
    <>
      <PageHero
        eyebrow="Our services"
        title="Complete Dental Care, Under One Roof."
        description="Eight core treatments, one consistent standard of care. Provisional durations are shown for each service so you can plan your visit."
      />

      <section aria-label="All dental services" className="section-pad bg-surface">
        <div className="container-page">
          <h2 className="sr-only">All dental services</h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((service, index) => (
              <Reveal key={service.slug} delay={(index % 3) * 80}>
                <ServiceCard service={service} className="h-full" />
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <CTASection />
    </>
  );
}
