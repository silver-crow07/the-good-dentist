"use client";

/**
 * Edit-dental-record dialog (Phase D) — ADMIN only (the API re-checks
 * with requireRole). Partial update: only changed fields are sent; the
 * server requires at least one field and audits `dentalrecord.update`.
 */

import { LoaderCircle, Pencil, X } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { FieldError, FieldLabel, Input, Textarea } from "@/components/ui/field";
import {
  ApiClientError,
  updateAdminDentalRecord,
  type AdminDentalRecordDetail,
} from "@/lib/client/admin";

type EditRecordDialogProps = {
  detail: AdminDentalRecordDetail;
  onClose: () => void;
  onSaved: () => void;
};

export function EditRecordDialog({ detail, onClose, onSaved }: EditRecordDialogProps) {
  const [treatmentDate, setTreatmentDate] = useState(detail.record.treatmentDate);
  const [diagnosis, setDiagnosis] = useState(detail.record.diagnosis);
  const [treatmentDetails, setTreatmentDetails] = useState(detail.record.treatmentDetails);
  const [clinicalNotes, setClinicalNotes] = useState(detail.record.clinicalNotes ?? "");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFormError(null);
    setFields({});

    // Send only what changed (the server rejects an empty patch).
    const patch: Record<string, string> = {};
    if (treatmentDate !== detail.record.treatmentDate) patch.treatmentDate = treatmentDate;
    if (diagnosis.trim() !== detail.record.diagnosis) patch.diagnosis = diagnosis.trim();
    if (treatmentDetails.trim() !== detail.record.treatmentDetails) {
      patch.treatmentDetails = treatmentDetails.trim();
    }
    const nextNotes = clinicalNotes.trim();
    const prevNotes = detail.record.clinicalNotes ?? "";
    if (nextNotes !== prevNotes) patch.clinicalNotes = nextNotes;

    if (Object.keys(patch).length === 0) {
      setBusy(false);
      setFormError("Nothing changed — edit a field before saving.");
      return;
    }

    try {
      await updateAdminDentalRecord(detail.record.id, patch);
      onSaved();
    } catch (error) {
      if (error instanceof ApiClientError) {
        setFormError(error.fields ? null : error.message);
        setFields(error.fields ?? {});
      } else {
        setFormError("Something went wrong while saving. Please try again.");
      }
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-ink/50 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Edit dental record"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-lift sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
              <Pencil aria-hidden="true" className="size-5 text-primary" />
              Edit record
            </h2>
            <p className="mt-0.5 text-sm text-muted">
              {detail.record.patientName} · {detail.record.treatmentDate}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="flex size-9 items-center justify-center rounded-xl border border-line text-ink transition-colors hover:bg-line-soft"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4">
          <div className="space-y-4">
            <div>
              <FieldLabel htmlFor="edit-date" required>
                Treatment date
              </FieldLabel>
              <Input
                id="edit-date"
                type="date"
                value={treatmentDate}
                onChange={(event) => setTreatmentDate(event.target.value)}
              />
              {fields.treatmentDate ? (
                <FieldError id="edit-date-error">{fields.treatmentDate}</FieldError>
              ) : null}
            </div>

            <div>
              <FieldLabel htmlFor="edit-diagnosis" required>
                Diagnosis
              </FieldLabel>
              <Input
                id="edit-diagnosis"
                value={diagnosis}
                onChange={(event) => setDiagnosis(event.target.value)}
                maxLength={500}
                autoComplete="off"
              />
              {fields.diagnosis ? (
                <FieldError id="edit-diagnosis-error">{fields.diagnosis}</FieldError>
              ) : null}
            </div>

            <div>
              <FieldLabel htmlFor="edit-details" required>
                Treatment details
              </FieldLabel>
              <Textarea
                id="edit-details"
                value={treatmentDetails}
                onChange={(event) => setTreatmentDetails(event.target.value)}
                maxLength={5000}
              />
              {fields.treatmentDetails ? (
                <FieldError id="edit-details-error">{fields.treatmentDetails}</FieldError>
              ) : null}
            </div>

            <div>
              <FieldLabel htmlFor="edit-notes">Clinical notes</FieldLabel>
              <Textarea
                id="edit-notes"
                value={clinicalNotes}
                onChange={(event) => setClinicalNotes(event.target.value)}
                maxLength={5000}
              />
              {fields.clinicalNotes ? (
                <FieldError id="edit-notes-error">{fields.clinicalNotes}</FieldError>
              ) : null}
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
            size="sm"
            disabled={busy || !diagnosis.trim() || !treatmentDetails.trim() || !treatmentDate}
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
              <Pencil aria-hidden="true" className="size-4" />
            )}
            Save changes
          </Button>
        </div>
      </div>
    </div>
  );
}
