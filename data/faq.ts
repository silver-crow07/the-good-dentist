export type FAQ = {
  id: string;
  question: string;
  answer: string;
};

/**
 * Generic, editable answers. Keep responses factual and free of
 * clinical advice that would require an examination.
 */
export const faqs: FAQ[] = [
  {
    id: "faq-booking",
    question: "How do I book an appointment?",
    answer:
      "You can book online through our appointment page by choosing a treatment, date and time, or message us on WhatsApp. Either way, the clinic team will contact you to confirm the appointment.",
  },
  {
    id: "faq-walkins",
    question: "Do you accept walk-ins?",
    answer:
      "Walk-ins are accommodated when the schedule allows. Booking ahead is recommended so we can reserve enough time specifically for you.",
  },
  {
    id: "faq-duration",
    question: "How long does a dental consultation take?",
    answer:
      "Treatment times vary by procedure — provisional durations are shown for each treatment on the appointment page, and your dentist will confirm the exact timing.",
  },
  {
    id: "faq-cleaning",
    question: "How often should I get a dental cleaning?",
    answer:
      "Many patients schedule a cleaning every six months, but the right interval depends on your individual oral health. Your dentist will suggest a rhythm during your visit.",
  },
  {
    id: "faq-contact",
    question: "How can I contact the clinic?",
    answer:
      "Call or message us on WhatsApp using the number on our contact page, or send us an email. We reply during clinic hours, Monday to Saturday.",
  },
];
