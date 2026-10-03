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
    image: "/images/dr-portrait-1.svg",
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
    image: "/images/dr-portrait-2.svg",
    isPlaceholder: true,
  },
];

export function getFeaturedDoctor(): Doctor {
  return doctors[0];
}
