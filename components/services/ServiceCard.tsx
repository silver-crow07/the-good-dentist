import { ArrowRight, Timer } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";
import type { Service } from "@/data/services";

type ServiceCardProps = {
  service: Service;
  className?: string;
};

export function ServiceCard({ service, className }: ServiceCardProps) {
  const Icon = service.icon;

  return (
    <Link
      href={`/services/${service.slug}`}
      className={cn(
        "group flex h-full flex-col rounded-2xl border border-line bg-white p-6 transition-all duration-300 hover:-translate-y-1 hover:border-primary/30 hover:shadow-soft",
        className,
      )}
    >
      <span className="flex size-12 items-center justify-center rounded-xl bg-mint text-primary transition-colors duration-300 group-hover:bg-primary group-hover:text-white">
        <Icon aria-hidden="true" className="size-6" />
      </span>

      <h3 className="mt-5 text-lg font-semibold text-ink">{service.title}</h3>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">
        {service.shortDescription}
      </p>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-line-soft pt-4">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted">
          <Timer aria-hidden="true" className="size-3.5 text-primary" />
          ~{service.durationMinutes} min
        </span>
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-primary">
          Learn More
          <ArrowRight
            aria-hidden="true"
            className="size-4 transition-transform duration-300 group-hover:translate-x-1"
          />
        </span>
      </div>
    </Link>
  );
}
