import { ClinicGallery } from "@/components/home/ClinicGallery";
import { CTASection } from "@/components/home/CTASection";
import { DoctorPreview } from "@/components/home/DoctorPreview";
import { FAQ } from "@/components/home/FAQ";
import { Hero } from "@/components/home/Hero";
import { LocationSection } from "@/components/home/LocationSection";
import { ProcessSection } from "@/components/home/ProcessSection";
import { ServicesPreview } from "@/components/home/ServicesPreview";
import { Testimonials } from "@/components/home/Testimonials";
import { TrustSection } from "@/components/home/TrustSection";
import { WhyChooseUs } from "@/components/home/WhyChooseUs";

export default function HomePage() {
  return (
    <>
      <Hero />
      <TrustSection />
      <ServicesPreview />
      <WhyChooseUs />
      <DoctorPreview />
      <ProcessSection />
      <Testimonials />
      <ClinicGallery />
      <FAQ />
      <CTASection />
      <LocationSection />
    </>
  );
}
