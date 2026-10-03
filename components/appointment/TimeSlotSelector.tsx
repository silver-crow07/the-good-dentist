"use client";

import { CircleCheck, CircleSlash } from "lucide-react";

import {
  SLOT_STATUS_LABELS,
  type AppointmentSlot,
} from "@/lib/appointment";
import { cn } from "@/lib/utils";

type TimeSlotSelectorProps = {
  slots: AppointmentSlot[];
  value: string;
  onChange: (time: string) => void;
};

export function TimeSlotSelector({
  slots,
  value,
  onChange,
}: TimeSlotSelectorProps) {
  const availableCount = slots.filter((slot) => slot.available).length;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p
          id="slot-legend-label"
          className="text-sm font-medium text-ink"
        >
          Available times
        </p>
        <ul
          aria-labelledby="slot-legend-label"
          className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted"
        >
          <li className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-primary-soft" aria-hidden="true" />
            {SLOT_STATUS_LABELS.available}
          </li>
          <li className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-primary" aria-hidden="true" />
            {SLOT_STATUS_LABELS.selected}
          </li>
          <li className="flex items-center gap-1.5">
            <span
              className="size-2.5 rounded-full bg-muted/40"
              aria-hidden="true"
            />
            {SLOT_STATUS_LABELS.unavailable}
          </li>
        </ul>
      </div>

      <div
        role="group"
        aria-label="Choose an appointment time"
        className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
      >
        {slots.map((slot) => {
          const selected = slot.time === value;
          const status = selected
            ? SLOT_STATUS_LABELS.selected
            : slot.available
              ? SLOT_STATUS_LABELS.available
              : SLOT_STATUS_LABELS.unavailable;

          return (
            <button
              key={slot.time}
              type="button"
              disabled={!slot.available}
              aria-pressed={selected}
              aria-label={`${slot.time} — ${status}`}
              onClick={() => onChange(slot.time)}
              className={cn(
                "flex flex-col items-start gap-1 rounded-xl border px-4 py-3 text-left transition duration-200",
                !slot.available &&
                  "cursor-not-allowed border-line-soft bg-line-soft/60 text-muted/50",
                slot.available &&
                  !selected &&
                  "border-line bg-white text-ink hover:-translate-y-0.5 hover:border-primary/50 hover:bg-mint",
                selected && "border-primary bg-primary text-white shadow-soft",
              )}
            >
              <span className="flex items-center gap-2 text-sm font-semibold tracking-tight">
                {slot.time}
                {slot.available && !selected ? (
                  <CircleCheck aria-hidden="true" className="size-3.5 text-primary-soft" />
                ) : null}
                {!slot.available ? (
                  <CircleSlash aria-hidden="true" className="size-3.5" />
                ) : null}
              </span>
              <span
                className={cn(
                  "text-[0.65rem] font-medium uppercase tracking-[0.12em]",
                  selected
                    ? "text-white"
                    : slot.available
                      ? "text-primary"
                      : "text-muted/70",
                )}
              >
                {status}
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-4 text-xs text-muted">
        {availableCount} of {slots.length} slots available for this day. Slots are
        shown in 30-minute intervals and reserve the full treatment time.
      </p>
    </div>
  );
}
