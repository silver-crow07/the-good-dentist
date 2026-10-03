import { Quote } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Testimonial } from "@/data/testimonials";

type TestimonialCardProps = {
  testimonial: Testimonial;
  className?: string;
};

export function TestimonialCard({ testimonial, className }: TestimonialCardProps) {
  return (
    <figure
      className={cn(
        "flex h-full flex-col justify-between gap-6 rounded-2xl border border-line bg-white p-6 transition duration-300 hover:-translate-y-1 hover:border-primary/25 hover:shadow-soft sm:p-7",
        className,
      )}
    >
      <div>
        <Quote aria-hidden="true" className="size-6 text-primary/40" />
        <blockquote className="mt-4 text-[0.975rem] leading-relaxed text-ink/90">
          “{testimonial.quote}”
        </blockquote>
      </div>
      <figcaption className="flex items-center justify-between gap-3 border-t border-line-soft pt-4">
        <div>
          <p className="text-sm font-semibold text-ink">— {testimonial.author}</p>
          <p className="text-xs text-muted">{testimonial.context}</p>
        </div>
        {testimonial.isPlaceholder ? (
          <Badge variant="muted" className="shrink-0">
            Placeholder
          </Badge>
        ) : null}
      </figcaption>
    </figure>
  );
}
