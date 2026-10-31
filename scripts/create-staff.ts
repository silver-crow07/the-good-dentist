/**
 * Create (or update) a staff account — OFFLINE ONLY.
 *
 * There is deliberately no public registration endpoint. Accounts are made
 * by the clinic operator on the server:
 *
 *   STAFF_EMAIL="admin@example.com" STAFF_PASSWORD="…" npm run staff:create
 *
 * or with arguments:
 *
 *   npx tsx scripts/create-staff.ts admin@example.com
 *   (password then comes from STAFF_PASSWORD env or stdin)
 *
 * Security notes:
 *  - Passwords are hashed with scrypt before storage; the plaintext is never
 *    logged or persisted.
 *  - Password must be at least 12 characters.
 *  - Re-running with an existing email rotates that account's password and
 *    revokes all of its sessions.
 */

import { createInterface } from "node:readline/promises";

import "dotenv/config";

import { destroyAllSessionsForStaff, hashPassword } from "../lib/server/auth";
import { getPrisma } from "../lib/server/db";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PASSWORD_LENGTH = 12;

async function readPassword(): Promise<string | null> {
  if (process.env["STAFF_PASSWORD"]) return process.env["STAFF_PASSWORD"];
  if (!process.stdin.isTTY) return null;

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question("Password (min 12 chars, input visible — use env in shared shells): ");
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const prisma = getPrisma();
  if (!prisma) {
    console.error("DATABASE_URL is not set — see .env.example and docs/BACKEND.md.");
    process.exitCode = 1;
    return;
  }

  const email = (process.argv[2] ?? process.env["STAFF_EMAIL"] ?? "").trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    console.error("Provide a valid email as the first argument or STAFF_EMAIL.");
    process.exitCode = 1;
    return;
  }

  const password = (await readPassword())?.trim() ?? "";
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    process.exitCode = 1;
    return;
  }

  const fullName = (process.env["STAFF_NAME"] ?? "Clinic Staff").trim();
  const passwordHash = await hashPassword(password);

  const existing = await prisma.staff.findUnique({ where: { email } });
  if (existing) {
    await prisma.staff.update({
      where: { email },
      data: { passwordHash, active: true },
    });
    await destroyAllSessionsForStaff(existing.id);
    console.log(`Updated staff ${email} and revoked all of its sessions.`);
  } else {
    await prisma.staff.create({
      data: { email, fullName, passwordHash, role: "ADMIN", active: true },
    });
    console.log(`Created staff account ${email} (role ADMIN).`);
  }
}

main()
  .catch((error) => {
    console.error("Failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const prisma = getPrisma();
    if (prisma) await prisma.$disconnect();
  });
