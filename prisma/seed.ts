/**
 * Database seed — the single source of backend clinic configuration.
 *
 * Run with:            npm run db:seed   (tsx prisma/seed.ts)
 * Requires:            DATABASE_URL pointing at a migrated PostgreSQL.
 *
 * Seeds from CLIENT-CONFIRMED data only:
 *  - Contact details / address / timezone: lib/constants.ts
 *  - Schedule (Mon–Sat 9:00–13:00 & 16:00–21:00, Sunday closed): the
 *    confirmed hours also displayed on the website.
 *  - Dentist: Dr. Nidhi Paliwal (data/doctors.ts) — no invented profiles.
 *  - Services: data/services.ts — durations remain PROVISIONAL
 *    (durationIsProvisional = true) until the clinic approves them.
 *
 * Idempotent: re-running upserts the same rows (safe to run repeatedly).
 * Prints counts only — never prints secrets.
 */

import "dotenv/config";

import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { withUtcSession } from "../lib/server/db";
import { services } from "../data/services";
import {
  CLINIC_ADDRESS,
  CLINIC_EMAIL,
  CLINIC_NAME,
  CLINIC_PHONE_NUMBER,
  CLINIC_WHATSAPP_NUMBER,
} from "../lib/constants";

const adapter = new PrismaPg({
  connectionString: withUtcSession(process.env["DATABASE_URL"]),
});
const prisma = new PrismaClient({ adapter });

/** Minutes from midnight helpers — keeps the seed readable. */
const h = (hour: number, minute = 0) => hour * 60 + minute;

async function main(): Promise<void> {
  /* ---------------- Clinic configuration (singleton) ---------------- */
  const config = await prisma.clinicConfig.upsert({
    where: { id: "singleton" },
    update: {
      clinicName: CLINIC_NAME,
      timezone: "Asia/Kolkata",
      address: CLINIC_ADDRESS,
      phone: CLINIC_PHONE_NUMBER,
      whatsappNumber: CLINIC_WHATSAPP_NUMBER,
      email: CLINIC_EMAIL,
      // PROVISIONAL — 30-minute slot interval awaiting clinic approval.
      slotIntervalMinutes: 30,
      // Client has not confirmed auto-approval → manual confirmation.
      bookingPolicy: "MANUAL_APPROVAL",
    },
    create: {
      id: "singleton",
      clinicName: CLINIC_NAME,
      timezone: "Asia/Kolkata",
      address: CLINIC_ADDRESS,
      phone: CLINIC_PHONE_NUMBER,
      whatsappNumber: CLINIC_WHATSAPP_NUMBER,
      email: CLINIC_EMAIL,
      slotIntervalMinutes: 30,
      bookingPolicy: "MANUAL_APPROVAL",
    },
  });

  /* ---------------- Weekly hours (0 = Sunday … 6 = Saturday) ---------------- */
  const weekdayHours = {
    closed: false,
    opensAtMinutes: h(9), // 9:00 AM
    closesAtMinutes: h(21), // 9:00 PM
    breakStartMinutes: h(13), // 1:00 PM lunch
    breakEndMinutes: h(16), // 4:00 PM
  };
  const hours: { weekday: number; closed: boolean; opensAtMinutes: number; closesAtMinutes: number; breakStartMinutes: number | null; breakEndMinutes: number | null }[] = [
    // Mon–Sat (1–6)
    { weekday: 1, ...weekdayHours },
    { weekday: 2, ...weekdayHours },
    { weekday: 3, ...weekdayHours },
    { weekday: 4, ...weekdayHours },
    { weekday: 5, ...weekdayHours },
    { weekday: 6, ...weekdayHours },
    // Sunday (0) — weekly off
    { weekday: 0, closed: true, opensAtMinutes: 0, closesAtMinutes: 0, breakStartMinutes: null, breakEndMinutes: null },
  ];

  for (const hour of hours) {
    await prisma.clinicHour.upsert({
      where: { configId_weekday: { configId: config.id, weekday: hour.weekday } },
      update: hour,
      create: { configId: config.id, ...hour },
    });
  }

  /* ---------------- Doctor (confirmed profile only) ---------------- */
  await prisma.doctor.upsert({
    where: { slug: "dr-nidhi-paliwal" },
    update: {
      name: "Dr. Nidhi Paliwal",
      qualifications: ["BDS", "PGDMLS", "PGDHM"],
      experienceYears: 15,
      areasOfPractice: ["Root Canal Treatment"],
      active: true,
      sortOrder: 0,
    },
    create: {
      slug: "dr-nidhi-paliwal",
      name: "Dr. Nidhi Paliwal",
      qualifications: ["BDS", "PGDMLS", "PGDHM"],
      experienceYears: 15,
      areasOfPractice: ["Root Canal Treatment"],
      bio: null, // pending from client — do not invent
      active: true,
      sortOrder: 0,
    },
  });

  /* ---------------- Services (provisional durations) ---------------- */
  for (const [index, service] of services.entries()) {
    await prisma.service.upsert({
      where: { slug: service.slug },
      update: {
        name: service.title,
        description: service.shortDescription,
        durationMinutes: service.durationMinutes,
        durationIsProvisional: true, // keep flagging until clinic approves
        active: true,
        sortOrder: index,
      },
      create: {
        slug: service.slug,
        name: service.title,
        description: service.shortDescription,
        durationMinutes: service.durationMinutes,
        durationIsProvisional: true,
        active: true,
        sortOrder: index,
      },
    });
  }

  const [doctorCount, serviceCount, hourCount] = await Promise.all([
    prisma.doctor.count(),
    prisma.service.count(),
    prisma.clinicHour.count(),
  ]);
  console.log(
    `Seed complete — clinic config upserted; ${doctorCount} doctor, ${serviceCount} services, ${hourCount} weekly hours.`,
  );
}

main()
  .catch((error) => {
    console.error("Seed failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
