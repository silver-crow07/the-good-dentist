"use client";

/**
 * Dashboard view — loads GET /api/admin/stats (session-authorized) and
 * renders explicit loading / error / ready states. No data is cached in
 * localStorage; a refresh always re-reads the server.
 */

import {
  BadgeCheck,
  CalendarDays,
  CalendarRange,
  CircleAlert,
  CircleCheck,
  CircleX,
  Clock,
  RefreshCw,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ActivityFeed, UpcomingTable } from "@/components/admin/dashboard/DashboardTables";
import { StatusDonut, WeekBars } from "@/components/admin/dashboard/Charts";
import { StatCard } from "@/components/admin/dashboard/StatCard";
import { fetchAdminStats, type AdminStats } from "@/lib/client/admin";
import { ApiClientError } from "@/lib/client/appointments";
import { Button } from "@/components/ui/button";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; stats: AdminStats };

function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite" className="animate-pulse space-y-6">
      <span className="sr-only">Loading dashboard…</span>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="rounded-2xl border border-line bg-card p-5">
            <div className="h-4 w-24 rounded bg-line-soft" />
            <div className="mt-4 h-8 w-16 rounded bg-line-soft" />
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-64 rounded-2xl border border-line bg-card" />
        <div className="h-64 rounded-2xl border border-line bg-card" />
      </div>
    </div>
  );
}

export function DashboardView() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  /** Fetches and applies results in async callbacks (never synchronously). */
  const load = useCallback((signal?: AbortSignal) => {
    fetchAdminStats(signal)
      .then((stats) => {
        if (signal?.aborted) return;
        setState({ status: "ready", stats });
      })
      .catch((error: unknown) => {
        if (signal?.aborted) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({
          status: "error",
          message:
            error instanceof ApiClientError
              ? error.message
              : "Something went wrong while loading the dashboard.",
        });
      });
  }, []);

  /** Event-handler entry point: show the skeleton, then reload. */
  const reload = useCallback(() => {
    setState({ status: "loading" });
    load();
  }, [load]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (state.status === "loading") return <DashboardSkeleton />;

  if (state.status === "error") {
    return (
      <div
        role="alert"
        className="mx-auto mt-10 flex max-w-md flex-col items-center gap-3 rounded-2xl border border-line bg-card px-6 py-10 text-center shadow-soft"
      >
        <CircleAlert aria-hidden="true" className="size-9 text-red-600" />
        <p className="text-sm font-medium text-ink">Could not load the dashboard</p>
        <p className="text-sm leading-relaxed text-muted">{state.message}</p>
        <Button onClick={reload} variant="outline" size="sm" className="mt-1">
          <RefreshCw aria-hidden="true" className="size-4" />
          Try again
        </Button>
      </div>
    );
  }

  const { stats } = state;
  const todayDateLabel = new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${stats.today.date}T00:00:00Z`));

  return (
    <div className="space-y-6">
      {/* Context bar */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">
            Today at a glance
          </h2>
          <p className="mt-1 text-sm text-muted">
            {todayDateLabel} · clinic time ({stats.timezone})
          </p>
        </div>
        <Button
          onClick={reload}
          variant="ghost"
          size="sm"
          aria-label="Refresh dashboard data"
        >
          <RefreshCw aria-hidden="true" className="size-4" />
          Refresh
        </Button>
      </div>

      {/* Metric cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total appointments"
          value={stats.totals.appointments}
          hint="All time"
          icon={CalendarRange}
        />
        <StatCard
          label="Today's appointments"
          value={stats.today.total}
          hint={`${stats.today.PENDING} pending · ${stats.today.CONFIRMED} confirmed`}
          icon={CalendarDays}
          tone="primary"
        />
        <StatCard
          label="Pending requests"
          value={stats.byStatus.PENDING}
          hint="Awaiting confirmation"
          icon={Clock}
          tone="warning"
        />
        <StatCard
          label="Confirmed"
          value={stats.byStatus.CONFIRMED}
          hint="Upcoming + today"
          icon={BadgeCheck}
        />
        <StatCard
          label="Completed"
          value={stats.byStatus.COMPLETED}
          hint="Finished visits"
          icon={CircleCheck}
        />
        <StatCard
          label="Cancelled"
          value={stats.byStatus.CANCELLED}
          hint="Cancelled visits"
          icon={CircleX}
          tone="muted"
        />
        <StatCard
          label="Registered patients"
          value={stats.totals.patients}
          hint="Unique patient records"
          icon={Users}
        />
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-line bg-card p-5 shadow-soft">
          <h2 className="mb-4 text-sm font-semibold text-ink">Appointments by status</h2>
          <StatusDonut byStatus={stats.byStatus} />
        </section>
        <section className="rounded-2xl border border-line bg-card p-5 shadow-soft">
          <h2 className="mb-4 text-sm font-semibold text-ink">Next 7 days</h2>
          <WeekBars week={stats.week} />
        </section>
      </div>

      {/* Tables */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <UpcomingTable upcoming={stats.upcoming} timezone={stats.timezone} />
        </div>
        <ActivityFeed entries={stats.recentActivity} />
      </div>
    </div>
  );
}
