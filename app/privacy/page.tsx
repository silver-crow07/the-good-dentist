import type { Metadata } from "next";
import Link from "next/link";

import { CTASection } from "@/components/home/CTASection";
import { PageHero } from "@/components/shared/PageHero";
import { Reveal } from "@/components/shared/Reveal";
import { SITE_NAME } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: `Privacy policy placeholder for ${SITE_NAME}.`,
  alternates: { canonical: "/privacy" },
  robots: { index: false },
};

export default function PrivacyPage() {
  return (
    <>
      <PageHero
        eyebrow="Legal"
        title="Privacy Policy"
        description="Placeholder page — replace with the clinic's reviewed privacy policy before launch."
      />

      <section className="section-pad bg-surface">
        <div className="container-page max-w-3xl">
          <Reveal className="rounded-3xl border border-line bg-white p-6 sm:p-8">
            <p className="text-sm leading-relaxed text-muted">
              This page is intentionally a placeholder. It should explain how the
              clinic collects, stores and uses patient information — including
              appointment requests, contact details and any records held by the
              future clinic management system — once that content has been
              supplied and reviewed.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-muted">
              Until then, no personal data is stored by this website: appointment
              and contact forms are frontend-only demonstrations.
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
