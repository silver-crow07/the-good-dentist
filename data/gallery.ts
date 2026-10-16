export type GalleryItem = {
  id: string;
  title: string;
  description: string;
  image: string;
  alt: string;
};

/**
 * Gallery images are temporary stock photos (CC0 / free license) standing in
 * for real clinic photography — see `public/images/IMAGE_SOURCES.md`.
 * Swap `image` paths for the clinic's own photos before launch.
 */
export const galleryItems: GalleryItem[] = [
  {
    id: "reception",
    title: "Reception",
    description: "A calm welcome the moment you arrive.",
    image: "/images/gallery/reception.jpg",
    alt: "Stock photo of a dental clinic reception desk, used as a temporary stand-in for The Good Dentist reception",
  },
  {
    id: "treatment-room",
    title: "Treatment Room",
    description: "Private suites prepared for every visit.",
    image: "/images/gallery/treatment-room.jpg",
    alt: "Stock photo of a dental treatment chair, used as a temporary stand-in for a treatment room at The Good Dentist",
  },
  {
    id: "dental-equipment",
    title: "Dental Equipment",
    description: "Modern, well-maintained technology.",
    image: "/images/gallery/dental-equipment.jpg",
    alt: "Stock photo of dental instruments laid out on a tray",
  },
  {
    id: "clinic-exterior",
    title: "Clinic Exterior",
    description: "Easy to find, easy to visit.",
    image: "/images/gallery/clinic-exterior.jpg",
    alt: "Stock photo of a modern clinic building exterior, used as a temporary stand-in",
  },
  {
    id: "team",
    title: "Our Team",
    description: "A coordinated, patient-first clinic team.",
    image: "/images/gallery/team.jpg",
    alt: "Stock photo of a small healthcare team in discussion, used as a temporary stand-in for the clinic team",
  },
  {
    id: "patient-care",
    title: "Patient Care",
    description: "Thoughtful care at every step.",
    image: "/images/gallery/patient-care.jpg",
    alt: "Stock photo of a clinician consulting with a patient",
  },
];
