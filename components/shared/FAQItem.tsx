"use client";

import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

type FAQItemProps = {
  id: string;
  question: string;
  answer: string;
  open: boolean;
  onToggle: () => void;
};

export function FAQItem({ id, question, answer, open, onToggle }: FAQItemProps) {
  const panelId = `${id}-panel`;
  const buttonId = `${id}-button`;

  return (
    <div
      className={cn(
        "rounded-2xl border bg-white transition duration-300",
        open ? "border-primary/30 shadow-soft" : "border-line hover:border-primary/20",
      )}
    >
      <h3>
        <button
          type="button"
          id={buttonId}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className="flex w-full items-center justify-between gap-4 rounded-2xl px-5 py-4 text-left sm:px-6 sm:py-5"
        >
          <span className="text-base font-medium text-ink sm:text-[1.05rem]">
            {question}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "size-5 shrink-0 text-primary transition-transform duration-300",
              open && "rotate-180",
            )}
          />
        </button>
      </h3>

      <div
        id={panelId}
        role="region"
        aria-labelledby={buttonId}
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <p className="px-5 pb-5 text-sm leading-relaxed text-muted sm:px-6 sm:pb-6">
            {answer}
          </p>
        </div>
      </div>
    </div>
  );
}
