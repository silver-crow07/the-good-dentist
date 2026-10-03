import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge conditional class names with Tailwind conflict resolution. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Detect bracketed placeholder content such as `[Clinic Address]`. */
export function isPlaceholder(value: string): boolean {
  return value.startsWith("[") && value.endsWith("]");
}

/** Normalise a phone string to digits so it can be used in `tel:` / `wa.me` links. */
export function toDialableNumber(value: string): string {
  return value.replace(/[^0-9]/g, "");
}
