"use client";

/**
 * Dental-record history (Phase D) — served by GET /api/admin/dental-records.
 *
 * Data flow mirrors PatientsView: ONE fetch key derived from
 * (search + date range + page + reload token); a stale response can never
 * render for a newer query. The date range filters on the clinic-local
 * treatment date (inclusive). ADMIN only — the API re-checks with
 * requireRole() regardless of what the UI shows.
 */

import {
  ChevronRight,
  CirclePlus,
  FileText,
  RefreshCw,
  Search,
  Stethoscope,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { CleanupCard } from "@/components/admin/dental-records/CleanupCard";
import { CreateRecordDialog } from "@/components/admin/dental-records/CreateRecordDialog";
import { Button } from "@/components/ui/button";
import { FieldLabel, Input } from "@/components/ui/field";
import {
  ApiClientError,
  fetchAdminDentalRecords,
  type AdminDentalRecordsResult,
} from "@/lib/client/admin";
import { formatClinicDateKey } from "@/lib/client/format";

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 300;

type DataState =
  | { fetchKey: string; status: "loading" }
  | { fetchKey: string; status: "error"; message: string }
  | { fetchKey: string; status: "ready"; result: AdminDentalRecordsResult };

type DentalRecordsViewProps = {
  /** Verified server-side session role; the API re-checks everything. */
  role: "ADMIN" | "STAFF";
};

export function DentalRecordsView({ role }: DentalRecordsViewProps) {
  const router = useRouter();

  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [reloadToken, setReloadToken] = useState(0);
  const [data, setData] = useState<DataState | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  /* ---------------- search debounce ---------------- */

  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(qInput.trim());
      setPage(1);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [qInput]);

  /* ---------------- one query key for the list ---------------- */

  const fetchKey = useMemo(
    () => JSON.stringify({ q, from, to, page, reloadToken }),
    [q, from, to, page, reloadToken],
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchAdminDentalRecords(
      { q, from, to, page, pageSize: PAGE_SIZE },
      controller.signal,
    )
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
              : "Could not load dental records. Please try again.",
        });
      });
    return () => controller.abort();
  }, [fetchKey, q, from, to, page]);

  // Derived loading: any result tagged with a different key is stale.
  const current = data && data.fetchKey === fetchKey ? data : null;
  const isLoading = !current || current.status === "loading";

  /* ---------------- handlers ---------------- */

  const retry = useCallback(() => setReloadToken((token) => token + 1), []);

  const hasFilters = q.length > 0 || from.length > 0 || to.length > 0;

  const clearFilters = () => {
    setQInput("");
    setQ("");
    setFrom("");
    setTo("");
    setPage(1);
  };

  /* ---------------- render ---------------- */

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-ink">
            <Stethoscope aria-hidden="true" className="size-5 text-primary" />
            Dental records
          </h1>
          <p className="mt-0.5 text-sm text-muted">
            Chronological treatment history — filter by patient, date range or diagnosis.
          </p>
        </div>
        {role === "ADMIN" ? (
          <Button onClick={() => setCreateOpen(true)} size="sm">
            <CirclePlus aria-hidden="true" className="size-4" />
            New record
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

      {/* Filters */}
      <div className="rounded-2xl border border-line bg-card p-4 shadow-soft">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-56 flex-1">
            <FieldLabel htmlFor="records-search">Search</FieldLabel>
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
              />
              <Input
                id="records-search"
                type="search"
                value={qInput}
                onChange={(event) => setQInput(event.target.value)}
                placeholder="Diagnosis or patient name…"
                className="pl-9"
              />
            </div>
          </div>
          <div>
            <FieldLabel htmlFor="records-from">From</FieldLabel>
            <Input
              id="records-from"
              type="date"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
                setPage(1);
              }}
              className="w-40"
            />
          </div>
          <div>
            <FieldLabel htmlFor="records-to">To</FieldLabel>
            <Input
              id="records-to"
              type="date"
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
                setPage(1);
              }}
              className="w-40"
            />
          </div>
          {hasFilters ? (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear
            </Button>
          ) : null}
        </div>
      </div>

      {/* Cleanup (ADMIN) */}
      {role === "ADMIN" ? <CleanupCard /> : null}

      {/* Content */}
      {isLoading ? (
        <RecordsSkeleton />
      ) : current.status === "error" ? (
        <div
          role="alert"
          className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl border border-line bg-card px-6 py-10 text-center shadow-soft"
        >
          <RefreshCw aria-hidden="true" className="size-9 text-muted" />
          <p className="text-sm font-medium text-ink">Could not load dental records</p>
          <p className="text-sm leading-relaxed text-muted">{current.message}</p>
          <Button onClick={retry} variant="outline" size="sm" className="mt-1">
            <RefreshCw aria-hidden="true" className="size-4" />
            Try again
          </Button>
        </div>
      ) : (
        <RecordsTable
          result={current.result}
          onPage={setPage}
          onSelect={(id) => router.push(`/admin/dental-records/${id}`)}
          emptyTitle={hasFilters ? "No records match your filters" : "No dental records yet"}
          emptyHint={
            hasFilters
              ? "Try a different search term or date range."
              : role === "ADMIN"
                ? "Create the first record to start the treatment history."
                : "Records created by the clinic will appear here."
          }
        />
      )}

      {/* Create dialog (ADMIN) */}
      {createOpen && role === "ADMIN" ? (
        <CreateRecordDialog
          onClose={() => setCreateOpen(false)}
          onCreated={(record) => {
            setCreateOpen(false);
            setNotice(`Record for ${record.patientName} was created.`);
            clearFilters();
            setReloadToken((token) => token + 1);
          }}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Table
 * ------------------------------------------------------------------ */

type RecordsTableProps = {
  result: AdminDentalRecordsResult;
  onPage: (page: number) => void;
  onSelect: (id: string) => void;
  emptyTitle: string;
  emptyHint: string;
};

function RecordsTable({ result, onPage, onSelect, emptyTitle, emptyHint }: RecordsTableProps) {
  const { records, pagination } = result;

  if (records.length === 0) {
    return (
      <section className="flex flex-col rounded-2xl border border-line bg-card shadow-soft">
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
          <FileText aria-hidden="true" className="size-9 text-muted/60" />
          <p className="text-sm font-medium text-ink">{emptyTitle}</p>
          <p className="max-w-sm text-sm leading-relaxed text-muted">{emptyHint}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col rounded-2xl border border-line bg-card shadow-soft">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
              <th scope="col" className="px-5 py-3 font-semibold">Treatment date</th>
              <th scope="col" className="px-5 py-3 font-semibold">Patient</th>
              <th scope="col" className="px-5 py-3 font-semibold">Diagnosis</th>
              <th scope="col" className="px-5 py-3 text-right font-semibold">Files</th>
              <th scope="col" className="px-5 py-3 text-right font-semibold">
                <span className="sr-only">Open record</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {records.map((record) => (
              <tr
                key={record.id}
                onClick={() => onSelect(record.id)}
                className="cursor-pointer transition-colors hover:bg-mint/50"
              >
                <td className="whitespace-nowrap px-5 py-3.5 font-medium text-ink">
                  {formatClinicDateKey(record.treatmentDate)}
                </td>
                <td className="px-5 py-3.5 text-ink/80">{record.patientName}</td>
                <td className="max-w-64 truncate px-5 py-3.5 text-ink/80" title={record.diagnosis}>
                  {record.diagnosis}
                </td>
                <td className="whitespace-nowrap px-5 py-3.5 text-right tabular-nums text-ink/80">
                  {record.availableFileCount}
                  {record.fileCount !== record.availableFileCount ? (
                    <span className="text-muted"> / {record.fileCount}</span>
                  ) : null}
                </td>
                <td className="px-5 py-3.5 text-right">
                  <button
                    type="button"
                    aria-label={`Open record for ${record.patientName}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(record.id);
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
          record{pagination.total === 1 ? "" : "s"} · page{" "}
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

/** Loading placeholder for the list view. */
function RecordsSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="animate-pulse rounded-2xl border border-line bg-card p-5 shadow-soft"
    >
      <span className="sr-only">Loading dental records…</span>
      <div className="space-y-3">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex items-center gap-4">
            <div className="h-4 w-32 rounded bg-line-soft" />
            <div className="h-4 w-36 rounded bg-line-soft" />
            <div className="h-4 w-48 rounded bg-line-soft" />
            <div className="ml-auto h-6 w-20 rounded-full bg-line-soft" />
          </div>
        ))}
      </div>
    </div>
  );
}
