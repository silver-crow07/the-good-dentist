export type Doctor = {
  id: string;
  name: string;
  role: string;
  qualifications: string[];
  experience: string;
  expertise: string[];
  bio: string;
  image: string;
  /** True while the profile still uses bracketed placeholder content. */
  isPlaceholder: boolean;
};

/**
 * Placeholder dentist profiles — replace with the clinic's verified
 * qualifications and portraits before launch.
 *
 * Portraits are temporary stock photos (CC0) used only to exercise the
 * layout — they are not real clinicians. See `public/images/IMAGE_SOURCES.md`.
 */
export const doctors: Doctor[] = [
  {
    id: "dentist-01",
    name: "Dr. [Dentist Name]",
    role: "Dentist",
    qualifications: ["BDS", "[Additional Qualification]"],
    experience: "[X]+ years of clinical experience",
    expertise: [
      "[Area of expertise]",
      "[Area of expertise]",
      "[Area of expertise]",
    ],
    bio: "Experienced in providing patient-focused dental care with a gentle approach.",
    image: "/images/doctors/doctor-portrait-1.jpg",
    isPlaceholder: true,
  },
  {
    id: "dentist-02",
    name: "Dr. [Associate Dentist Name]",
    role: "Dentist",
    qualifications: ["BDS", "[Additional Qualification]"],
    experience: "[X]+ years of clinical experience",
    expertise: ["[Area of expertise]", "[Area of expertise]"],
    bio: "Experienced in providing patient-focused dental care with a gentle approach.",
    image: "/images/doctors/doctor-portrait-2.jpg",
    isPlaceholder: true,
  },
];

export function getFeaturedDoctor(): Doctor {
  return doctors[0];
}
