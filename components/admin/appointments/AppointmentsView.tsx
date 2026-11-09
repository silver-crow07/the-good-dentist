"use client";

/**
 * Appointments workspace (Phase B) — List / Day / Week / Month views over
 * the existing appointment APIs.
 *
 * Data flow: the view derives ONE fetch key from (view + filters + page +
 * anchor + reload token); an effect loads GET /api/admin/appointments with
 * that key and stores the result tagged with it, so a stale response can
 * never render for a newer query (derived loading: result.fetchKey must
 * equal the current key). All mutations happen in the details dialog
 * through the existing audited endpoints and bump the reload token here.
 *
 * No localStorage, no mock data — every number comes from the server.
 */

import {
  CalendarClock,
  CalendarDays,
  CalendarRange,
  ClipboardList,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  AppointmentsCalendar,
  calendarLabel,
  CalendarNavButtons,
  type CalendarView,
} from "@/components/admin/appointments/AppointmentsCalendar";
import { AppointmentDetails } from "@/components/admin/appointments/AppointmentDetails";
import {
  AppointmentsList,
  AppointmentsListSkeleton,
} from "@/components/admin/appointments/AppointmentsList";
import { Button } from "@/components/ui/button";
import { FieldLabel, Input, Select } from "@/components/ui/field";
import {
  addDaysKey,
  monthGridKeys,
  partsOfDateKey,
  shiftMonthKey,
  startOfWeekKey,
} from "@/lib/admin/calendar";
import {
  ApiClientError,
  fetchAdminAppointmentOptions,
  fetchAdminAppointments,
  type AdminAppointmentOptions,
  type AdminAppointmentsParams,
  type AdminAppointmentsResult,
  type AppointmentStatusKey,
} from "@/lib/client/admin";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 300;

type ViewMode = CalendarView;
type StatusFilter = "" | AppointmentStatusKey;

type MetaState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; options: AdminAppointmentOptions };

type DataState =
  | { fetchKey: string; status: "loading" }
  | { fetchKey: string; status: "error"; message: string }
  | { fetchKey: string; status: "ready"; result: AdminAppointmentsResult };

const TABS: Array<{ key: ViewMode; label: string; icon: typeof CalendarDays }> = [
  { key: "list", label: "List", icon: ClipboardList },
  { key: "day", label: "Day", icon: CalendarDays },
  { key: "week", label: "Week", icon: CalendarRange },
  { key: "month", label: "Month", icon: CalendarClock },
];

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "", label: "All statuses" },
  { value: "PENDING", label: "Pending" },
  { value: "CONFIRMED", label: "Confirmed" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "NO_SHOW", label: "No-show" },
];

/** Clinic-local window each calendar view fetches. */
function rangeFor(view: ViewMode, anchorKey: string): { from: string; to: string } | null {
  if (view === "day") return { from: anchorKey, to: anchorKey };
  if (view === "week") {
    const start = startOfWeekKey(anchorKey);
    return { from: start, to: addDaysKey(start, 6) };
  }
  if (view === "month") {
    const { year, month } = partsOfDateKey(anchorKey);
    const grid = monthGridKeys(year, month);
    return { from: grid[0], to: grid[grid.length - 1] };
  }
  return null;
}

type ParsedKey = {
  q: string;
  status: string;
  doctorSlug: string;
  serviceSlug: string;
  reloadToken: number;
} & (
  | { v: "list"; page: number; date: string }
  | { v: "day" | "week" | "month"; from: string; to: string }
);

function toParams(parsed: ParsedKey): AdminAppointmentsParams {
  const filters = {
    ...(parsed.q ? { q: parsed.q } : {}),
    ...(parsed.status ? { status: parsed.status as AppointmentStatusKey } : {}),
    ...(parsed.doctorSlug ? { doctorSlug: parsed.doctorSlug } : {}),
    ...(parsed.serviceSlug ? { serviceSlug: parsed.serviceSlug } : {}),
  };
  if (parsed.v === "list") {
    return {
      page: parsed.page,
      pageSize: PAGE_SIZE,
      ...(parsed.date ? { date: parsed.date } : {}),
      ...filters,
    };
  }
  return { from: parsed.from, to: parsed.to, ...filters };
}

