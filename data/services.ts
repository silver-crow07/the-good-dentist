import {
  Activity,
  Anchor,
  Baby,
  Gem,
  Ruler,
  Sparkles,
  Stethoscope,
  Sun,
  type LucideIcon,
} from "lucide-react";

export type Service = {
  slug: string;
  title: string;
  shortDescription: string;
  overview: string;
  icon: LucideIcon;
  /** Indicative appointment length in minutes — powers mock slot blocking. */
  durationMinutes: number;
  highlights: string[];
  image: string;
  featured: boolean;
};

/**
 * Editable service catalogue. Replace copy/details with the clinic's verified
 * offerings — UI components never hardcode service content.
 */
export const services: Service[] = [
  {
    slug: "general-dentistry",
    title: "General Dentistry",
    shortDescription:
      "Check-ups, diagnostics and everyday care that keep teeth and gums healthy.",
    overview:
      "General dentistry is the foundation of a healthy smile. Visits focus on understanding the current state of your oral health, answering questions honestly and planning any treatment with you before it begins.",
    icon: Stethoscope,
    durationMinutes: 30,
    highlights: [
      "Routine dental examinations",
      "Diagnostics and treatment planning",
      "Fillings and preventive care",
      "Personalised oral hygiene guidance",
    ],
    image: "/images/treatment-room.svg",
    featured: true,
  },
  {
    slug: "dental-cleaning",
    title: "Dental Cleaning",
    shortDescription:
      "Professional scaling and polishing for a fresher, cleaner smile.",
    overview:
      "A professional cleaning removes build-up that daily brushing cannot reach, and gives the team a chance to check the health of your gums while they work.",
    icon: Sparkles,
    durationMinutes: 45,
    highlights: [
      "Scaling and polishing",
      "Gum health assessment",
      "Surface stain removal",
      "Home-care recommendations",
    ],
    image: "/images/dental-equipment.svg",
    featured: true,
  },
  {
    slug: "root-canal-treatment",
    title: "Root Canal Treatment",
    shortDescription:
      "Careful, comfort-focused treatment for an infected tooth.",
    overview:
      "Root canal treatment is designed to preserve your natural tooth when the inner tissue is affected. The team explains each stage in advance and works at a pace that keeps you comfortable.",
    icon: Activity,
    durationMinutes: 60,
    highlights: [
      "Step-by-step explanations before treatment",
      "Comfort-focused approach",
      "Tooth-preserving treatment",
      "Post-treatment follow-up guidance",
    ],
    image: "/images/treatment-room.svg",
    featured: true,
  },
  {
    slug: "dental-implants",
    title: "Dental Implants",
    shortDescription:
      "A considered, long-term option for replacing a missing tooth.",
    overview:
      "Implant treatment replaces a missing tooth with a fixed restoration. It begins with a careful assessment so that every option — including alternatives — can be discussed clearly.",
    icon: Anchor,
    durationMinutes: 60,
    highlights: [
      "Missing-tooth assessment",
      "Treatment options compared",
      "Restoration planning",
      "Ongoing maintenance advice",
    ],
    image: "/images/dental-equipment.svg",
    featured: true,
  },
  {
    slug: "teeth-whitening",
    title: "Teeth Whitening",
    shortDescription:
      "Brighten your smile with a supervised, enamel-conscious approach.",
    overview:
      "Professional whitening is planned around your enamel and sensitivity history, so results are approached carefully rather than aggressively.",
    icon: Sun,
    durationMinutes: 45,
    highlights: [
      "Supervised whitening treatment",
      "Sensitivity-conscious protocols",
      "Shade assessment",
      "Aftercare guidance",
    ],
    image: "/images/patient-care.svg",
    featured: true,
  },
  {
    slug: "cosmetic-dentistry",
    title: "Cosmetic Dentistry",
    shortDescription:
      "Subtle, natural-looking refinements planned around your features.",
    overview:
      "Cosmetic dentistry covers the details of a smile — shape, shade and symmetry. Every plan starts with a conversation about what you would like to change.",
    icon: Gem,
    durationMinutes: 60,
    highlights: [
      "Smile assessment and planning",
      "Veneers and bonding",
      "Natural-looking finishing",
      "Clear, staged options",
    ],
    image: "/images/reception.svg",
    featured: true,
  },
  {
    slug: "braces-and-aligners",
    title: "Braces & Aligners",
    shortDescription:
      "Guided teeth straightening planned for comfort and clarity.",
    overview:
      "Straightening treatment is planned around your lifestyle and goals, with regular checks so progress stays predictable from start to finish.",
    icon: Ruler,
    durationMinutes: 30,
    highlights: [
      "Braces and aligner options reviewed",
      "Progress check-ups",
      "Retention guidance",
      "Family-friendly scheduling",
    ],
    image: "/images/patient-care.svg",
    featured: true,
  },
  {
    slug: "childrens-dentistry",
    title: "Children's Dentistry",
    shortDescription:
      "Friendly, unhurried visits that help children feel at ease.",
    overview:
      "Early visits are kept simple and calm, helping children build a comfortable relationship with the clinic while parents stay informed.",
    icon: Baby,
    durationMinutes: 30,
    highlights: [
      "Gentle first visits",
      "Preventive care for growing teeth",
      "Parent-friendly explanations",
      "Habit and hygiene guidance",
    ],
    image: "/images/patient-care.svg",
    featured: false,
  },
];

export function getServiceBySlug(slug: string): Service | undefined {
  return services.find((service) => service.slug === slug);
}

export function getFeaturedServices(): Service[] {
  return services.filter((service) => service.featured);
}
