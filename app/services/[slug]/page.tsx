import type { Metadata } from "next";
import { CircleCheck, ChevronRight, Clock, Timer } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CTASection } from "@/components/home/CTASection";
import { Reveal } from "@/components/shared/Reveal";
import { SectionHeading } from "@/components/shared/SectionHeading";
import { WhatsAppButton } from "@/components/shared/WhatsAppButton";
import { ServiceCard } from "@/components/services/ServiceCard";
import { ButtonLink } from "@/components/ui/button";
import { BOOK_APPOINTMENT_HREF } from "@/lib/constants";
import { getServiceBySlug, services } from "@/data/services";

export function generateStaticParams() {
  return services.map((service) => ({ slug: service.slug }));
}

export async function generateMetadata(
  props: PageProps<"/services/[slug]">,
): Promise<Metadata> {
  const { slug } = await props.params;
  const service = getServiceBySlug(slug);

  if (!service) {
    return { title: "Service not found" };
  }

  return {
    title: service.title,
    description: service.shortDescription,
    alternates: { canonical: `/services/${service.slug}` },
  };
}

export default async function ServiceDetailPage(
  props: PageProps<"/services/[slug]">,
) {
  const { slug } = await props.params;
  const service = getServiceBySlug(slug);

  if (!service) {
    notFound();
  }

  const related = services
    .filter((entry) => entry.slug !== service.slug)
    .slice(0, 3);

  return (
    <>
      <section className="border-b border-line bg-mint/40">
        <div className="container-page py-10 md:py-14">
          <nav aria-label="Breadcrumb">
            <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
              <li>
                <Link href="/services" className="transition-colors hover:text-primary">
                  Services
                </Link>
              </li>
              <li aria-hidden="true">
                <ChevronRight className="size-4" />
              </li>
              <li aria-current="page" className="font-medium text-ink">
                {service.title}
              </li>
            </ol>
          </nav>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <span className="flex size-12 items-center justify-center rounded-xl bg-white text-primary shadow-sm">
              <service.icon aria-hidden="true" className="size-6" />
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-white px-3 py-1 text-xs font-semibold text-primary">
              <Timer aria-hidden="true" className="size-3.5" />
              ~{service.durationMinutes} min appointment
            </span>
          </div>

          <h1 className="mt-5 max-w-3xl text-4xl font-semibold leading-[1.08] text-ink sm:text-5xl">
            {service.title}
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
            {service.shortDescription}
          </p>
        </div>
      </section>

      <section className="section-pad bg-surface">
        <div className="container-page grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-14">
          <div>
            <Reveal>
              <SectionHeading eyebrow="Overview" title="What this treatment involves." />
              <p className="mt-5 text-base leading-relaxed text-muted">
                {service.overview}
              </p>
            </Reveal>

            <Reveal className="mt-8" delay={80}>
              <Image
                src={service.image}
                alt={`Stock photo illustrating ${service.title} at The Good Dentist (temporary stand-in)`}
                width={1000}
                height={667}
                sizes="(min-width: 1024px) 60vw, 100vw"
                loading="lazy"
                className="h-auto w-full rounded-[1.5rem] border border-line shadow-soft"
              />
            </Reveal>

            <Reveal className="mt-10" delay={120}>
              <h2 className="text-2xl font-semibold text-ink">
                What&apos;s included
              </h2>
              <ul className="mt-5 grid gap-3 sm:grid-cols-2">
                {service.highlights.map((highlight) => (
                  <li
                    key={highlight}
                    className="flex items-start gap-3 rounded-xl border border-line bg-white p-4"
                  >
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-mint text-primary">
                      <CircleCheck aria-hidden="true" className="size-3.5" />
                    </span>
                    <span className="text-sm leading-snug text-ink/85">
                      {highlight}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-5 flex items-start gap-2 text-sm text-muted">
                <Clock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
                Duration shown is indicative — your dentist will confirm the exact
                time after an assessment.
              </p>
            </Reveal>
          </div>

          <Reveal delay={140}>
            <aside
              aria-label={`Book ${service.title}`}
              className="rounded-3xl border border-line bg-white p-6 shadow-soft lg:sticky lg:top-28"
            >
              <h2 className="text-base font-semibold text-ink">Book this visit</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Request a time online, or message the clinic directly on WhatsApp.
              </p>

              <div className="mt-5 grid gap-3">
                <ButtonLink href={BOOK_APPOINTMENT_HREF} size="lg" className="w-full">
                  Book an Appointment
                </ButtonLink>
                <WhatsAppButton
                  size="lg"
                  className="w-full"
                  details={{ treatment: service.title }}
                />
                <ButtonLink
                  href="/contact"
                  variant="ghost"
                  size="md"
                  className="w-full"
                >
                  Ask a question first
                </ButtonLink>
              </div>

              <dl className="mt-6 space-y-3 border-t border-line-soft pt-5 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted">Indicative duration</dt>
                  <dd className="font-medium text-ink">
                    {service.durationMinutes} minutes
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted">Confirmation</dt>
                  <dd className="font-medium text-ink">By phone or WhatsApp</dd>
                </div>
              </dl>
            </aside>
          </Reveal>
        </div>
      </section>

      <section aria-labelledby="related-services-heading" className="section-pad border-t border-line bg-white">
        <div className="container-page">
          <Reveal>
            <SectionHeading
              id="related-services-heading"
              eyebrow="Explore more"
              title="Other treatments."
            />
          </Reveal>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((entry, index) => (
              <Reveal key={entry.slug} delay={index * 80}>
                <ServiceCard service={entry} className="h-full" />
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <CTASection />
    </>
  );
}
