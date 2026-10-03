import { CircleCheck } from "lucide-react";

import { WhatsAppButton } from "@/components/shared/WhatsAppButton";
import { Button, ButtonLink } from "@/components/ui/button";
import { CLINIC_NAME } from "@/lib/constants";

export type BookingSummary = {
  name: string;
  date: string;
  time: string;
  treatment: string;
};

type BookingSuccessProps = {
  summary: BookingSummary;
  onRestart: () => void;
};

const rows = [
  { id: "date", label: "Date", key: "date" },
  { id: "time", label: "Time", key: "time" },
  { id: "treatment", label: "Treatment", key: "treatment" },
  { id: "name", label: "Patient", key: "name" },
] as const;

export function BookingSuccess({ summary, onRestart }: BookingSuccessProps) {
  return (
    <div className="flex flex-col items-start gap-7">
      <div className="flex items-start gap-4">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-mint text-primary">
          <CircleCheck aria-hidden="true" className="size-7" />
        </span>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            Request received
          </p>
          <h2 className="mt-2 text-2xl font-semibold leading-tight text-ink sm:text-3xl">
            Appointment Request Received
          </h2>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
            Thank you for choosing {CLINIC_NAME}. Our clinic team will contact you
            to confirm your appointment.
          </p>
        </div>
      </div>

      <div className="w-full rounded-2xl border border-line bg-mint/50 p-5 sm:p-6">
        <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">
          Appointment Details
        </h3>
        <dl className="mt-4 divide-y divide-primary/10">
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex items-baseline justify-between gap-4 py-2.5"
            >
              <dt className="text-sm text-muted">{row.label}</dt>
              <dd className="text-right text-sm font-semibold text-ink">
                {summary[row.key]}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs leading-relaxed text-muted">
          This is a booking request, not a confirmed appointment. Final
          confirmation follows once the clinic team has checked availability.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <ButtonLink href="/" size="lg">
          Back to Home
        </ButtonLink>
        <ButtonLink href="/contact" variant="outline" size="lg">
          Contact Us
        </ButtonLink>
        <WhatsAppButton
          variant="outline"
          size="lg"
          label="Confirm via WhatsApp"
          details={{
            name: summary.name,
            date: summary.date,
            time: summary.time,
            treatment: summary.treatment,
          }}
        />
      </div>

      <Button variant="ghost" size="sm" onClick={onRestart}>
        Book another appointment
      </Button>
    </div>
  );
}
