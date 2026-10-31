import {
  CLINIC_ADDRESS_PARTS,
  CLINIC_COORDINATES,
  CLINIC_EMAIL,
  CLINIC_NAME,
  CLINIC_PHONE_DIAL,
  SITE_URL,
} from "@/lib/constants";

/**
 * LocalBusiness (Dentist) JSON-LD built only from client-confirmed details in
 * `lib/constants.ts`. Opening hours reflect the confirmed schedule:
 * Mon–Sat 9:00–13:00 and 16:00–21:00, Sunday closed.
 */
export function buildDentistStructuredData() {
  return {
    "@context": "https://schema.org",
    "@type": "Dentist",
    name: CLINIC_NAME,
    url: SITE_URL,
    telephone: CLINIC_PHONE_DIAL.replace("tel:", ""),
    email: CLINIC_EMAIL,
    address: {
      "@type": "PostalAddress",
      streetAddress: CLINIC_ADDRESS_PARTS.street,
      addressRegion: CLINIC_ADDRESS_PARTS.region,
      postalCode: CLINIC_ADDRESS_PARTS.postalCode,
      addressCountry: CLINIC_ADDRESS_PARTS.country,
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: CLINIC_COORDINATES.latitude,
      longitude: CLINIC_COORDINATES.longitude,
    },
    openingHoursSpecification: [
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: [
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
        ],
        opens: "09:00",
        closes: "13:00",
      },
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: [
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
        ],
        opens: "16:00",
        closes: "21:00",
      },
    ],
  };
}
