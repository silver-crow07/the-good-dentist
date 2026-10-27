"use client";

import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Clock,
  Loader2,
  Stethoscope,
  User,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

import { BookingSuccess, type BookingSummary } from "./BookingSuccess";
import { DateSelector } from "./DateSelector";
import { TimeSlotSelector } from "./TimeSlotSelector";
import { WhatsAppButton } from "@/components/shared/WhatsAppButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldError, FieldLabel, Input, Select } from "@/components/ui/field";
import { services } from "@/data/services";
import {
  formatSlotDate,
  getBookableDates,
  getSlotsForDate,
  isSlotAvailable,
} from "@/lib/appointment";
import { cn } from "@/lib/utils";

type Step = 1 | 2 | 3 | 4;

type FormValues = {
  name: string;
  phone: string;
  email: string;
  treatmentSlug: string;
  date: string;
  time: string;
};

type FieldErrors = Partial<Record<keyof FormValues, string>>;

type Status = "idle" | "submitting";

const STEPS: { id: Step; label: string; heading: string; hint: string }[] = [
  {
    id: 1,
    label: "Details",
    heading: "Patient details",
    hint: "Tell us who the appointment is for.",
  },
  {
    id: 2,
    label: "Treatment",
    heading: "Select treatment",
    hint: "Choose the treatment you would like to book.",
  },
  {
    id: 3,
    label: "Date",
    heading: "Select date",
    hint: "Days the clinic is closed are unavailable.",
  },
  {
    id: 4,
    label: "Time",
    heading: "Select time",
    hint: "Only available slots can be selected.",
  },
];

