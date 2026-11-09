"use client";

/**
 * Patient profile (Phase C) — complete record for one patient:
 *
 *  - Identity card with inline editing (ADMIN only, `permissions.canEdit`
 *    comes from the SERVER; the PATCH endpoint re-checks with requireRole)
 *  - Appointment history (read-only — appointment management lives in
 *    Phase B's workspace, this table only displays what the profile API
 *    already returns; mutations link across instead of duplicating)
 *  - Treatment history (COMPLETED appointments grouped per treatment)
 *  - Internal clinical notes — ADMIN add/view; STAFF sees a locked
 *    placeholder (the API strips note content server-side for STAFF)
 *
 * Data flow: ONE fetch key (patient id + reload token); stale responses
 * can never render for a newer query. No localStorage, no mock data.
 */

import {
  ArrowLeft,
  CalendarDays,
  FileText,
  Lock,
  Mail,
  NotebookPen,
  Pencil,
  Phone,
  RefreshCw,
  User,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { StatusBadge } from "@/components/admin/StatusBadge";
import { Button } from "@/components/ui/button";
import { FieldError, FieldLabel, Input, Textarea } from "@/components/ui/field";
import {
  ApiClientError,
  addClinicalNote,
  fetchAdminPatient,
  updateAdminPatient,
  type AdminPatientProfile,
} from "@/lib/client/admin";
import { formatClinicDate, formatClinicDateTime, formatRelativeTime } from "@/lib/client/format";

type DataState =
  | { fetchKey: string; status: "loading" }
  | { fetchKey: string; status: "error"; message: string }
  | { fetchKey: string; status: "ready"; profile: AdminPatientProfile };

type PatientProfileViewProps = {
  patientId: string;
  /** Verified server-side session role; the API re-checks everything. */
  role: "ADMIN" | "STAFF";
};

export function PatientProfileView({ patientId, role }: PatientProfileViewProps) {
  const [reloadToken, setReloadToken] = useState(0);
  const [data, setData] = useState<DataState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchKey = useMemo(
    () => JSON.stringify({ id: patientId, reloadToken }),
    [patientId, reloadToken],
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchAdminPatient(patientId, controller.signal)
      .then((profile) => {
        if (controller.signal.aborted) return;
        setData({ fetchKey, status: "ready", profile });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        setData({
          fetchKey,
          status: "error",
          message:
            error instanceof ApiClientError
              ? error.message
              : "Could not load this patient. Please try again.",
        });
      });
    return () => controller.abort();
  }, [fetchKey, patientId]);

  const current = data && data.fetchKey === fetchKey ? data : null;
  const retry = useCallback(() => setReloadToken((token) => token + 1), []);

  /* ---------------- render ---------------- */

  if (!current || current.status === "loading") {
    return <ProfileSkeleton />;
  }

  if (current.status === "error") {
    return (
      <div className="space-y-4">
        <BackLink />
        <div
          role="alert"
          className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl border border-line bg-card px-6 py-10 text-center shadow-soft"
        >
          <RefreshCw aria-hidden="true" className="size-9 text-muted" />
          <p className="text-sm font-medium text-ink">Could not load this patient</p>
          <p className="text-sm leading-relaxed text-muted">{current.message}</p>
          <Button onClick={retry} variant="outline" size="sm" className="mt-1">
            <RefreshCw aria-hidden="true" className="size-4" />
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const { profile } = current;

  return (
    <div className="space-y-4">
      <BackLink />

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-ink">
            <User aria-hidden="true" className="size-5 text-primary" />
            {profile.patient.fullName}
          </h1>
          <p className="mt-0.5 text-sm text-muted">
            {profile.patient.phone}
            {profile.patient.email ? ` · ${profile.patient.email}` : ""}
          </p>
        </div>
        <p className="rounded-full border border-line bg-white px-3 py-1 text-xs font-medium text-muted">
          {profile.patient.appointmentCount} appointment
          {profile.patient.appointmentCount === 1 ? "" : "s"} on record
        </p>
      </div>

      {/* Success notice */}
      {notice ? (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-xl border border-primary/25 bg-mint px-4 py-3 text-sm text-ink"
        >
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Dismiss notification"
            className="text-xs font-medium text-primary hover:underline"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Patient details */}
        <DetailsCard
          profile={profile}
          canEdit={profile.permissions.canEdit}
          onSaved={() => {
            setNotice("Patient details saved.");
            setReloadToken((token) => token + 1);
          }}
        />

        {/* Treatment history */}
        <section className="rounded-2xl border border-line bg-card shadow-soft">
          <CardHeader
            icon={FileText}
            title="Treatment history"
            hint="Completed treatments"
          />
          {profile.treatments.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-muted">
              No completed treatments yet.
            </p>
          ) : (
            <ul className="divide-y divide-line-soft px-5 pb-5">
              {profile.treatments.map((treatment) => (
                <li
                  key={treatment.service.slug}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-ink">{treatment.service.name}</p>
                    <p className="text-xs text-muted">
                      Last: {formatClinicDate(treatment.lastAt, profile.timezone)}
                    </p>
                  </div>
                  <span className="whitespace-nowrap rounded-full bg-mint px-3 py-1 text-xs font-semibold text-primary tabular-nums">
                    {treatment.sessions} session{treatment.sessions === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Appointment history */}
      <section className="rounded-2xl border border-line bg-card shadow-soft">
        <CardHeader
          icon={CalendarDays}
          title="Appointment history"
          hint="Newest first"
          action={
            <Link
              href="/admin/appointments"
              className="text-xs font-medium text-primary hover:underline"
            >
              Manage appointments
            </Link>
          }
        />
        {profile.appointments.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted">
            No appointments yet — bookings for this patient will appear here.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[42rem] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                  <th scope="col" className="px-5 py-3 font-semibold">When</th>
                  <th scope="col" className="px-5 py-3 font-semibold">Treatment</th>
                  <th scope="col" className="px-5 py-3 font-semibold">Doctor</th>
                  <th scope="col" className="px-5 py-3 font-semibold">Source</th>
                  <th scope="col" className="px-5 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {profile.appointments.map((appointment) => (
                  <tr key={appointment.publicId}>
                    <td className="whitespace-nowrap px-5 py-3.5 text-ink">
                      {formatClinicDateTime(appointment.startsAt, profile.timezone)}
                    </td>
                    <td className="px-5 py-3.5 text-ink/80">{appointment.service.name}</td>
                    <td className="px-5 py-3.5 text-ink/80">{appointment.doctor.name}</td>
                    <td className="px-5 py-3.5 text-muted">{appointment.source}</td>
                    <td className="px-5 py-3.5">
                      <StatusBadge status={appointment.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Clinical notes */}
      <ClinicalNotesCard
        profile={profile}
        role={role}
        onAdded={() => {
          setNotice("Clinical note added.");
          setReloadToken((token) => token + 1);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Pieces
 * ------------------------------------------------------------------ */

function BackLink() {
  return (
    <Link
      href="/admin/patients"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-primary"
    >
      <ArrowLeft aria-hidden="true" className="size-4" />
      Back to patients
    </Link>
  );
}

function CardHeader({
  icon: Icon,
  title,
  hint,
  action,
}: {
  icon: typeof FileText;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Icon aria-hidden="true" className="size-4 text-primary" />
        {title}
        {hint ? <span className="font-normal text-muted">· {hint}</span> : null}
      </h2>
      {action}
    </div>
  );
}

/* ---------------- details + inline edit ---------------- */

function DetailsCard({
  profile,
  canEdit,
  onSaved,
}: {
  profile: AdminPatientProfile;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const startEditing = () => {
    setFullName(profile.patient.fullName);
    setPhone(profile.patient.phone);
    setEmail(profile.patient.email ?? "");
    setFormError(null);
    setFields({});
    setEditing(true);
  };

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFormError(null);
    setFields({});
    try {
      const nextEmail = email.trim();
      await updateAdminPatient(profile.patient.id, {
        fullName: fullName.trim(),
        phone: phone.trim(),
        // Empty input CLEARS the address; the key is always present so a
        // cleared email is persisted, not silently kept.
        email: nextEmail === "" ? null : nextEmail,
      });
      setBusy(false);
      setEditing(false);
      onSaved();
    } catch (error) {
      if (error instanceof ApiClientError) {
        setFormError(error.fields ? null : error.message);
        setFields(error.fields ?? {});
      } else {
        setFormError("Could not save the changes. Please try again.");
      }
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-card shadow-soft">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <User aria-hidden="true" className="size-4 text-primary" />
          Patient details
        </h2>
        {canEdit && !editing ? (
          <Button variant="outline" size="sm" onClick={startEditing}>
            <Pencil aria-hidden="true" className="size-4" />
            Edit
          </Button>
        ) : null}
      </div>

      {editing ? (
        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
          <div>
            <FieldLabel htmlFor="edit-name" required>
              Full name
            </FieldLabel>
            <Input
              id="edit-name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              maxLength={120}
              autoComplete="off"
            />
            {fields.fullName ? (
              <FieldError id="edit-name-error">{fields.fullName}</FieldError>
            ) : null}
          </div>

          <div>
            <FieldLabel htmlFor="edit-phone" required>
              Phone
            </FieldLabel>
            <Input
              id="edit-phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              inputMode="tel"
              maxLength={30}
              autoComplete="off"
            />
            {fields.phone ? (
              <FieldError id="edit-phone-error">{fields.phone}</FieldError>
            ) : null}
          </div>

          <div>
            <FieldLabel htmlFor="edit-email">Email</FieldLabel>
            <Input
              id="edit-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Leave empty to remove the address"
              maxLength={200}
              autoComplete="off"
            />
            {fields.email ? (
              <FieldError id="edit-email-error">{fields.email}</FieldError>
            ) : null}
          </div>

          {formError ? (
            <p
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {formError}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-2 border-t border-line-soft pt-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setEditing(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={busy || !fullName.trim() || !phone.trim()}
              aria-busy={busy}
            >
              {busy ? (
                <RefreshCw aria-hidden="true" className="size-4 animate-spin" />
              ) : null}
              Save changes
            </Button>
          </div>
        </form>
      ) : (
        <dl className="grid gap-x-6 gap-y-4 px-5 py-4 sm:grid-cols-2">
          <Detail label="Full name" value={profile.patient.fullName} />
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted">Phone</dt>
            <dd className="mt-0.5 flex items-center gap-1.5 text-sm text-ink">
              <Phone aria-hidden="true" className="size-3.5 text-muted" />
              <a
                href={`tel:${profile.patient.phone.replace(/[^\d+]/g, "")}`}
                className="transition-colors hover:text-primary"
              >
                {profile.patient.phone}
              </a>
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted">Email</dt>
            <dd className="mt-0.5 flex items-center gap-1.5 text-sm text-ink">
              <Mail aria-hidden="true" className="size-3.5 text-muted" />
              {profile.patient.email ? (
                <a
                  href={`mailto:${profile.patient.email}`}
                  className="transition-colors hover:text-primary"
                >
                  {profile.patient.email}
                </a>
              ) : (
                <span className="text-muted">No email on record</span>
              )}
            </dd>
          </div>
          <Detail
            label="Registered"
            value={formatClinicDate(profile.patient.createdAt, profile.timezone)}
          />
          <Detail
            label="Last updated"
            value={formatRelativeTime(profile.patient.updatedAt)}
          />
        </dl>
      )}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{value}</dd>
    </div>
  );
}

/* ---------------- clinical notes ---------------- */

function ClinicalNotesCard({
  profile,
  role,
  onAdded,
}: {
  profile: AdminPatientProfile;
  role: "ADMIN" | "STAFF";
  onAdded: () => void;
}) {
  const canAdd = profile.permissions.canAddNotes && role === "ADMIN";
  const notes = profile.clinicalNotes;

  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !body.trim()) return;
    setBusy(true);
    setFormError(null);
    try {
      await addClinicalNote(profile.patient.id, body.trim());
      setBody("");
      setBusy(false);
      onAdded();
    } catch (error) {
      setFormError(
        error instanceof ApiClientError
          ? error.message
          : "Could not save the note. Please try again.",
      );
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-card shadow-soft">
      <CardHeader
        icon={NotebookPen}
        title="Clinical notes"
        hint={notes ? "Internal · ADMIN only" : undefined}
        action={
          notes && typeof profile.clinicalNotesTotal === "number" ? (
            <span className="rounded-full bg-mint px-3 py-1 text-xs font-semibold text-primary tabular-nums">
              {profile.clinicalNotesTotal}
            </span>
          ) : null
        }
      />

      {notes === null ? (
        /* STAFF — the server never sends note content for this role. */
        <div className="flex items-start gap-3 px-5 py-5 text-sm text-muted">
          <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <p className="leading-relaxed">
            Clinical notes are restricted to administrators. Contact an ADMIN if
            you need clinical context for this patient.
          </p>
        </div>
      ) : (
        <div className="px-5 py-4">
          {canAdd ? (
            <form onSubmit={handleSubmit} className="space-y-2">
              <FieldLabel htmlFor="clinical-note">Add a note</FieldLabel>
              <Textarea
                id="clinical-note"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder="Internal observation, follow-up, patient preference…"
                maxLength={2000}
              />
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted tabular-nums">{body.length}/2000</p>
                <Button
                  type="submit"
                  size="sm"
                  disabled={busy || body.trim().length === 0}
                  aria-busy={busy}
                >
                  {busy ? (
                    <RefreshCw aria-hidden="true" className="size-4 animate-spin" />
                  ) : (
                    <NotebookPen aria-hidden="true" className="size-4" />
                  )}
                  Save note
                </Button>
              </div>
              {formError ? (
                <p role="alert" className="text-sm font-medium text-red-600">
                  {formError}
                </p>
              ) : null}
            </form>
          ) : null}

          {notes.length === 0 ? (
            <p className="mt-4 text-sm text-muted">
              No clinical notes yet{canAdd ? " — add the first one above." : "."}
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {notes.map((note) => (
                <li
                  key={note.id}
                  className="rounded-xl border border-line-soft bg-white px-4 py-3"
                >
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">
                    {note.body}
                  </p>
                  <p className="mt-2 text-xs text-muted">
                    {note.author ?? "Former staff member"} ·{" "}
                    {formatClinicDateTime(note.createdAt, profile.timezone)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** Loading placeholder for the whole profile. */
function ProfileSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite" className="animate-pulse space-y-4">
      <span className="sr-only">Loading patient profile…</span>
      <div className="h-4 w-32 rounded bg-line-soft" />
      <div className="h-8 w-64 rounded bg-line-soft" />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-64 rounded-2xl bg-card" />
        <div className="h-64 rounded-2xl bg-card" />
      </div>
      <div className="h-72 rounded-2xl bg-card" />
    </div>
  );
}
