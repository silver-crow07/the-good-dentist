"use client";

/**
 * One dental record (Phase D) — diagnosis, treatment details, notes and
 * its private image files, served by GET /api/admin/dental-records/[id].
 *
 * Upload is three client steps, all server-verified:
 *   1. POST /files            → presigned PUT (server reserved the key),
 *   2. PUT bytes straight to R2 (signed headers, private bucket),
 *   3. POST /files/[id]/complete → server re-reads the object (size +
 *      magic bytes) and decides AVAILABLE vs REJECTED itself.
 *
 * Downloads use the audited presigned-GET endpoint — no public URLs ever
 * exist. ADMIN only; the API re-checks every action with requireRole().
 */

import {
  ArrowLeft,
  Eye,
  FileText,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Stethoscope,
  Trash2,
  Upload,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { EditRecordDialog } from "@/components/admin/dental-records/EditRecordDialog";
import { Button } from "@/components/ui/button";
import {
  ApiClientError,
  completeDentalFile,
  deleteAdminDentalRecord,
  deleteDentalFile,
  fetchAdminDentalRecord,
  fetchDentalFileUrl,
  initDentalFile,
  type AdminDentalFile,
  type AdminDentalRecordDetail,
} from "@/lib/client/admin";
import { formatClinicDate, formatClinicDateKey } from "@/lib/client/format";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png"] as const;

type DataState =
  | { fetchKey: string; status: "loading" }
  | { fetchKey: string; status: "error"; message: string }
  | { fetchKey: string; status: "ready"; detail: AdminDentalRecordDetail };

type DentalRecordDetailViewProps = {
  recordId: string;
  /** Verified server-side session role; the API re-checks everything. */
  role: "ADMIN" | "STAFF";
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const STATUS_LABELS: Record<AdminDentalFile["status"], string> = {
  PENDING: "Verifying",
  AVAILABLE: "Ready",
  REJECTED: "Rejected",
  DELETING: "Deleting",
};

const STATUS_CLASSES: Record<AdminDentalFile["status"], string> = {
  PENDING: "bg-amber-50 text-amber-700 border-amber-200",
  AVAILABLE: "bg-mint text-primary-deep border-primary/25",
  REJECTED: "bg-red-50 text-red-700 border-red-200",
  DELETING: "bg-line-soft text-muted border-line",
};

export function DentalRecordDetailView({ recordId, role }: DentalRecordDetailViewProps) {
  const router = useRouter();

  const [reloadToken, setReloadToken] = useState(0);
  const [data, setData] = useState<DataState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pendingFileId, setPendingFileId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchKey = useMemo(() => JSON.stringify({ recordId, reloadToken }), [recordId, reloadToken]);

  useEffect(() => {
    const controller = new AbortController();
    fetchAdminDentalRecord(recordId, controller.signal)
      .then((detail) => {
        if (controller.signal.aborted) return;
        setData({ fetchKey, status: "ready", detail });
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
              : "Could not load this record. Please try again.",
        });
      });
    return () => controller.abort();
  }, [fetchKey, recordId]);

  const current = data && data.fetchKey === fetchKey ? data : null;
  const isLoading = !current || current.status === "loading";

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  /* ---------------- upload flow ---------------- */

  async function handleFileSelected(file: File | undefined) {
    if (!file) return;
    setUploadError(null);

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const extOk = ext === "jpg" || ext === "jpeg" || ext === "png";
    const typeOk = (ALLOWED_TYPES as readonly string[]).includes(file.type);
    if (!extOk || !typeOk) {
      setUploadError("Only JPEG or PNG images are allowed.");
      return;
    }
    if (file.size === 0) {
      setUploadError("That file is empty.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError("Files must be 10 MB or smaller.");
      return;
    }

    setUploading(true);
    try {
      // 1. Reserve the row + server-generated key, get the signed PUT.
      const ticket = await initDentalFile(recordId, {
        originalName: file.name.slice(0, 255),
        contentType: file.type,
        byteSize: file.size,
      });
      // 2. Bytes go DIRECTLY to the private bucket (signed headers).
      const put = await fetch(ticket.upload.url, {
        method: ticket.upload.method,
        headers: ticket.upload.headers,
        body: file,
      });
      if (!put.ok) {
        throw new Error(`Storage upload failed (${put.status}).`);
      }
      // 3. Server verifies the stored object itself.
      const completed = await completeDentalFile(ticket.id);
      if (completed.status === "REJECTED") {
        setUploadError(
          "The upload was rejected during verification — the file was not a valid image of the declared type.",
        );
      } else {
        setNotice(`“${file.name}” uploaded and verified.`);
      }
      reload();
    } catch (error) {
      if (error instanceof ApiClientError) {
        setUploadError(error.message);
      } else {
        setUploadError(
          error instanceof Error
            ? error.message
            : "The upload could not be completed. Please try again.",
        );
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  /* ---------------- file actions ---------------- */

  async function handleView(file: AdminDentalFile) {
    setActionError(null);
    setPendingFileId(file.id);
    try {
      const signed = await fetchDentalFileUrl(file.id);
      window.open(signed.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setActionError(
        error instanceof ApiClientError
          ? error.message
          : "Could not open the image. Please try again.",
      );
    } finally {
      setPendingFileId(null);
    }
  }

  async function handleDeleteFile(file: AdminDentalFile) {
    if (!window.confirm(`Delete “${file.originalName}”? This cannot be undone.`)) return;
    setActionError(null);
    setPendingFileId(file.id);
    try {
      const result = await deleteDentalFile(file.id);
      setNotice(
        result.deleted
          ? `“${file.originalName}” was deleted.`
          : `“${file.originalName}” was queued for deletion — cleanup will finish it shortly.`,
      );
      reload();
    } catch (error) {
      setActionError(
        error instanceof ApiClientError
          ? error.message
          : "The file could not be deleted. Please try again.",
      );
    } finally {
      setPendingFileId(null);
    }
  }

  async function handleDeleteRecord() {
    if (
      !window.confirm(
        "Delete this dental record and all of its images? This cannot be undone.",
      )
    ) {
      return;
    }
    setActionError(null);
    try {
      await deleteAdminDentalRecord(recordId);
      router.push("/admin/dental-records");
    } catch (error) {
      setActionError(
        error instanceof ApiClientError
          ? error.message
          : "The record could not be deleted. Please try again.",
      );
    }
  }

  /* ---------------- render ---------------- */

  if (isLoading) {
    return (
      <div
        aria-busy="true"
        aria-live="polite"
        className="animate-pulse space-y-4 rounded-2xl border border-line bg-card p-5 shadow-soft"
      >
        <span className="sr-only">Loading dental record…</span>
        <div className="h-5 w-64 rounded bg-line-soft" />
        <div className="h-4 w-96 max-w-full rounded bg-line-soft" />
        <div className="h-32 w-full rounded bg-line-soft" />
      </div>
    );
  }

  if (current.status === "error") {
    return (
      <div
        role="alert"
        className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl border border-line bg-card px-6 py-10 text-center shadow-soft"
      >
        <RefreshCw aria-hidden="true" className="size-9 text-muted" />
        <p className="text-sm font-medium text-ink">Could not load this record</p>
        <p className="text-sm leading-relaxed text-muted">{current.message}</p>
        <div className="mt-1 flex gap-2">
          <Button onClick={reload} variant="outline" size="sm">
            <RefreshCw aria-hidden="true" className="size-4" />
            Try again
          </Button>
          <Button onClick={() => router.push("/admin/dental-records")} variant="ghost" size="sm">
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back to records
          </Button>
        </div>
      </div>
    );
  }

  const { detail } = current;
  const { record, files, filesTotal, truncated, timezone } = detail;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={() => router.push("/admin/dental-records")}
            className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            <ArrowLeft aria-hidden="true" className="size-3.5" />
            All records
          </button>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-ink">
            <Stethoscope aria-hidden="true" className="size-5 text-primary" />
            {record.patientName}
          </h1>
          <p className="mt-0.5 text-sm text-muted">
            {formatClinicDateKey(record.treatmentDate)} · {formatClinicDate(record.updatedAt, timezone)}
            {record.author ? ` · by ${record.author}` : ""}
          </p>
        </div>
        {role === "ADMIN" ? (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil aria-hidden="true" className="size-4" />
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-red-600 hover:bg-red-50 hover:text-red-700"
              onClick={() => void handleDeleteRecord()}
            >
              <Trash2 aria-hidden="true" className="size-4" />
              Delete record
            </Button>
          </div>
        ) : null}
      </div>

      {/* Notices */}
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
      {actionError || uploadError ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <span>{actionError ?? uploadError}</span>
          <button
            type="button"
            onClick={() => {
              setActionError(null);
              setUploadError(null);
            }}
            aria-label="Dismiss error"
            className="text-xs font-medium text-red-700 hover:underline"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {/* Record body */}
      <section className="rounded-2xl border border-line bg-card p-5 shadow-soft">
        <h2 className="text-sm font-semibold text-ink">Diagnosis</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-ink/85">{record.diagnosis}</p>
        <h2 className="mt-4 text-sm font-semibold text-ink">Treatment details</h2>
        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-ink/85">
          {record.treatmentDetails}
        </p>
        {record.clinicalNotes ? (
          <>
            <h2 className="mt-4 flex items-center gap-1.5 text-sm font-semibold text-ink">
              <FileText aria-hidden="true" className="size-4 text-primary" />
              Clinical notes
            </h2>
            <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-ink/85">
              {record.clinicalNotes}
            </p>
          </>
        ) : null}
      </section>

      {/* Files */}
      <section className="rounded-2xl border border-line bg-card p-5 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">X-rays &amp; images</h2>
            <p className="mt-0.5 text-xs text-muted">
              JPEG or PNG, up to 10 MB. Stored in private storage — images open through a
              short-lived signed link, never a public URL.
            </p>
          </div>
          {role === "ADMIN" ? (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,.jpg,.jpeg,.png"
                className="sr-only"
                onChange={(event) => void handleFileSelected(event.target.files?.[0])}
              />
              <Button
                size="sm"
                disabled={uploading}
                aria-busy={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? (
                  <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                ) : (
                  <Upload aria-hidden="true" className="size-4" />
                )}
                {uploading ? "Uploading…" : "Upload image"}
              </Button>
            </>
          ) : null}
        </div>

        {/* F-5 — never silently truncate: say exactly how many are hidden. */}
        {truncated ? (
          <p
            role="status"
            className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-700"
          >
            Showing the first {files.length} of {filesTotal} images —{" "}
            {filesTotal - files.length} more are not listed here. Uploads are limited per
            record; delete unused images to make room.
          </p>
        ) : null}

        {files.length === 0 ? (
          <div className="mt-4 flex flex-col items-center gap-2 rounded-xl border border-dashed border-line px-6 py-10 text-center">
            <Upload aria-hidden="true" className="size-8 text-muted/60" />
            <p className="text-sm font-medium text-ink">No images yet</p>
            <p className="max-w-sm text-xs leading-relaxed text-muted">
              {role === "ADMIN"
                ? "Upload an X-ray or clinical photo to attach it to this record."
                : "Images uploaded by the clinic will appear here."}
            </p>
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-line-soft overflow-hidden rounded-xl border border-line">
            {files.map((file) => (
              <li
                key={file.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink" title={file.originalName}>
                    {file.originalName}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {formatBytes(file.byteSize)} · {formatClinicDate(file.createdAt, timezone)}
                  </p>
                </div>
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_CLASSES[file.status]}`}
                >
                  {STATUS_LABELS[file.status]}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={file.status !== "AVAILABLE" || pendingFileId === file.id}
                    onClick={() => void handleView(file)}
                    aria-label={`View ${file.originalName}`}
                  >
                    {pendingFileId === file.id ? (
                      <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                    ) : (
                      <Eye aria-hidden="true" className="size-4" />
                    )}
                    View
                  </Button>
                  {role === "ADMIN" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pendingFileId === file.id}
                      onClick={() => void handleDeleteFile(file)}
                      aria-label={`Delete ${file.originalName}`}
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                      Delete
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Edit dialog (ADMIN) */}
      {editOpen && role === "ADMIN" ? (
        <EditRecordDialog
          detail={detail}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false);
            setNotice("Record updated.");
            reload();
          }}
        />
      ) : null}
    </div>
  );
}
