import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <section className="section-pad">
      <div className="container-page flex flex-col items-center text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          404 — Page not found
        </p>
        <h1 className="mt-5 max-w-xl text-4xl font-semibold leading-[1.1] text-ink sm:text-5xl">
          This page could not be found.
        </h1>
        <p className="mt-4 max-w-md text-base leading-relaxed text-muted">
          The link may be outdated, or the page may have moved. Book an
          appointment or head back to the homepage.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <ButtonLink href="/" size="lg">
            Back to Home
          </ButtonLink>
          <ButtonLink href="/appointment" variant="outline" size="lg">
            Book an Appointment
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
