import { MessageCircle } from "lucide-react";

import { ButtonLink } from "@/components/ui/button";
import {
  buildBookingMessage,
  buildWhatsAppUrl,
  type WhatsAppBookingDetails,
} from "@/lib/whatsapp";
import { cn } from "@/lib/utils";

type WhatsAppButtonProps = {
  details?: WhatsAppBookingDetails;
  label?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
  variant?: "outline" | "primary" | "onDark" | "light";
};

/** Primary WhatsApp CTA — message and number come from `lib/whatsapp.ts`. */
export function WhatsAppButton({
  details,
  label = "Book via WhatsApp",
  className,
  size = "md",
  variant = "outline",
}: WhatsAppButtonProps) {
  return (
    <ButtonLink
      href={buildWhatsAppUrl(buildBookingMessage(details))}
      target="_blank"
      rel="noopener noreferrer"
      variant={variant}
      size={size}
      className={cn(className)}
      aria-label={`${label} (opens WhatsApp in a new tab)`}
    >
      <MessageCircle aria-hidden="true" className="size-4" />
      {label}
    </ButtonLink>
  );
}
