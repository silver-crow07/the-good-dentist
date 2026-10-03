import { Award, Heart, ShieldCheck, Zap, type LucideIcon } from "lucide-react";

export type TrustItem = {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
};

export const trustItems: TrustItem[] = [
  {
    id: "experienced-care",
    title: "Experienced Dental Care",
    description: "Thoughtful care from qualified professionals.",
    icon: Award,
  },
  {
    id: "modern-approach",
    title: "Modern Treatment Approach",
    description: "Current techniques and well-kept technology.",
    icon: Zap,
  },
  {
    id: "patient-centred",
    title: "Patient-Centred Care",
    description: "Your comfort and questions shape the visit.",
    icon: Heart,
  },
  {
    id: "comfort-focused",
    title: "Comfort-Focused Experience",
    description: "Calm surroundings and an unhurried pace.",
    icon: ShieldCheck,
  },
];
