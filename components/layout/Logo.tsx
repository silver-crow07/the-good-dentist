import Link from "next/link";

import { CLINIC_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";

/**
 * Official The Good Dentist logo assets.
 *
 * `LOGO_SRC` is the single swap point for the brand mark. The current file is a
 * vector stand-in traced from the supplied logo. To drop in the real artwork,
 * copy it to `public/images/branding/the-good-dentist-logo.png` (or `.webp`)
 * and update the path below — nothing else in the app needs to change.
 *
 * The full square logo (frame + tagline) stays available at
 * `public/images/branding/the-good-dentist-logo.svg` for print, social cards
 * and future dashboard use.
 */
export const LOGO_SRC = "/images/branding/the-good-dentist-logo-horizontal.svg";
export const LOGO_SQUARE_SRC = "/images/branding/the-good-dentist-logo.svg";

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
      className={cn("group flex items-center", className)}
    >
      {/*
        Official logo — rendered at a fixed height so the original aspect ratio
        is always preserved. `object-contain` guarantees no stretching or
        cropping; the link's aria-label carries the accessible name.

        Plain `<img>` on purpose: `next/image` refuses SVGs unless they are
        listed in `images.dangerouslyAllowSVG`, and this asset must stay a
        byte-exact copy of the official logo.
      */}
      {/* eslint-disable-next-line @next/next/no-img-element -- SVG logo; see note above */}
      <img
        src={LOGO_SRC}
        alt=""
        aria-hidden="true"
        height={44}
        className="h-9 w-auto max-w-[9.5rem] object-contain object-left transition-transform duration-300 group-hover:-translate-y-0.5 sm:h-11 sm:max-w-[11rem]"
      />
    </Link>
  );
}