export function AppointmentsView() {
  const [meta, setMeta] = useState<MetaState>({ status: "loading" });

  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [doctorSlug, setDoctorSlug] = useState("");
  const [serviceSlug, setServiceSlug] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [page, setPage] = useState(1);
  const [view, setView] = useState<ViewMode>("list");
  const [anchorKey, setAnchorKey] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [data, setData] = useState<DataState | null>(null);

  /* ---------------- options (once) ---------------- */

  const fetchMeta = useCallback((signal?: AbortSignal) => {
    fetchAdminAppointmentOptions(signal)
      .then((options) => {
        if (signal?.aborted) return;
        setMeta({ status: "ready", options });
        setAnchorKey((current) => current || options.today);
      })
      .catch((error: unknown) => {
        if (signal?.aborted) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        setMeta({
          status: "error",
          message:
            error instanceof ApiClientError
              ? error.message
              : "Could not load the appointments workspace.",
        });
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchMeta(controller.signal);
    return () => controller.abort();
  }, [fetchMeta]);

  const retryMeta = useCallback(() => {
    setMeta({ status: "loading" });
    fetchMeta();
  }, [fetchMeta]);

  /* ---------------- search debounce ---------------- */

  useEffect(() => {
    const timer = setTimeout(() => setQ(qInput.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [qInput]);

  /* ---------------- one query key for the current view ---------------- */

  const fetchKey = useMemo(() => {
    if (meta.status !== "ready") return null;
    if (!anchorKey && view !== "list") return null;
    const shared = { q, status: statusFilter, doctorSlug, serviceSlug };
    if (view === "list") {
      return JSON.stringify({
        v: "list",
        page,
        date: dateFilter,
        ...shared,
        reloadToken,
      } satisfies ParsedKey);
    }
    const range = rangeFor(view, anchorKey);
    if (!range) return null;
    return JSON.stringify({ v: view, ...range, ...shared, reloadToken } satisfies ParsedKey);
  }, [meta.status, anchorKey, view, page, dateFilter, q, statusFilter, doctorSlug, serviceSlug, reloadToken]);

  useEffect(() => {
    if (!fetchKey) return;
    const controller = new AbortController();
    const params = toParams(JSON.parse(fetchKey) as ParsedKey);
    fetchAdminAppointments(params, controller.signal)
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
              : "Could not load appointments. Please try again.",
        });
      });
    return () => controller.abort();
  }, [fetchKey]);

  // Derived loading: any result tagged with a different key is stale.
  const current = data && fetchKey && data.fetchKey === fetchKey ? data : null;
  const isLoading = Boolean(fetchKey) && (!current || current.status === "loading");

  /* ---------------- handlers ---------------- */

  const resetPageAnd = (apply: () => void) => {
    apply();
    setPage(1);
  };

  const changeView = (next: ViewMode) => {
    setView(next);
    setPage(1);
  };

  const openDay = (dateKey: string) => {
    setView("day");
    setAnchorKey(dateKey);
    setPage(1);
  };

  const navigate = (direction: -1 | 1) => {
    setAnchorKey((anchor) => {
      if (!anchor) return anchor;
      if (view === "day") return addDaysKey(anchor, direction);
      if (view === "week") return addDaysKey(anchor, direction * 7);
      return shiftMonthKey(anchor, direction);
    });
  };

  const retryData = () => setReloadToken((token) => token + 1);

  const hasActiveFilters = Boolean(q || statusFilter || doctorSlug || serviceSlug || dateFilter);
  const clearFilters = () =>
    resetPageAnd(() => {
      setQInput("");
      setQ("");
      setStatusFilter("");
      setDoctorSlug("");
      setServiceSlug("");
      setDateFilter("");
    });

  /* ---------------- render ---------------- */

  if (meta.status === "loading") {
    return <WorkspaceSkeleton />;
  }

  if (meta.status === "error") {
    return (
      <div
        role="alert"
        className="mx-auto mt-10 flex max-w-md flex-col items-center gap-3 rounded-2xl border border-line bg-card px-6 py-10 text-center shadow-soft"
      >
        <RefreshCw aria-hidden="true" className="size-9 text-muted" />
        <p className="text-sm font-medium text-ink">Could not load appointments</p>
        <p className="text-sm leading-relaxed text-muted">{meta.message}</p>
        <Button onClick={retryMeta} variant="outline" size="sm" className="mt-1">
          <RefreshCw aria-hidden="true" className="size-4" />
          Try again
        </Button>
      </div>
    );
  }

  const { options } = meta;
  const labels = view === "list" ? null : calendarLabel(view, anchorKey);

  return (
    <div className="space-y-4">
      {/* View tabs + calendar navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Appointment views" className="flex rounded-xl border border-line bg-white p-1 shadow-soft">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = view === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => changeView(tab.key)}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active ? "bg-primary text-white shadow-soft" : "text-muted hover:text-ink",
                )}
              >
                <Icon aria-hidden="true" className="size-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {labels ? (
          <CalendarNavButtons
            label={labels.label}
            compactLabel={labels.compact}
            onPrev={() => navigate(-1)}
            onNext={() => navigate(1)}
            onToday={() => setAnchorKey(options.today)}
          />
        ) : null}
      </div>

      {/* Filters */}
      <div className="rounded-2xl border border-line bg-card p-4 shadow-soft">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="xl:col-span-1">
            <FieldLabel htmlFor="appointments-search">Search</FieldLabel>
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
              />
              <Input
                id="appointments-search"
                type="search"
                value={qInput}
                onChange={(event) => setQInput(event.target.value)}
                placeholder="Patient name or phone…"
                className="pl-9"
              />
            </div>
          </div>

          <div>
            <FieldLabel htmlFor="appointments-status">Status</FieldLabel>
            <Select
              id="appointments-status"
              value={statusFilter}
              onChange={(event) =>
                resetPageAnd(() => setStatusFilter(event.target.value as StatusFilter))
              }
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <FieldLabel htmlFor="appointments-doctor">Doctor</FieldLabel>
            <Select
              id="appointments-doctor"
              value={doctorSlug}
              onChange={(event) => resetPageAnd(() => setDoctorSlug(event.target.value))}
            >
              <option value="">All doctors</option>
              {options.doctors.map((doctor) => (
                <option key={doctor.slug} value={doctor.slug}>
                  {doctor.name}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <FieldLabel htmlFor="appointments-service">Treatment</FieldLabel>
            <Select
              id="appointments-service"
              value={serviceSlug}
              onChange={(event) => resetPageAnd(() => setServiceSlug(event.target.value))}
            >
              <option value="">All treatments</option>
              {options.services.map((service) => (
                <option key={service.slug} value={service.slug}>
                  {service.name}
                </option>
              ))}
            </Select>
          </div>

          {view === "list" ? (
            <div>
              <FieldLabel htmlFor="appointments-date">Date</FieldLabel>
              <Input
                id="appointments-date"
                type="date"
                value={dateFilter}
                onChange={(event) => resetPageAnd(() => setDateFilter(event.target.value))}
              />
            </div>
          ) : null}
        </div>

        {hasActiveFilters ? (
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-line-soft pt-3">
            <p className="flex items-center gap-1.5 text-xs text-muted">
              <SlidersHorizontal aria-hidden="true" className="size-3.5" />
              Filters active
            </p>
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X aria-hidden="true" className="size-4" />
              Clear filters
            </Button>
          </div>
        ) : null}
      </div>

      {/* Content */}
      {isLoading ? (
        view === "list" || view === "day" ? (
          <AppointmentsListSkeleton />
        ) : (
          <CalendarSkeleton />
        )
      ) : current?.status === "error" ? (
        <div
          role="alert"
          className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl border border-line bg-card px-6 py-10 text-center shadow-soft"
        >
          <RefreshCw aria-hidden="true" className="size-9 text-muted" />
          <p className="text-sm font-medium text-ink">Could not load appointments</p>
          <p className="text-sm leading-relaxed text-muted">{current.message}</p>
          <Button onClick={retryData} variant="outline" size="sm" className="mt-1">
            <RefreshCw aria-hidden="true" className="size-4" />
            Try again
          </Button>
        </div>
      ) : current?.status === "ready" ? (
        view === "list" || view === "day" ? (
          <AppointmentsList
            result={current.result}
            timezone={options.timezone}
            timeOnly={view === "day"}
            onSelect={(appointment) => setSelectedId(appointment.publicId)}
            onPage={setPage}
            emptyTitle={hasActiveFilters ? "No appointments match these filters" : "No appointments yet"}
            emptyHint={
              hasActiveFilters
                ? "Try a different search term, status or date."
                : "New bookings and confirmed appointments will appear here."
            }
          />
        ) : (
          <AppointmentsCalendar
            view={view}
            anchorKey={anchorKey}
            todayKey={options.today}
            result={current.result}
            timezone={options.timezone}
            onSelect={(appointment) => setSelectedId(appointment.publicId)}
            onOpenDay={openDay}
          />
        )
      ) : null}

      {/* Details dialog */}
      {selectedId ? (
        <AppointmentDetails
          publicId={selectedId}
          timezone={options.timezone}
          todayKey={options.today}
          onClose={() => setSelectedId(null)}
          onUpdated={retryData}
        />
      ) : null}
    </div>
  );
}

function WorkspaceSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite" className="animate-pulse space-y-4">
      <span className="sr-only">Loading appointments workspace…</span>
      <div className="h-10 w-72 rounded-xl bg-line-soft" />
      <div className="h-24 rounded-2xl bg-card" />
      <div className="h-72 rounded-2xl bg-card" />
    </div>
  );
}

function CalendarSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite" className="animate-pulse rounded-2xl border border-line bg-card p-4 shadow-soft">
      <span className="sr-only">Loading calendar…</span>
      <div className="grid grid-cols-7 gap-2">
        {Array.from({ length: 42 }, (_, i) => (
          <div key={i} className="h-16 rounded-lg bg-line-soft" />
        ))}
      </div>
    </div>
  );
}
