import { CLINIC_NAME, CLINIC_WHATSAPP_NUMBER } from "@/lib/constants";
import { toDialableNumber } from "@/lib/utils";

export type WhatsAppBookingDetails = {
  name?: string;
  date?: string;
  time?: string;
  treatment?: string;
};

const GREETING = `Hi ${CLINIC_NAME} 👋

I would like to book an appointment.`;

/** Pre-filled booking message — empty fields are left blank for the patient. */
export function buildBookingMessage(
  details: WhatsAppBookingDetails = {},
): string {
  const line = (label: string, value?: string) =>
    value && value.trim().length > 0 ? `${label}: ${value.trim()}` : `${label}:`;

  return [
    GREETING,
    "",
    line("Name", details.name),
    line("Preferred Date", details.date),
    line("Preferred Time", details.time),
    line("Treatment", details.treatment),
  ].join("\n");
}

/** Build a wa.me deep link using the configured clinic number. */
export function buildWhatsAppUrl(
  message: string,
  number: string = CLINIC_WHATSAPP_NUMBER,
): string {
  const digits = toDialableNumber(number);
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
