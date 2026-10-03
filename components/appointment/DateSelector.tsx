"use client";

import { cn } from "@/lib/utils";
import type { BookingDate } from "@/lib/appointment";

type DateSelectorProps = {
  dates: BookingDate[];
  value: string;
  onChange: (iso: string) => void;
};

export function DateSelector({ dates, value, onChange }: DateSelectorProps) {
  return (
    <div>
      <div
        role="group"
        aria-label="Choose an appointment date"
        className="no-scrollbar -mx-1 flex gap-2.5 overflow-x-auto px-1 pb-2"
      >
        {dates.map((date) => {
          const selected = date.iso === value;

          return (
            <button
              key={date.iso}
              type="button"
              disabled={date.closed}
              aria-pressed={selected}
              aria-label={`${date.weekdayLong} ${Number(date.day)} ${date.monthLong}${
                date.closed ? " (clinic closed)" : ""
              }`}
              onClick={() => onChange(date.iso)}
              className={cn(
                "flex min-w-[4.5rem] flex-1 flex-col items-center gap-1 rounded-2xl border px-3 py-3.5 transition duration-200",
                date.closed &&
                  "cursor-not-allowed border-line-soft bg-line-soft/60 text-muted/50",
                !date.closed &&
                  !selected &&
                  "border-line bg-white text-ink hover:border-primary/50 hover:bg-mint",
                selected &&
                  "border-primary bg-primary text-white shadow-soft",
              )}
            >
              <span className="text-[0.68rem] font-semibold uppercase tracking-[0.1em] opacity-80">
                {date.weekdayShort}
              </span>
              <span className="text-lg font-semibold leading-none">
                {date.day}
              </span>
              <span className="text-[0.68rem] uppercase tracking-[0.06em] opacity-80">
                {date.closed ? "Closed" : date.monthShort}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
