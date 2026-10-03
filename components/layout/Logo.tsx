import Link from "next/link";

import { CLINIC_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";

/** Brand tooth mark — kept inline so it stays crisp at every size. */
export function ToothMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      className={cn("size-full", className)}
    >
      <path
        d="M16 5.6c-3.1-2.5-7.4-3-9.7-.5C3.8 7.9 4.1 12.4 5.4 16.1c1 3 2.1 5.3 2.7 8.6.5 2.7 1 5 2.1 5 1.4 0 1.9-2.5 2.4-4.8.6-2.7 1.4-4.4 3.4-4.4s2.8 1.7 3.4 4.4c.5 2.3 1 4.8 2.4 4.8 1.1 0 1.6-2.3 2.1-5 .6-3.3 1.7-5.6 2.7-8.6C27.9 12.4 28.2 7.9 25.7 5.1c-2.3-2.5-6.6-2-9.7.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

type LogoProps = {
  className?: string;
  /** Hide the wordmark on the smallest breakpoints (mobile menu usage). */
  href?: string;
};

export function Logo({ className, href = "/" }: LogoProps) {
  return (
    <Link
      href={href}
      aria-label={`${CLINIC_NAME} — home`}
      className={cn("group flex items-center gap-2.5", className)}
    >
      <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-white shadow-soft transition-transform duration-300 group-hover:-translate-y-0.5 sm:size-10">
        <ToothMark className="size-5 sm:size-[1.35rem]" />
      </span>
      <span className="flex flex-col leading-none">
        <span className="whitespace-nowrap text-[0.9rem] font-semibold tracking-[0.14em] text-ink sm:text-[0.95rem]">
          THE GOOD <span className="text-primary">DENTIST</span>
        </span>
        <span className="mt-1 text-[0.58rem] uppercase tracking-[0.3em] text-muted">
          Dental Clinic
        </span>
      </span>
    </Link>
  );
}
