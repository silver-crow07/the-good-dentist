export type GalleryItem = {
  id: string;
  title: string;
  description: string;
  image: string;
  alt: string;
};

/** Swap `image` paths for real clinic photography when it is available. */
export const galleryItems: GalleryItem[] = [
  {
    id: "reception",
    title: "Reception",
    description: "A calm welcome the moment you arrive.",
    image: "/images/reception.svg",
    alt: "Placeholder image of The Good Dentist reception area",
  },
  {
    id: "treatment-room",
    title: "Treatment Room",
    description: "Private suites prepared for every visit.",
    image: "/images/treatment-room.svg",
    alt: "Placeholder image of a treatment room at The Good Dentist",
  },
  {
    id: "dental-equipment",
    title: "Dental Equipment",
    description: "Modern, well-maintained technology.",
    image: "/images/dental-equipment.svg",
    alt: "Placeholder image of dental equipment",
  },
  {
    id: "clinic-exterior",
    title: "Clinic Exterior",
    description: "Easy to find, easy to visit.",
    image: "/images/clinic-exterior.svg",
    alt: "Placeholder image of the clinic exterior",
  },
  {
    id: "team",
    title: "Our Team",
    description: "A coordinated, patient-first clinic team.",
    image: "/images/team.svg",
    alt: "Placeholder image of the clinic team",
  },
  {
    id: "patient-care",
    title: "Patient Care",
    description: "Thoughtful care at every step.",
    image: "/images/patient-care.svg",
    alt: "Placeholder image representing patient care",
  },
];
