import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

type BadgeProps = ComponentProps<"span"> & {
  variant?: "primary" | "muted" | "accent";
};

export function Badge({ className, variant = "primary", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium tracking-tight",
        variant === "primary" && "bg-mint text-primary",
        variant === "muted" && "bg-line-soft text-ink/70",
        variant === "accent" && "bg-accent/15 text-accent-deep",
        className,
      )}
      {...props}
    />
  );
}
