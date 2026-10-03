export type Testimonial = {
  id: string;
  quote: string;
  author: string;
  context: string;
  /** Placeholder content — replace with real, permissioned patient feedback. */
  isPlaceholder: boolean;
};

export const testimonials: Testimonial[] = [
  {
    id: "testimonial-01",
    quote:
      "Very warm and professional experience from start to finish. Everything was explained clearly before anything began.",
    author: "Patient Name",
    context: "Placeholder testimonial",
    isPlaceholder: true,
  },
  {
    id: "testimonial-02",
    quote:
      "The clinic felt calm and spotless, and the team made sure I was comfortable throughout the visit.",
    author: "Patient Name",
    context: "Placeholder testimonial",
    isPlaceholder: true,
  },
  {
    id: "testimonial-03",
    quote:
      "Booking was simple and the team followed up to confirm the appointment quickly and courteously.",
    author: "Patient Name",
    context: "Placeholder testimonial",
    isPlaceholder: true,
  },
  {
    id: "testimonial-04",
    quote:
      "An unhurried visit with an honest explanation of the options available. I appreciated the transparency.",
    author: "Patient Name",
    context: "Placeholder testimonial",
    isPlaceholder: true,
  },
];
