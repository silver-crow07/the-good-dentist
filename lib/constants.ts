/**
 * Single source of truth for clinic configuration.
 *
 * Contact details, address, coordinates, opening hours and the WhatsApp number
 * below were confirmed by the client and are safe to publish.
 *
 * Still pending (do NOT invent): production domain, social profiles, dentist
 * photograph and introduction, per-treatment appointment durations.
 *
 * Nothing else in the app hardcodes clinic information — update it here and
 * every navbar, footer, page and link updates with it.
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

/* ------------------------------------------------------------------ *
 * Contact — confirmed by the client
 * ------------------------------------------------------------------ */

export const CLINIC_CONTACT_PERSON = "Dr. Nidhi Paliwal";

/** Digits only, international format without `+` — used to build wa.me links. */
export const CLINIC_WHATSAPP_NUMBER = "919180609088";

/** International format for display; `tel:` link uses the same digits. */
export const CLINIC_PHONE_NUMBER = "+91 9180609088";
export const CLINIC_PHONE_DIAL = "tel:+919180609088";

export const CLINIC_EMAIL = "nidhi.paliwal@gmail.com";
export const CLINIC_EMAIL_LINK = `mailto:${CLINIC_EMAIL}`;

export const CLINIC_ADDRESS =
  "The Good Dentist, First Floor, Alcove, Malhar Avenue, Kumbalgodu, Bengaluru, Karnataka 560074";

/** Structured address parts (derived from the same confirmed address). */
export const CLINIC_ADDRESS_PARTS = {
  street: "First Floor, Alcove, Malhar Avenue, Kumbalgodu, Bengaluru",
  region: "Karnataka",
  postalCode: "560074",
  country: "IN",
} as const;

/* ------------------------------------------------------------------ *
 * Opening hours — confirmed by the client
 * ------------------------------------------------------------------ */

export const CLINIC_WORKING_DAYS = "Monday–Saturday";
export const CLINIC_MORNING_SESSION = "9:00 AM–1:00 PM";
export const CLINIC_LUNCH_BREAK = "1:00 PM–4:00 PM";
export const CLINIC_EVENING_SESSION = "4:00 PM–9:00 PM";
export const CLINIC_WEEKLY_OFF = "Sunday";

/** Single-line schedule for compact areas (hero, footer, mobile menu). */
export const CLINIC_OPENING_HOURS = `${CLINIC_WORKING_DAYS}: ${CLINIC_MORNING_SESSION} and ${CLINIC_EVENING_SESSION} · ${CLINIC_WEEKLY_OFF}: Closed`;

/** Line-by-line schedule used on the contact page. */
export const CLINIC_HOURS_SCHEDULE = [
  `${CLINIC_WORKING_DAYS}: ${CLINIC_MORNING_SESSION} and ${CLINIC_EVENING_SESSION}`,
  `Lunch break: ${CLINIC_LUNCH_BREAK}`,
  `${CLINIC_WEEKLY_OFF}: Closed`,
] as const;

/* ------------------------------------------------------------------ *
 * Location — confirmed by the client
 * ------------------------------------------------------------------ */

export const CLINIC_COORDINATES = {
  latitude: 12.88949,
  longitude: 77.466219,
} as const;

/** `lat,lng` — accepted by the Google Maps search / directions endpoints. */
export const CLINIC_MAP_QUERY = "12.889490,77.466219";

/** Opens the clinic location on Google Maps (no API key required). */
export const CLINIC_MAP_URL = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
  CLINIC_MAP_QUERY,
)}`;

/** Turn-by-turn directions to the clinic on Google Maps. */
export const CLINIC_DIRECTIONS_URL = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
  CLINIC_MAP_QUERY,
)}`;

/**
 * Temporary stock photography (CC0 / free-license). Replace with real clinic
 * photography when the client supplies it. Sources & licenses are listed in
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
