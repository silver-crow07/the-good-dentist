import Image from "next/image";
import { BadgeCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Doctor } from "@/data/doctors";

type DoctorCardProps = {
  doctor: Doctor;
  className?: string;
};

export function DoctorCard({ doctor, className }: DoctorCardProps) {
  return (
    <article
      className={cn(
        "grid gap-6 rounded-3xl border border-line bg-white p-5 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)] sm:gap-8 sm:p-6",
        className,
      )}
    >
      <div className="relative mx-auto w-full max-w-56 overflow-hidden rounded-2xl bg-mint sm:mx-0 sm:max-w-none">
        <Image
          src={doctor.image}
          alt={`Stock portrait placeholder for ${doctor.name}`}
          width={800}
          height={1200}
          sizes="(max-width: 640px) 80vw, 180px"
          className="h-full w-full object-cover"
        />
      </div>

      <div className="flex flex-col justify-center gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="muted">{doctor.role}</Badge>
          {doctor.isPlaceholder ? (
            <Badge variant="accent">Placeholder profile</Badge>
          ) : null}
        </div>

        <div>
          <h3 className="text-2xl font-semibold text-ink">{doctor.name}</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {doctor.qualifications.map((qualification) => (
              <span
                key={qualification}
                className="rounded-md border border-primary/20 bg-mint px-2.5 py-1 text-xs font-semibold text-primary"
              >
                {qualification}
              </span>
            ))}
          </div>
        </div>

        <p className="text-sm text-muted">{doctor.experience}</p>
        <p className="text-sm leading-relaxed text-ink/80">{doctor.bio}</p>

        <div>
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            <BadgeCheck aria-hidden="true" className="size-3.5" />
            Areas of expertise
          </p>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
            {doctor.expertise.map((area) => (
              <li key={area} className="text-sm text-muted">
                {area}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </article>
  );
}
