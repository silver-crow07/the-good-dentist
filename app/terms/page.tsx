import type { Metadata } from "next";
import Link from "next/link";

import { CTASection } from "@/components/home/CTASection";
import { PageHero } from "@/components/shared/PageHero";
import { Reveal } from "@/components/shared/Reveal";
import { SITE_NAME } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: `Terms of service placeholder for ${SITE_NAME}.`,
  alternates: { canonical: "/terms" },
  robots: { index: false },
};

export default function TermsPage() {
  return (
    <>
      <PageHero
        eyebrow="Legal"
        title="Terms of Service"
        description="Placeholder page — replace with the clinic's reviewed terms before launch."
      />

      <section className="section-pad bg-surface">
        <div className="container-page max-w-3xl">
          <Reveal className="rounded-3xl border border-line bg-white p-6 sm:p-8">
            <p className="text-sm leading-relaxed text-muted">
              This page is intentionally a placeholder. It should cover booking
              and cancellation expectations, payment terms, treatment consent and
              any conditions of using the clinic&apos;s services once that content
              has been supplied and reviewed.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-muted">
              Appointment requests submitted through this website are
              demonstrations only and do not create a confirmed booking.
            </p>
            <p className="mt-6">
              <Link
                href="/"
                className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                ← Back to home
              </Link>
            </p>
          </Reveal>
        </div>
      </section>

      <CTASection />
    </>
  );
}
