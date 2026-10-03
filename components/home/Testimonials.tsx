import { Reveal } from "@/components/shared/Reveal";
import { SectionHeading } from "@/components/shared/SectionHeading";
import { TestimonialCard } from "@/components/shared/TestimonialCard";
import { testimonials } from "@/data/testimonials";

export function Testimonials() {
  return (
    <section
      id="testimonials"
      aria-labelledby="testimonials-heading"
      className="section-pad bg-surface"
    >
      <div className="container-page">
        <Reveal>
          <SectionHeading
            id="testimonials-heading"
            eyebrow="Patient Feedback"
            title="Kind words from our patients."
            description="Sample testimonials are shown here until real, permissioned patient feedback is added."
            align="center"
          />
        </Reveal>

        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {testimonials.map((testimonial, index) => (
            <Reveal key={testimonial.id} delay={(index % 4) * 80}>
              <TestimonialCard testimonial={testimonial} className="h-full" />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
