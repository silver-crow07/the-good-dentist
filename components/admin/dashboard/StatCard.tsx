import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type Tone = "default" | "primary" | "warning" | "muted";

type StatCardProps = {
  label: string;
  value: string | number;
  hint?: string;
  icon: LucideIcon;
  tone?: Tone;
};

const TONE_CHIP: Record<Tone, string> = {
  default: "bg-mint text-primary",
  primary: "bg-primary text-white",
  warning: "bg-amber-50 text-amber-700",
  muted: "bg-line-soft text-ink/60",
};

/** Dashboard metric card — label, big number, optional hint line, icon. */
export function StatCard({ label, value, hint, icon: Icon, tone = "default" }: StatCardProps) {
  return (
    <div className="rounded-2xl border border-line bg-card p-5 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-muted">{label}</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight text-ink tabular-nums">
            {value}
          </p>
          {hint ? (
            <p className="mt-1.5 truncate text-xs text-muted">{hint}</p>
          ) : null}
        </div>
        <span
          aria-hidden="true"
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl",
            TONE_CHIP[tone],
          )}
        >
          <Icon className="size-5" />
        </span>
      </div>
    </div>
  );
}
