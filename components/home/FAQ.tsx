"use client";

import { useState } from "react";

import { FAQItem } from "@/components/shared/FAQItem";
import { Reveal } from "@/components/shared/Reveal";
import { SectionHeading } from "@/components/shared/SectionHeading";
import { faqs } from "@/data/faq";

export function FAQ() {
  const [openId, setOpenId] = useState<string | null>(faqs[0]?.id ?? null);

  return (
    <section
      id="faq"
      aria-labelledby="faq-heading"
      className="section-pad bg-surface"
    >
      <div className="container-page grid gap-10 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-16">
        <Reveal>
          <SectionHeading
            id="faq-heading"
            eyebrow="FAQ"
            title="Questions, answered."
            description="A quick guide to booking, timings and contacting the clinic."
          />
        </Reveal>

        <Reveal delay={100} className="flex flex-col gap-3">
          {faqs.map((faq) => (
            <FAQItem
              key={faq.id}
              id={faq.id}
              question={faq.question}
              answer={faq.answer}
              open={openId === faq.id}
              onToggle={() =>
                setOpenId((current) => (current === faq.id ? null : faq.id))
              }
            />
          ))}
        </Reveal>
      </div>
    </section>
  );
}
