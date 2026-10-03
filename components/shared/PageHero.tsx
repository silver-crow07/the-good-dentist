import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type PageHeroProps = {
  eyebrow: string;
  title: ReactNode;
  description?: string;
  children?: ReactNode;
  className?: string;
};

export function PageHero({
  eyebrow,
  title,
  description,
  children,
  className,
}: PageHeroProps) {
  return (
    <section className={cn("border-b border-line bg-mint/40", className)}>
      <div className="container-page py-12 md:py-16 lg:py-20">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          {eyebrow}
        </p>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-[1.08] text-ink sm:text-5xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
            {description}
          </p>
        ) : null}
        {children ? <div className="mt-7">{children}</div> : null}
      </div>
    </section>
  );
}
