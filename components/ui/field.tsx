import { ChevronDown } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

export const fieldBase =
  "w-full rounded-xl border border-line bg-white px-4 py-3 text-sm text-ink placeholder:text-muted/70 transition duration-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-line-soft";

export function FieldLabel({
  htmlFor,
  children,
  required,
}: {
  htmlFor: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
      {children}
      {required ? (
        <span aria-hidden="true" className="ml-1 text-primary">
          *
        </span>
      ) : (
        <span className="ml-1.5 text-xs font-normal text-muted">optional</span>
      )}
    </label>
  );
}

export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="text-xs font-medium text-red-600">
      {children}
    </p>
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(fieldBase, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(fieldBase, "min-h-32 resize-y", className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        className={cn(fieldBase, "appearance-none pr-11", className)}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 text-muted"
      />
    </div>
  );
}
