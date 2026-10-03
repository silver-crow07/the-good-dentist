import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type SectionHeadingProps = {
  id?: string;
  eyebrow?: string;
  title: ReactNode;
  description?: string;
  align?: "left" | "center";
  className?: string;
  as?: "h1" | "h2";
};

export function SectionHeading({
  id,
  eyebrow,
  title,
  description,
  align = "left",
  className,
  as: Heading = "h2",
}: SectionHeadingProps) {
  return (
    <div
      className={cn(
        "max-w-2xl",
        align === "center" && "mx-auto text-center",
        className,
      )}
    >
      {eyebrow ? (
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          {eyebrow}
        </p>
      ) : null}
      <Heading
        id={id}
        className="text-3xl font-semibold leading-[1.12] text-ink sm:text-4xl lg:text-[2.75rem]"
      >
        {title}
      </Heading>
      {description ? (
        <p className="mt-4 text-base leading-relaxed text-muted sm:text-lg">
          {description}
        </p>
      ) : null}
    </div>
  );
}
