import { Reveal } from "@/components/shared/Reveal";
import { SectionHeading } from "@/components/shared/SectionHeading";
import { processSteps } from "@/data/process";

export function ProcessSection() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="how-it-works-heading"
      className="section-pad border-y border-line bg-white"
    >
      <div className="container-page">
        <Reveal>
          <SectionHeading
            id="how-it-works-heading"
            eyebrow="How It Works"
            title="Three simple steps to a healthier smile."
            align="center"
          />
        </Reveal>

        <ol className="mt-12 grid gap-8 sm:grid-cols-3 sm:gap-6">
          {processSteps.map((step, index) => (
            <li key={step.step} className="h-full border-t border-line pt-6 sm:border-t-0 sm:pt-0">
              <Reveal delay={index * 100}>
                <div className="flex items-center gap-4 sm:block">
                  <span
                    aria-hidden="true"
                    className="text-5xl font-semibold tracking-tight text-primary/75 sm:text-6xl"
                  >
                    {step.step}
                  </span>
                  <span
                    aria-hidden="true"
                    className="hidden h-px flex-1 bg-line sm:mt-7 sm:block"
                  />
                </div>
                <h3 className="mt-4 text-xl font-semibold text-ink sm:mt-6">
                  <span className="sr-only">Step {index + 1}: </span>
                  {step.title}
                </h3>
                <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">
                  {step.description}
                </p>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
