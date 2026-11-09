/**
 * Admin patient directory + profiles (Phase C).
 *
 * Design rules (mirrors appointments.ts / dashboard.ts):
 *  - Queries are read-only; every mutation writes an AuditLog row inside the
 *    same transaction (patient.create / patient.update / note.create).
 *  - Authorization is decided by the SESSION role via requireRole() on the
 *    route. This module receives the role and returns `clinicalNotes: null`
 *    for limited (STAFF) views — note content never leaves the server for
 *    unauthorized readers.
 *  - No passwordHash / session data is ever selected; all patient responses
 *    are rendered no-store by the routes.
 *  - Returns `null` when no database is configured (route maps to 503).
 */

import type { Prisma } from "@/generated/prisma/client";

import { getPrisma } from "../db";
import type { AdminPatientsQuery, UpdatePatientInput } from "../validation";
import { AdminError, type AppointmentStatusKey } from "./dashboard";

// Re-exported so routes can catch one error type from one module (same
// convention as admin/appointments.ts).
export { AdminError };

/** Most recent N appointments rendered in the profile. */
const APPOINTMENTS_CAP = 100;
/** Most recent N clinical notes rendered in the profile. */
const NOTES_CAP = 50;

export type AdminPatientListItem = {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  createdAt: string;
  appointmentCount: number;
};

