/**
 * Single source of truth for clinic configuration.
 *
 * Every value below is a Phase 1 placeholder. Replace them with the real clinic
 * details (or read them from environment variables) when the backend phases land —
 * nothing else in the app hardcodes clinic information.
 */

export const SITE_NAME = "The Good Dentist";

/** Replace with the production domain (or set NEXT_PUBLIC_SITE_URL). */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://thegooddentist.example.com";

export const SITE_DESCRIPTION =
  "Thoughtful dental care in a welcoming environment — rooted in care, focused on your long-term oral health.";

export const CLINIC_NAME = "The Good Dentist";
export const CLINIC_WORDMARK = "the Good Dentist";
export const CLINIC_TAGLINE = "Rooted in care.";

/** Digits only, international format without `+` — used to build wa.me links. */
export const CLINIC_WHATSAPP_NUMBER = "10000000000";

/** Placeholder phone number used for both display and `tel:` links. */
export const CLINIC_PHONE_NUMBER = "+1 000 000 0000";
export const CLINIC_PHONE_DIAL = "tel:+10000000000";

export const CLINIC_ADDRESS = "[Clinic Address]";
export const CLINIC_OPENING_HOURS = "[Clinic Hours]";

/** Placeholder address used for map/directions links. */
export const CLINIC_MAP_QUERY = CLINIC_ADDRESS;

/**
 * Temporary stock photography (CC0 / free-license). Replace with real clinic
 * photography before launch. Sources & licenses are listed in
 * `public/images/IMAGE_SOURCES.md`.
 */
export const CLINIC_IMAGES = {
  hero: "/images/hero/hero-treatment-room.jpg",
  whyChooseUs: "/images/about/about-interior.jpg",
  aboutClinic: "/images/about/about-care.jpg",
  mapPlaceholder: "/images/map-placeholder.svg",
} as const;

export const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/services", label: "Services" },
  { href: "/doctors", label: "Our Dentist" },
  { href: "/contact", label: "Contact" },
] as const;

export const FOOTER_QUICK_LINKS = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/services", label: "Services" },
  { href: "/appointment", label: "Appointments" },
  { href: "/contact", label: "Contact" },
] as const;

export const BOOK_APPOINTMENT_HREF = "/appointment";
export const BOOK_APPOINTMENT_LABEL = "Book Appointment";
