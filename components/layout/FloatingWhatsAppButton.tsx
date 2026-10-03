import { MessageCircle } from "lucide-react";

import { buildBookingMessage, buildWhatsAppUrl } from "@/lib/whatsapp";

const whatsappUrl = buildWhatsAppUrl(buildBookingMessage());

/**
 * Persistent WhatsApp entry point — bottom-right on every viewport, kept clear
 * of the footer's legal row and honouring notches via safe-area insets.
 */
export function FloatingWhatsAppButton() {
  return (
    <aside aria-label="WhatsApp quick contact" className="print:hidden">
      <a
        href={whatsappUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Book an appointment via WhatsApp (opens in a new tab)"
        className="group fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-5 z-40"
      >
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full bg-[#25D366]/40 animate-ping-soft"
        />

        <span className="relative flex size-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lift ring-1 ring-black/5 transition-transform duration-200 group-hover:-translate-y-1">
          <MessageCircle aria-hidden="true" className="size-7" />
        </span>

        <span className="pointer-events-none absolute right-full top-1/2 mr-3 hidden -translate-y-1/2 translate-x-2 whitespace-nowrap rounded-full bg-ink px-3.5 py-2 text-xs font-medium text-white opacity-0 shadow-soft transition duration-200 group-hover:translate-x-0 group-hover:opacity-100 sm:block">
          Book via WhatsApp
        </span>
      </a>
    </aside>
  );
}
