// Prisma 7 project configuration.
//
// Prisma CLI does NOT auto-load `.env` files in v7 — dotenv does it here.
// The application runtime (Next.js) loads `.env` on its own; this file only
// affects Prisma CLI commands (generate / migrate / studio / db seed).
//
// DATABASE_URL must be provided by you — see `.env.example` for a template
// and docs/BACKEND.md for local setup steps. No credentials are committed.

import "dotenv/config";

import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