export type AdminPatientsPage = {
  /** IANA clinic timezone — date rendering uses this, never the browser. */
  timezone: string;
  patients: AdminPatientListItem[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

export type AdminPatientAppointment = {
  publicId: string;
  status: AppointmentStatusKey;
  startsAt: string;
  endsAt: string;
  source: "WEBSITE" | "WHATSAPP" | "STAFF";
  service: { slug: string; name: string };
  doctor: { slug: string; name: string };
};

/** Completed appointments grouped per treatment (the treatment history). */
export type AdminTreatmentHistoryItem = {
  service: { slug: string; name: string };
  sessions: number;
  lastAt: string;
};

export type AdminClinicalNote = {
  id: string;
  body: string;
  createdAt: string;
  /** Author's display name; null when the staff account was deleted. */
  author: string | null;
};

export type AdminPatientProfile = {
  /** IANA clinic timezone — all date rendering uses this, never the browser. */
  timezone: string;
  patient: {
    id: string;
    fullName: string;
    phone: string;
    email: string | null;
    createdAt: string;
    updatedAt: string;
    appointmentCount: number;
  };
  /** Full history, newest first (capped at APPOINTMENTS_CAP). */
  appointments: AdminPatientAppointment[];
  /** COMPLETED appointments grouped by treatment, most recent first. */
  treatments: AdminTreatmentHistoryItem[];
  /** ADMIN only — `null` (never content) for limited STAFF views. */
  clinicalNotes: AdminClinicalNote[] | null;
  clinicalNotesTotal: number | null;
  /** Server-computed UI affordances; the API re-checks them anyway. */
  permissions: { canEdit: boolean; canAddNotes: boolean };
};

function requirePrisma() {
  const prisma = getPrisma();
  if (!prisma) {
    throw new AdminError(
      "SERVICE_UNAVAILABLE",
      "Patient records are temporarily unavailable — the database is not configured.",
    );
  }
  return prisma;
}

/** Search predicate: name (insensitive), phone digits (≥3), email (insensitive). */
function searchWhere(term: string): Prisma.PatientWhereInput[] {
  const clauses: Prisma.PatientWhereInput[] = [
    { fullName: { contains: term, mode: "insensitive" } },
    { email: { contains: term, mode: "insensitive" } },
  ];
  const digits = term.replace(/\D/g, "");
  if (digits.length >= 3) clauses.push({ phone: { contains: digits } });
  return clauses;
}

/** `Ravi   Kumar` → `Ravi Kumar` (same normalisation the booking flow uses). */
function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

const LIST_SELECT = {
  id: true,
  fullName: true,
  phone: true,
  email: true,
  createdAt: true,
  _count: { select: { appointments: true } },
} satisfies Prisma.PatientSelect;

type ListRow = {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  createdAt: Date;
  _count: { appointments: number };
};

function toListItem(row: ListRow): AdminPatientListItem {
  return {
    id: row.id,
    fullName: row.fullName,
    phone: row.phone,
    email: row.email,
    createdAt: row.createdAt.toISOString(),
    appointmentCount: row._count.appointments,
  };
}

/**
 * Paginated patient directory (alphabetical) with optional search.
 *
 * @returns `null` when the database is not configured (route → 503).
 */
export async function listAdminPatients(
  query: AdminPatientsQuery,
): Promise<AdminPatientsPage | null> {
  const prisma = getPrisma();
  if (!prisma) return null;

  const search = query.q?.trim() || undefined;
  const where: Prisma.PatientWhereInput = search ? { OR: searchWhere(search) } : {};
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;

  const [rows, total, config] = await Promise.all([
    prisma.patient.findMany({
      where,
      orderBy: [{ fullName: "asc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: LIST_SELECT,
    }),
    prisma.patient.count({ where }),
    prisma.clinicConfig.findUnique({ where: { id: "singleton" }, select: { timezone: true } }),
  ]);

  return {
    timezone: config?.timezone ?? "Asia/Kolkata",
    patients: rows.map(toListItem),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

/**
 * Complete patient profile: identity, appointment history, treatment
 * history and (ADMIN only) internal clinical notes.
 *
 * @param role — the verified session role; decides what this payload holds.
 * @throws AdminError NOT_FOUND / SERVICE_UNAVAILABLE.
 */
export async function getAdminPatient(
  id: string,
  role: "ADMIN" | "STAFF",
): Promise<AdminPatientProfile | null> {
  const prisma = getPrisma();
  if (!prisma) return null;

  const includeNotes = role === "ADMIN";

  const patient = await prisma.patient.findUnique({
    where: { id },
    select: {
      id: true,
      fullName: true,
      phone: true,
      email: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { appointments: true } },
    },
  });
  if (!patient) throw new AdminError("NOT_FOUND", "Patient not found.");

  const [config, appointments, treatmentGroups, services, notes, notesTotal] = await Promise.all([
    prisma.clinicConfig.findUnique({ where: { id: "singleton" }, select: { timezone: true } }),
    prisma.appointment.findMany({
      where: { patientId: id },
      orderBy: [{ startsAt: "desc" }, { publicId: "asc" }],
      take: APPOINTMENTS_CAP,
      select: {
        publicId: true,
        status: true,
        startsAt: true,
        endsAt: true,
        source: true,
        service: { select: { slug: true, name: true } },
        doctor: { select: { slug: true, name: true } },
      },
    }),
    prisma.appointment.groupBy({
      by: ["serviceId"],
      where: { patientId: id, status: "COMPLETED" },
      _count: { _all: true },
      _max: { startsAt: true },
    }),
    prisma.service.findMany({
      where: { active: true },
      select: { id: true, slug: true, name: true },
    }),
    includeNotes
      ? prisma.clinicalNote.findMany({
          where: { patientId: id },
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          take: NOTES_CAP,
          select: {
            id: true,
            body: true,
            createdAt: true,
            staff: { select: { fullName: true } },
          },
        })
      : Promise.resolve(null),
    includeNotes
      ? prisma.clinicalNote.count({ where: { patientId: id } })
      : Promise.resolve(null),
  ]);

  if (!config) {
    throw new AdminError("SERVICE_UNAVAILABLE", "The clinic schedule is not configured yet.");
  }

  const serviceById = new Map(services.map((service) => [service.id, service]));
  const treatments: AdminTreatmentHistoryItem[] = treatmentGroups
    .map((group) => {
      const service = serviceById.get(group.serviceId);
      if (!service || !group._max.startsAt) return null;
      return {
        service: { slug: service.slug, name: service.name },
        sessions: group._count._all,
        lastAt: group._max.startsAt.toISOString(),
      };
    })
    .filter((item): item is AdminTreatmentHistoryItem => item !== null)
    .sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt));

  return {
    timezone: config.timezone,
    patient: {
      id: patient.id,
      fullName: patient.fullName,
      phone: patient.phone,
      email: patient.email,
      createdAt: patient.createdAt.toISOString(),
      updatedAt: patient.updatedAt.toISOString(),
      appointmentCount: patient._count.appointments,
    },
    appointments: appointments.map((row) => ({
      publicId: row.publicId,
      status: row.status as AppointmentStatusKey,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      source: row.source as AdminPatientAppointment["source"],
      service: row.service,
      doctor: row.doctor,
    })),
    treatments,
    clinicalNotes:
      notes?.map((note) => ({
        id: note.id,
        body: note.body,
        createdAt: note.createdAt.toISOString(),
        author: note.staff?.fullName ?? null,
      })) ?? null,
    clinicalNotesTotal: notesTotal,
    permissions: { canEdit: includeNotes, canAddNotes: includeNotes },
  };
}

/**
 * Register a new patient (ADMIN) — audited in the same transaction.
 * Phone is intentionally NOT unique (two people may share a number), so no
 * duplicate rejection: identity is never matched on phone alone.
 */
export async function createAdminPatient(
  input: { fullName: string; phone: string; email?: string },
  staffId: string,
): Promise<AdminPatientListItem> {
  const prisma = requirePrisma();
  const fullName = normalizeName(input.fullName);

  const created = await prisma.$transaction(async (tx) => {
    const patient = await tx.patient.create({
      data: { fullName, phone: input.phone, email: input.email },
    });
    await tx.auditLog.create({
      data: {
        staffId,
        action: "patient.create",
        entityType: "patient",
        entityId: patient.id,
        metadata: { source: "admin_panel" },
      },
    });
    return patient;
  });

  return {
    id: created.id,
    fullName: created.fullName,
    phone: created.phone,
    email: created.email,
    createdAt: created.createdAt.toISOString(),
    appointmentCount: 0,
  };
}

/**
 * Edit patient information (ADMIN) — partial update, audited with the list
 * of changed field names (never the values, to keep PII out of the audit
 * metadata). `email` null clears the address.
 */
export async function updateAdminPatient(
  id: string,
  input: UpdatePatientInput,
  staffId: string,
): Promise<AdminPatientListItem> {
  const prisma = requirePrisma();

  const data: { fullName?: string; phone?: string; email?: string | null } = {};
  const fields: string[] = [];
  if (input.fullName !== undefined) {
    data.fullName = normalizeName(input.fullName);
    fields.push("fullName");
  }
  if (input.phone !== undefined) {
    data.phone = input.phone;
    fields.push("phone");
  }
  if (input.email !== undefined) {
    data.email = input.email;
    fields.push("email");
  }
  if (fields.length === 0) {
    throw new AdminError("VALIDATION_ERROR", "Provide at least one field to update.");
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.patient.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new AdminError("NOT_FOUND", "Patient not found.");

    await tx.patient.update({ where: { id }, data });
    await tx.auditLog.create({
      data: {
        staffId,
        action: "patient.update",
        entityType: "patient",
        entityId: id,
        metadata: { fields },
      },
    });

    const row = await tx.patient.findUnique({
      where: { id },
      select: LIST_SELECT,
    });
    if (!row) throw new AdminError("NOT_FOUND", "Patient not found.");
    return toListItem(row);
  });
}

/**
 * Add an internal clinical note (ADMIN) — audited in the same transaction
 * (action `note.create`, entity = the note, metadata links the patient).
 */
export async function addClinicalNote(
  patientId: string,
  body: string,
  staffId: string,
): Promise<AdminClinicalNote> {
  const prisma = requirePrisma();

  const note = await prisma.$transaction(async (tx) => {
    const patient = await tx.patient.findUnique({
      where: { id: patientId },
      select: { id: true },
    });
    if (!patient) throw new AdminError("NOT_FOUND", "Patient not found.");

    const created = await tx.clinicalNote.create({
      data: { patientId, body, staffId },
      select: {
        id: true,
        body: true,
        createdAt: true,
        staff: { select: { fullName: true } },
      },
    });
    await tx.auditLog.create({
      data: {
        staffId,
        action: "note.create",
        entityType: "clinicalNote",
        entityId: created.id,
        metadata: { patientId },
      },
    });
    return created;
  });

  return {
    id: note.id,
    body: note.body,
    createdAt: note.createdAt.toISOString(),
    author: note.staff?.fullName ?? null,
  };
}
