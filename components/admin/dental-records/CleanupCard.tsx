"use client";

/**
 * Manual storage-cleanup card (Phase D) — ADMIN only.
 *
 * "Sweep now" runs the throttled GET (Jobs B → A → C, no orphan scan);
 * "Full cleanup" runs the manual POST (Jobs A–D incl. the orphan
 * reconciler). The server enforces the lease (409 while another run is
 * live), item budgets and soft deadlines — this component only triggers
 * and displays the run summary.
 */

import { LoaderCircle, Package, RefreshCw } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ApiClientError, runDentalCleanup, type DentalCleanupRun } from "@/lib/client/admin";

const JOB_LABELS: Record<string, string> = {
  sweep: "Sweep (claim due files)",
  delete: "Delete (claimed files)",
  purge: "Purge (empty records)",
  reconcile: "Reconcile (orphans)",
};

function describeRun(run: DentalCleanupRun): string {
  const parts = run.jobs.map((job) => {
    const total = Object.values(job.counts).reduce((sum, count) => sum + count, 0);
    const skipped = job.skipped ? ` skipped:${job.skipped}` : "";
    return `${JOB_LABELS[job.job] ?? job.job} ${total}${skipped}`;
  });
  return parts.join(" · ");
}

export function CleanupCard() {
  const [busy, setBusy] = useState<"throttle" | "full" | null>(null);
  const [run, setRun] = useState<DentalCleanupRun | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function trigger(mode: "throttle" | "full") {
    if (busy) return;
    setBusy(mode);
    setError(null);
    try {
      const result = await runDentalCleanup(mode);
      setRun(result);
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : "Cleanup could not be started. Please try again.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-card p-4 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Package aria-hidden="true" className="size-4 text-primary" />
            Storage cleanup
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            Sweep claims and deletes due files; the full run additionally purges empty records and
            reconciles orphaned objects (48 h grace, private bucket only).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void trigger("throttle")}
            disabled={busy !== null}
            aria-busy={busy === "throttle"}
          >
            {busy === "throttle" ? (
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <RefreshCw aria-hidden="true" className="size-4" />
            )}
            Sweep now
          </Button>
          <Button
            size="sm"
            onClick={() => void trigger("full")}
            disabled={busy !== null}
            aria-busy={busy === "full"}
          >
            {busy === "full" ? (
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <RefreshCw aria-hidden="true" className="size-4" />
            )}
            Full cleanup
          </Button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}

      {run ? (
        <div role="status" className="mt-3 rounded-xl border border-primary/25 bg-mint px-3 py-2.5 text-xs text-ink">
          <p className="font-medium">
            Run finished — {run.stoppedBy === "complete" ? "all jobs complete" : `stopped by ${run.stoppedBy}`}.
          </p>
          <p className="mt-1 text-muted">{describeRun(run)}</p>
          {run.cursorCycleComplete ? (
            <p className="mt-1 text-muted">Orphan scan cycle completed (cursor reset).</p>
          ) : run.cursor ? (
            <p className="mt-1 text-muted">Orphan scan cursor: {run.cursor}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
