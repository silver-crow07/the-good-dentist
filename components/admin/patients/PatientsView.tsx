"use client";

/**
 * Patient directory (Phase C) — paginated list with debounced search over
 * name, phone and email, served by GET /api/admin/patients.
 *
 * Data flow mirrors AppointmentsView: ONE fetch key derived from
 * (search + page + reload token); an effect loads the list tagged with that
 * key, so a stale response can never render for a newer query (derived
 * loading: result.fetchKey must equal the current key).
 *
 * The Register button renders for ADMIN sessions only — the POST endpoint
 * re-checks with requireRole() regardless. No localStorage, no mock data.
 */

import { ChevronRight, RefreshCw, Search, UserPlus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { RegisterPatientDialog } from "@/components/admin/patients/RegisterPatientDialog";
import { Button } from "@/components/ui/button";
import { FieldLabel, Input } from "@/components/ui/field";
import {
  ApiClientError,
  fetchAdminPatients,
  type AdminPatientsResult,
} from "@/lib/client/admin";
import { formatClinicDate } from "@/lib/client/format";

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 300;

type DataState =
  | { fetchKey: string; status: "loading" }
  | { fetchKey: string; status: "error"; message: string }
  | { fetchKey: string; status: "ready"; result: AdminPatientsResult };

type PatientsViewProps = {
  /** Verified server-side session role; the API re-checks everything. */
  role: "ADMIN" | "STAFF";
};

export function PatientsView({ role }: PatientsViewProps) {
  const router = useRouter();

  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [reloadToken, setReloadToken] = useState(0);
  const [data, setData] = useState<DataState | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  /* ---------------- search debounce ---------------- */

  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(qInput.trim());
      setPage(1);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [qInput]);

  /* ---------------- one query key for the directory ---------------- */

  const fetchKey = useMemo(
    () => JSON.stringify({ q, page, reloadToken }),
    [q, page, reloadToken],
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchAdminPatients({ q, page, pageSize: PAGE_SIZE }, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setData({ fetchKey, status: "ready", result });
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
              : "Could not load patients. Please try again.",
        });
      });
    return () => controller.abort();
  }, [fetchKey, q, page]);

  // Derived loading: any result tagged with a different key is stale.
  const current = data && data.fetchKey === fetchKey ? data : null;
  const isLoading = !current || current.status === "loading";

  /* ---------------- handlers ---------------- */

  const retry = useCallback(() => setReloadToken((token) => token + 1), []);

  const handleCreated = (patient: { fullName: string }) => {
    setRegisterOpen(false);
    setNotice(`${patient.fullName} was registered successfully.`);
    setQInput("");
    setQ("");
    setPage(1);
    setReloadToken((token) => token + 1);
  };

  const hasSearch = q.length > 0;

  /* ---------------- render ---------------- */

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-ink">
            <Users aria-hidden="true" className="size-5 text-primary" />
            Patients
          </h1>
          <p className="mt-0.5 text-sm text-muted">
            Search by name, phone or email — open a record for history and notes.
          </p>
        </div>
        {role === "ADMIN" ? (
          <Button onClick={() => setRegisterOpen(true)} size="sm">
            <UserPlus aria-hidden="true" className="size-4" />
            Register patient
          </Button>
        ) : null}
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

      {/* Search */}
      <div className="rounded-2xl border border-line bg-card p-4 shadow-soft">
        <div className="max-w-lg">
          <FieldLabel htmlFor="patients-search">Search patients</FieldLabel>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
            />
            <Input
              id="patients-search"
              type="search"
              value={qInput}
              onChange={(event) => setQInput(event.target.value)}
              placeholder="Name, phone or email…"
              className="pl-9"
            />
          </div>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <PatientsListSkeleton />
      ) : current.status === "error" ? (
        <div
          role="alert"
          className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl border border-line bg-card px-6 py-10 text-center shadow-soft"
        >
          <RefreshCw aria-hidden="true" className="size-9 text-muted" />
          <p className="text-sm font-medium text-ink">Could not load patients</p>
          <p className="text-sm leading-relaxed text-muted">{current.message}</p>
          <Button onClick={retry} variant="outline" size="sm" className="mt-1">
            <RefreshCw aria-hidden="true" className="size-4" />
            Try again
          </Button>
        </div>
      ) : (
        <PatientsTable
          result={current.result}
          onPage={setPage}
          onSelect={(id) => router.push(`/admin/patients/${id}`)}
          emptyTitle={hasSearch ? "No patients match your search" : "No patients yet"}
          emptyHint={
            hasSearch
              ? "Try a different name, phone number or email."
              : role === "ADMIN"
                ? "Register the first patient to build the directory."
                : "Registered patients will appear here."
          }
        />
      )}

      {/* Register dialog (ADMIN) */}
      {registerOpen && role === "ADMIN" ? (
        <RegisterPatientDialog
          onClose={() => setRegisterOpen(false)}
          onCreated={handleCreated}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Table
 * ------------------------------------------------------------------ */

type PatientsTableProps = {
  result: AdminPatientsResult;
  onPage: (page: number) => void;
  onSelect: (id: string) => void;
  emptyTitle: string;
  emptyHint: string;
};

function PatientsTable({
  result,
  onPage,
  onSelect,
  emptyTitle,
  emptyHint,
}: PatientsTableProps) {
  const { patients, pagination, timezone } = result;

  if (patients.length === 0) {
    return (
      <section className="flex flex-col rounded-2xl border border-line bg-card shadow-soft">
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
          <Users aria-hidden="true" className="size-9 text-muted/60" />
          <p className="text-sm font-medium text-ink">{emptyTitle}</p>
          <p className="max-w-sm text-sm leading-relaxed text-muted">{emptyHint}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col rounded-2xl border border-line bg-card shadow-soft">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
              <th scope="col" className="px-5 py-3 font-semibold">Patient</th>
              <th scope="col" className="px-5 py-3 font-semibold">Phone</th>
              <th scope="col" className="px-5 py-3 font-semibold">Email</th>
              <th scope="col" className="px-5 py-3 font-semibold">Registered</th>
              <th scope="col" className="px-5 py-3 text-right font-semibold">Visits</th>
              <th scope="col" className="px-5 py-3 text-right font-semibold">
                <span className="sr-only">Open profile</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {patients.map((patient) => (
              <tr
                key={patient.id}
                onClick={() => onSelect(patient.id)}
                className="cursor-pointer transition-colors hover:bg-mint/50"
              >
                <td className="px-5 py-3.5 font-medium text-ink">{patient.fullName}</td>
                <td className="whitespace-nowrap px-5 py-3.5 text-ink/80">{patient.phone}</td>
                <td className="px-5 py-3.5 text-ink/80">
                  {patient.email ?? <span className="text-muted">—</span>}
                </td>
                <td className="whitespace-nowrap px-5 py-3.5 text-muted">
                  {formatClinicDate(patient.createdAt, timezone)}
                </td>
                <td className="whitespace-nowrap px-5 py-3.5 text-right tabular-nums text-ink/80">
                  {patient.appointmentCount}
                </td>
                <td className="px-5 py-3.5 text-right">
                  <button
                    type="button"
                    aria-label={`Open profile for ${patient.fullName}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(patient.id);
                    }}
                    className="inline-flex items-center gap-1 rounded-full border border-line bg-white px-3 py-1 text-xs font-medium text-ink transition-colors hover:border-primary/40 hover:text-primary"
                  >
                    Open
                    <ChevronRight aria-hidden="true" className="size-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3.5">
        <p className="text-xs text-muted">
          <span className="font-semibold text-ink tabular-nums">{pagination.total}</span>{" "}
          patient{pagination.total === 1 ? "" : "s"} · page{" "}
          <span className="font-semibold text-ink tabular-nums">{pagination.page}</span> of{" "}
          <span className="font-semibold text-ink tabular-nums">{pagination.totalPages}</span>
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={pagination.page <= 1}
            onClick={() => onPage(pagination.page - 1)}
            aria-label="Previous page"
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={pagination.page >= pagination.totalPages}
            onClick={() => onPage(pagination.page + 1)}
            aria-label="Next page"
          >
            Next
          </Button>
        </div>
      </div>
    </section>
  );
}

/** Loading placeholder for the table view. */
export function PatientsListSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="animate-pulse rounded-2xl border border-line bg-card p-5 shadow-soft"
    >
      <span className="sr-only">Loading patients…</span>
      <div className="space-y-3">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex items-center gap-4">
            <div className="h-4 w-36 rounded bg-line-soft" />
            <div className="h-4 w-28 rounded bg-line-soft" />
            <div className="h-4 w-44 rounded bg-line-soft" />
            <div className="ml-auto h-6 w-20 rounded-full bg-line-soft" />
          </div>
        ))}
      </div>
    </div>
  );
}
