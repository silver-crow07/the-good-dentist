export type Doctor = {
  id: string;
  name: string;
  role: string;
  qualifications: string[];
  /** Confirmed experience summary, e.g. "15 years of clinical experience". */
  experience: string;
  /** Confirmed areas of practice only — never invent additional entries. */
  expertise: string[];
  /** Short introduction — pending from the client; hidden until supplied. */
  bio?: string;
  /** Portrait path. Pending real photo; a labelled stock stand-in is used. */
  image: string;
  /** True while `image` is a stock stand-in, not a photo of this dentist. */
  isPhotoPlaceholder: boolean;
};

/**
 * Dentist profiles with client-confirmed details (name, qualifications,
 * specialization, experience).
 *
 * Still pending from the client: professional photograph and short
 * introduction (`bio` is optional and hidden when absent). The current image
 * is a temporary CC0 stock photo (see `public/images/IMAGE_SOURCES.md`) and
 * is never presented as an actual photograph of the dentist.
 */
export const doctors: Doctor[] = [
  {
    id: "dr-nidhi-paliwal",
    name: "Dr. Nidhi Paliwal",
    role: "Dentist",
    qualifications: ["BDS", "PGDMLS", "PGDHM"],
    experience: "15 years of clinical experience",
    expertise: ["Root Canal Treatment"],
    image: "/images/doctors/doctor-portrait-1.jpg",
    isPhotoPlaceholder: true,
  },
];

export function getFeaturedDoctor(): Doctor {
  return doctors[0];
}
