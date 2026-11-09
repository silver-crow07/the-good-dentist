"use client";

/**
 * Register-patient dialog (Phase C) — ADMIN only (the API re-checks with
 * requireRole). Field errors come back from the server's Zod validation in
 * `ApiClientError.fields`; nothing is stored outside React state.
 */

import { LoaderCircle, UserPlus, X } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { FieldLabel, FieldError, Input } from "@/components/ui/field";
import {
  ApiClientError,
  createAdminPatient,
  type AdminPatientListItem,
} from "@/lib/client/admin";

type RegisterPatientDialogProps = {
  onClose: () => void;
  onCreated: (patient: AdminPatientListItem) => void;
};

export function RegisterPatientDialog({ onClose, onCreated }: RegisterPatientDialogProps) {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFormError(null);
    setFields({});
    try {
      const patient = await createAdminPatient({
        fullName: fullName.trim(),
        phone: phone.trim(),
        ...(email.trim() ? { email: email.trim() } : {}),
      });
      onCreated(patient);
    } catch (error) {
      if (error instanceof ApiClientError) {
        setFormError(error.fields ? null : error.message);
        setFields(error.fields ?? {});
      } else {
        setFormError("Something went wrong while registering the patient. Please try again.");
      }
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-ink/50 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Register a new patient"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white shadow-lift sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
              <UserPlus aria-hidden="true" className="size-5 text-primary" />
              Register patient
            </h2>
            <p className="mt-0.5 text-sm text-muted">
              New records appear in the directory immediately.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close register dialog"
            className="flex size-9 items-center justify-center rounded-xl border border-line text-ink transition-colors hover:bg-line-soft"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4">
          <div className="space-y-4">
            <div>
              <FieldLabel htmlFor="patient-name" required>
                Full name
              </FieldLabel>
              <Input
                id="patient-name"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                placeholder="e.g. Asha Verma"
                maxLength={120}
                autoComplete="off"
              />
              {fields.fullName ? <FieldError id="patient-name-error">{fields.fullName}</FieldError> : null}
            </div>

            <div>
              <FieldLabel htmlFor="patient-phone" required>
                Phone
              </FieldLabel>
              <Input
                id="patient-phone"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="e.g. 98765 43210"
                inputMode="tel"
                maxLength={30}
                autoComplete="off"
              />
              {fields.phone ? <FieldError id="patient-phone-error">{fields.phone}</FieldError> : null}
            </div>

            <div>
              <FieldLabel htmlFor="patient-email">Email (optional)</FieldLabel>
              <Input
                id="patient-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="e.g. asha@example.com"
                maxLength={200}
                autoComplete="off"
              />
              {fields.email ? <FieldError id="patient-email-error">{fields.email}</FieldError> : null}
            </div>
          </div>

          {formError ? (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {formError}
            </p>
          ) : null}
        </form>

        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-4">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            form={undefined}
            size="sm"
            disabled={busy || !fullName.trim() || !phone.trim()}
            aria-busy={busy}
            onClick={(event) => {
              event.preventDefault();
              const form = (event.currentTarget as HTMLButtonElement).form;
              if (form) void form.requestSubmit();
            }}
          >
            {busy ? (
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <UserPlus aria-hidden="true" className="size-4" />
            )}
            Register
          </Button>
        </div>
      </div>
    </div>
  );
}
