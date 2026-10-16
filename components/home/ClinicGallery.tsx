import Image from "next/image";

import { Reveal } from "@/components/shared/Reveal";
import { SectionHeading } from "@/components/shared/SectionHeading";
import { galleryItems } from "@/data/gallery";

export function ClinicGallery() {
  return (
    <section
      id="gallery"
      aria-labelledby="gallery-heading"
      className="section-pad bg-mint/50"
    >
      <div className="container-page">
        <Reveal>
          <SectionHeading
            id="gallery-heading"
            eyebrow="Inside The Clinic"
            title="A space designed to feel calm."
            description="Reception, treatment rooms and the team — temporary stock photos are shown until real clinic photography is available."
            align="center"
          />
        </Reveal>

        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {galleryItems.map((item, index) => (
            <Reveal key={item.id} delay={(index % 3) * 90}>
              <figure className="group h-full overflow-hidden rounded-2xl border border-line bg-white transition duration-300 hover:-translate-y-1 hover:border-primary/25 hover:shadow-soft">
                <div className="relative aspect-[4/3] overflow-hidden bg-mint">
                  <Image
                    src={item.image}
                    alt={item.alt}
                    width={800}
                    height={600}
                    sizes="(min-width: 1024px) 32vw, (min-width: 640px) 50vw, 100vw"
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                  />
                </div>
                <figcaption className="flex items-start justify-between gap-3 px-5 py-4">
                  <span>
                    <span className="block text-sm font-semibold text-ink">
                      {item.title}
                    </span>
                    <span className="mt-1 block text-sm text-muted">
                      {item.description}
                    </span>
                  </span>
                  <span className="shrink-0 text-[0.65rem] uppercase tracking-[0.14em] text-muted">
                    Stock photo
                  </span>
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
