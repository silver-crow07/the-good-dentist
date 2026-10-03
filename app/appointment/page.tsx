import type { Metadata } from "next";

import { AppointmentForm } from "@/components/appointment/AppointmentForm";
import { PageHero } from "@/components/shared/PageHero";
import { WhatsAppButton } from "@/components/shared/WhatsAppButton";

export const metadata: Metadata = {
  title: "Book an Appointment",
  description:
    "Request an appointment at The Good Dentist — choose a treatment, pick a date and select an available time slot.",
  alternates: { canonical: "/appointment" },
};

export default function AppointmentPage() {
  return (
    <>
      <PageHero
        eyebrow="Appointments"
        title="Book your visit in four simple steps."
        description="Share your details, choose a treatment, then pick a date and an available time. The clinic team will confirm your appointment afterwards."
      >
        <div className="flex flex-wrap items-center gap-3">
          <WhatsAppButton size="sm" label="Prefer WhatsApp?" />
          <span className="text-xs text-muted">
            No account needed — this takes about a minute.
          </span>
        </div>
      </PageHero>

      <section
        aria-label="Appointment request form"
        className="container-page py-10 md:py-14"
      >
        <AppointmentForm />
      </section>
    </>
  );
}
