export type ProcessStep = {
  step: string;
  title: string;
  description: string;
};

export const processSteps: ProcessStep[] = [
  {
    step: "01",
    title: "Book Your Visit",
    description:
      "Choose a treatment, date and time online, or send us a message on WhatsApp.",
  },
  {
    step: "02",
    title: "Meet Your Dentist",
    description:
      "A calm consultation to understand your needs, answer questions and agree on next steps.",
  },
  {
    step: "03",
    title: "Begin Your Treatment",
    description:
      "Treatment starts once you are comfortable with the plan, at a pace that suits you.",
  },
];