const EMPTY_VALUES: FormValues = {
  name: "",
  phone: "",
  email: "",
  treatmentSlug: "",
  date: "",
  time: "",
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validateStep(step: Step, values: FormValues): FieldErrors {
  const errors: FieldErrors = {};

  if (step === 1) {
    if (values.name.trim().length < 2) {
      errors.name = "Please enter the patient's full name.";
    }
    const digits = values.phone.replace(/[^0-9]/g, "");
    if (digits.length < 7 || digits.length > 15) {
      errors.phone = "Please enter a valid phone number.";
    }
    if (values.email.trim().length > 0 && !EMAIL_PATTERN.test(values.email.trim())) {
      errors.email = "Enter a valid email address, or leave this blank.";
    }
  }

  if (step === 2 && !values.treatmentSlug) {
    errors.treatmentSlug = "Please select a treatment.";
  }

  if (step === 3 && !values.date) {
    errors.date = "Please select a date.";
  }

  if (step === 4) {
    if (!values.time) {
      errors.time = "Please select a time slot.";
    } else {
      const treatment = services.find((s) => s.slug === values.treatmentSlug);
      const slots = treatment
        ? getSlotsForDate(values.date, treatment.durationMinutes)
        : [];
      if (!isSlotAvailable(slots, values.time)) {
        errors.time = "That slot is no longer available — please choose another.";
      }
    }
  }

  return errors;
}

export function AppointmentForm() {
  const [step, setStep] = useState<Step>(1);
  const [values, setValues] = useState<FormValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<Status>("idle");
  const [summary, setSummary] = useState<BookingSummary | null>(null);

  const dates = useMemo(() => getBookableDates(14), []);
  const treatment = services.find((entry) => entry.slug === values.treatmentSlug);
  const durationMinutes = treatment?.durationMinutes;
  const slots = useMemo(
    () =>
      values.date && durationMinutes
        ? getSlotsForDate(values.date, durationMinutes)
        : [],
    [values.date, durationMinutes],
  );

  const currentStep = STEPS.find((entry) => entry.id === step) ?? STEPS[0];
  // Count only real messages: `updateField` clears an error by writing
  // `undefined`, which would otherwise leave an empty key behind and make the
  // "review the highlighted fields" alert appear while the user is typing.
  const errorCount = Object.values(errors).filter(Boolean).length;

  function updateField<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((previous) => {
      const next: FormValues = { ...previous, [key]: value };
      if (key === "treatmentSlug" || key === "date") {
        next.time = "";
      }
      return next;
    });
    setErrors((previous) => ({ ...previous, [key]: undefined }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const stepErrors = validateStep(step, values);
    setErrors(stepErrors);
    if (Object.keys(stepErrors).length > 0) return;

    if (step < 4) {
      setStep((step + 1) as Step);
      return;
    }

    setStatus("submitting");
    // Phase 1: mock submission. Replace with an API call in a later phase.
    window.setTimeout(() => {
      setStatus("idle");
      setSummary({
        name: values.name.trim(),
        date: values.date ? formatSlotDate(values.date) : "",
        time: values.time,
        treatment: treatment?.title ?? "",
      });
    }, 700);
  }

  function goBack() {
    setErrors({});
    setStep((current) => (current > 1 ? ((current - 1) as Step) : current));
  }

  function restart() {
    setSummary(null);
    setValues(EMPTY_VALUES);
    setErrors({});
    setStep(1);
  }

  if (summary) {
    return (
      <div className="rounded-3xl border border-line bg-white p-6 sm:p-10">
        <BookingSuccess summary={summary} onRestart={restart} />
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]"
    >
      <div className="rounded-3xl border border-line bg-white p-5 shadow-soft sm:p-8">
        <p className="sr-only" aria-live="polite">
          Step {step} of 4: {currentStep.heading}
        </p>

        {/* Progress */}
        <ol className="grid grid-cols-4 gap-2 sm:gap-4">
          {STEPS.map((entry) => {
            const done = entry.id < step;
            const active = entry.id === step;
            const canJump = entry.id < step;

            return (
              <li key={entry.id}>
                <button
                  type="button"
                  disabled={!canJump}
                  onClick={() => {
                    setErrors({});
                    setStep(entry.id);
                  }}
                  aria-current={active ? "step" : undefined}
                  className="group flex w-full flex-col gap-2 text-left disabled:cursor-not-allowed"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition",
                        done && "bg-primary text-white",
                        active && "bg-primary text-white ring-4 ring-primary/15",
                        !done && !active && "bg-line-soft text-muted",
                      )}
                    >
                      {done ? "✓" : entry.id}
                    </span>
                    <span
                      className={cn(
                        "truncate text-xs font-medium sm:text-sm",
                        active ? "text-ink" : "text-muted",
                      )}
                    >
                      {entry.label}
                    </span>
                  </span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "h-1 w-full rounded-full transition-colors",
                      done || active ? "bg-primary" : "bg-line-soft",
                    )}
                  />
                </button>
              </li>
            );
          })}
        </ol>

        <div className="mt-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-ink sm:text-2xl">
                {currentStep.heading}
              </h2>
              <p className="mt-1 text-sm text-muted">{currentStep.hint}</p>
            </div>
            {treatment ? (
              <Badge>
                <Clock aria-hidden="true" className="size-3.5" />
                ~{treatment.durationMinutes} min
              </Badge>
            ) : null}
          </div>

          <div className="mt-6">
            {step === 1 ? (
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="grid gap-1.5 sm:col-span-2">
                  <FieldLabel htmlFor="patient-name" required>
                    Full Name
                  </FieldLabel>
                  <Input
                    id="patient-name"
                    name="name"
                    autoComplete="name"
                    placeholder="e.g. Jane Doe"
                    value={values.name}
                    onChange={(event) => updateField("name", event.target.value)}
                    aria-invalid={Boolean(errors.name)}
                    aria-describedby={errors.name ? "name-error" : undefined}
                  />
                  <FieldError id="name-error">{errors.name}</FieldError>
                </div>

                <div className="grid gap-1.5">
                  <FieldLabel htmlFor="patient-phone" required>
                    Phone Number
                  </FieldLabel>
                  <Input
                    id="patient-phone"
                    name="phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="+1 000 000 0000"
                    value={values.phone}
                    onChange={(event) => updateField("phone", event.target.value)}
                    aria-invalid={Boolean(errors.phone)}
                    aria-describedby={errors.phone ? "phone-error" : undefined}
                  />
                  <FieldError id="phone-error">{errors.phone}</FieldError>
                </div>

                <div className="grid gap-1.5">
                  <FieldLabel htmlFor="patient-email">Email</FieldLabel>
                  <Input
                    id="patient-email"
                    name="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={values.email}
                    onChange={(event) => updateField("email", event.target.value)}
                    aria-invalid={Boolean(errors.email)}
                    aria-describedby={errors.email ? "email-error" : undefined}
                  />
                  <FieldError id="email-error">{errors.email}</FieldError>
                </div>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="grid gap-3">
                <div className="grid gap-1.5">
                  <FieldLabel htmlFor="treatment" required>
                    Select Treatment
                  </FieldLabel>
                  <Select
                    id="treatment"
                    name="treatment"
                    value={values.treatmentSlug}
                    onChange={(event) =>
                      updateField("treatmentSlug", event.target.value)
                    }
                    aria-invalid={Boolean(errors.treatmentSlug)}
                    aria-describedby={
                      errors.treatmentSlug ? "treatment-error" : "treatment-hint"
                    }
                  >
                    <option value="">Choose a treatment…</option>
                    {services.map((service) => (
                      <option key={service.slug} value={service.slug}>
                        {service.title} (~{service.durationMinutes} min)
                      </option>
                    ))}
                  </Select>
                  <FieldError id="treatment-error">
                    {errors.treatmentSlug}
                  </FieldError>
                </div>

                <div className="rounded-2xl border border-line bg-mint/50 p-4">
                  {treatment ? (
                    <>
                      <p className="text-sm font-semibold text-ink">
                        {treatment.title}
                      </p>
                      <p className="mt-1 text-sm leading-relaxed text-muted">
                        {treatment.shortDescription}
                      </p>
                      <p className="mt-3 flex items-center gap-2 text-xs text-primary">
                        <Stethoscope aria-hidden="true" className="size-3.5" />
                        Indicative duration {treatment.durationMinutes} minutes —
                        exact timing is confirmed at the clinic.
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-muted" id="treatment-hint">
                      Select a treatment to see its indicative duration and to load
                      the correct availability.
                    </p>
                  )}
                </div>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="grid gap-3">
                <DateSelector
                  dates={dates}
                  value={values.date}
                  onChange={(iso) => updateField("date", iso)}
                />
                <FieldError id="date-error">{errors.date}</FieldError>
                <p className="flex items-center gap-2 text-xs text-muted">
                  <CalendarDays aria-hidden="true" className="size-3.5" />
                  {values.date
                    ? `Selected: ${formatSlotDate(values.date)}`
                    : "Choose a day to see available times."}
                </p>
              </div>
            ) : null}

            {step === 4 ? (
              <div className="grid gap-3">
                {slots.length > 0 ? (
                  <TimeSlotSelector
                    slots={slots}
                    value={values.time}
                    onChange={(time) => updateField("time", time)}
                  />
                ) : (
                  <p className="text-sm text-muted">
                    Select a date and treatment to see available times.
                  </p>
                )}
                <FieldError id="time-error">{errors.time}</FieldError>
              </div>
            ) : null}
          </div>

          {errorCount > 0 ? (
            <p
              role="alert"
              className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
            >
              Please review the highlighted field
              {errorCount > 1 ? "s" : ""} before continuing.
            </p>
          ) : null}
        </div>

        <div className="mt-8 flex items-center justify-between gap-3 border-t border-line-soft pt-6">
          {step > 1 ? (
            <Button
              type="button"
              variant="ghost"
              onClick={goBack}
              disabled={status === "submitting"}
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
              Back
            </Button>
          ) : (
            <span aria-hidden="true" />
          )}

          <Button
            type="submit"
            size="lg"
            disabled={status === "submitting"}
            className="min-w-40"
          >
            {status === "submitting" ? (
              <>
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                Sending…
              </>
            ) : step < 4 ? (
              <>
                Continue
                <ArrowRight aria-hidden="true" className="size-4" />
              </>
            ) : (
              <>
                Request Appointment
                <ArrowRight aria-hidden="true" className="size-4" />
              </>
            )}
          </Button>
        </div>
      </div>

      <aside
        aria-label="Your booking summary"
        className="rounded-3xl border border-line bg-white p-5 sm:p-6 lg:sticky lg:top-28"
      >
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-mint text-primary">
            <User aria-hidden="true" className="size-5" />
          </span>
          <h2 className="text-base font-semibold text-ink">Your Selection</h2>
        </div>

        <dl className="mt-5 space-y-3">
          <SummaryRow label="Patient" value={values.name || "Not set"} />
          <SummaryRow label="Phone" value={values.phone || "Not set"} />
          <SummaryRow label="Treatment" value={treatment?.title ?? "Not set"} />
          <SummaryRow
            label="Date"
            value={values.date ? formatSlotDate(values.date) : "Not set"}
          />
          <SummaryRow label="Time" value={values.time || "Not set"} />
        </dl>

        <div className="mt-5 border-t border-line-soft pt-5">
          <WhatsAppButton
            size="sm"
            className="w-full"
            label="Send via WhatsApp"
            details={{
              name: values.name.trim() || undefined,
              date: values.date ? formatSlotDate(values.date) : undefined,
              time: values.time || undefined,
              treatment: treatment?.title,
            }}
          />
          <p className="mt-3 text-xs leading-relaxed text-muted">
            Your request is only held once the clinic team confirms it — we will
            contact you on the phone number provided.
          </p>
        </div>
      </aside>
    </form>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  const muted = value === "Not set";
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs uppercase tracking-[0.12em] text-muted">{label}</dt>
      <dd
        className={cn(
          "text-right text-sm font-medium",
          muted ? "text-muted" : "text-ink",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
