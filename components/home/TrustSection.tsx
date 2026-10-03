import { trustItems } from "@/data/trust";

export function TrustSection() {
  return (
    <section
      aria-label="Why patients trust The Good Dentist"
      className="border-y border-line bg-white"
    >
      <div className="container-page">
        <ul className="grid divide-y divide-line-soft sm:grid-cols-2 sm:divide-x lg:grid-cols-4">
          {trustItems.map((item) => {
            const Icon = item.icon;
            return (
              <li
                key={item.id}
                className="flex items-start gap-3.5 px-0 py-6 sm:px-6 sm:first:pl-0 sm:last:pr-0 lg:py-7"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-mint text-primary">
                  <Icon aria-hidden="true" className="size-5" />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-ink">
                    {item.title}
                  </span>
                  <span className="mt-1 block text-sm leading-snug text-muted">
                    {item.description}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
