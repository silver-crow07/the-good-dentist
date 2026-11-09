"use client";

/**
 * Create-dental-record dialog (Phase D) — ADMIN only (the API re-checks
 * with requireRole). The patient is chosen through the existing directory
 * endpoint (search-as-you-type); nothing is stored outside React state.
 * Server-side Zod errors surface in `ApiClientError.fields`.
 */

import { LoaderCircle, Search, Stethoscope, UserPlus, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { FieldError, FieldLabel, Input, Textarea } from "@/components/ui/field";
import {
  ApiClientError,
  createAdminDentalRecord,
  fetchAdminPatients,
  type AdminDentalRecordListItem,
  type AdminPatientListItem,
} from "@/lib/client/admin";

type CreateRecordDialogProps = {
  onClose: () => void;
  onCreated: (record: AdminDentalRecordListItem) => void;
};

const SEARCH_DEBOUNCE_MS = 300;

export function CreateRecordDialog({ onClose, onCreated }: CreateRecordDialogProps) {
  const [patientQuery, setPatientQuery] = useState("");
  const [patients, setPatients] = useState<AdminPatientListItem[]>([]);
  const [patient, setPatient] = useState<AdminPatientListItem | null>(null);

  const [treatmentDate, setTreatmentDate] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [treatmentDetails, setTreatmentDetails] = useState("");
  const [clinicalNotes, setClinicalNotes] = useState("");

  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const sequence = useRef(0);

  /* -------- patient search (debounced, stale responses discarded) -------- */

  useEffect(() => {
    const query = patientQuery.trim();
    // Short query or an already-chosen patient → nothing to fetch (list
    // clearing happens in the input handler / picker, not in this effect).
    if (query.length < 2 || patient) return;
    const timer = setTimeout(() => {
      const ticket = ++sequence.current;
      fetchAdminPatients({ q: query, pageSize: 5 })
        .then((result) => {
          if (ticket !== sequence.current) return;
          setPatients(result.patients);
        })
        .catch(() => {
          if (ticket !== sequence.current) return;
          setPatients([]);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [patientQuery, patient]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !patient) return;
    setBusy(true);
    setFormError(null);
    setFields({});
    try {
      const record = await createAdminDentalRecord({
        patientId: patient.id,
        treatmentDate,
        diagnosis: diagnosis.trim(),
        treatmentDetails: treatmentDetails.trim(),
        ...(clinicalNotes.trim() ? { clinicalNotes: clinicalNotes.trim() } : {}),
      });
      onCreated(record);
    } catch (error) {
      if (error instanceof ApiClientError) {
        setFormError(error.fields ? null : error.message);
        setFields(error.fields ?? {});
      } else {
        setFormError("Something went wrong while creating the record. Please try again.");
      }
      setBusy(false);
    }
  }

  const canSubmit = Boolean(patient) && Boolean(treatmentDate) && Boolean(diagnosis.trim()) && Boolean(treatmentDetails.trim());

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-ink/50 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="New dental record"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-lift sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
              <Stethoscope aria-hidden="true" className="size-5 text-primary" />
              New dental record
            </h2>
            <p className="mt-0.5 text-sm text-muted">
              Diagnosis, treatment details and images for one visit.
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
            {/* Patient picker */}
            <div>
              <FieldLabel htmlFor="record-patient" required>
                Patient
              </FieldLabel>
              {patient ? (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/30 bg-mint px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{patient.fullName}</p>
                    <p className="truncate text-xs text-muted">{patient.phone}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setPatient(null);
                      setPatientQuery("");
                    }}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search
                      aria-hidden="true"
                      className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
                    />
                    <Input
                      id="record-patient"
                      value={patientQuery}
                      onChange={(event) => {
                        const value = event.target.value;
                        setPatientQuery(value);
                        if (value.trim().length < 2) setPatients([]);
                      }}
                      placeholder="Search by name or phone…"
                      className="pl-9"
                      autoComplete="off"
                      maxLength={100}
                    />
                  </div>
                  {patients.length > 0 ? (
                    <ul className="mt-2 divide-y divide-line-soft overflow-hidden rounded-xl border border-line">
                      {patients.map((candidate) => (
                        <li key={candidate.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setPatient(candidate);
                              setPatients([]);
                            }}
                            className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-mint/60"
                          >
                            <span className="truncate text-sm font-medium text-ink">
                              {candidate.fullName}
                            </span>
                            <span className="shrink-0 text-xs text-muted">{candidate.phone}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : patientQuery.trim().length >= 2 ? (
                    <p className="mt-2 text-xs text-muted">
                      No patients match — register them first from Patients.
                    </p>
                  ) : null}
                </>
              )}
              {fields.patientId ? (
                <FieldError id="record-patient-error">{fields.patientId}</FieldError>
              ) : null}
            </div>

            <div>
              <FieldLabel htmlFor="record-date" required>
                Treatment date
              </FieldLabel>
              <Input
                id="record-date"
                type="date"
                value={treatmentDate}
                onChange={(event) => setTreatmentDate(event.target.value)}
              />
              {fields.treatmentDate ? (
                <FieldError id="record-date-error">{fields.treatmentDate}</FieldError>
              ) : null}
            </div>

            <div>
              <FieldLabel htmlFor="record-diagnosis" required>
                Diagnosis
              </FieldLabel>
              <Input
                id="record-diagnosis"
                value={diagnosis}
                onChange={(event) => setDiagnosis(event.target.value)}
                placeholder="e.g. Dental caries — 36 MO"
                maxLength={500}
                autoComplete="off"
              />
              {fields.diagnosis ? (
                <FieldError id="record-diagnosis-error">{fields.diagnosis}</FieldError>
              ) : null}
            </div>

            <div>
              <FieldLabel htmlFor="record-details" required>
                Treatment details
              </FieldLabel>
              <Textarea
                id="record-details"
                value={treatmentDetails}
                onChange={(event) => setTreatmentDetails(event.target.value)}
                placeholder="What was done during the visit…"
                maxLength={5000}
              />
              {fields.treatmentDetails ? (
                <FieldError id="record-details-error">{fields.treatmentDetails}</FieldError>
              ) : null}
            </div>

            <div>
              <FieldLabel htmlFor="record-notes">
                Clinical notes
              </FieldLabel>
              <Textarea
                id="record-notes"
                value={clinicalNotes}
                onChange={(event) => setClinicalNotes(event.target.value)}
                placeholder="Optional observations…"
                maxLength={5000}
              />
              {fields.clinicalNotes ? (
                <FieldError id="record-notes-error">{fields.clinicalNotes}</FieldError>
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
            disabled={busy || !canSubmit}
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
            Create record
          </Button>
        </div>
      </div>
    </div>
  );
}
