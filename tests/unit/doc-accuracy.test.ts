/**
 * Documentation/source consistency guards (F-6, F-7).
 *
 *  - The audit trigger tokens documented in docs/BACKEND.md must be EXACTLY
 *    the values the source writes (verified by extracting them from the
 *    service modules, not from memory).
 *  - Cron registration must be documented with Vercel's officially supported
 *    mechanism (a committed `vercel.json` `crons` entry or `vercel crons add`),
 *    with the dashboard described as verify/inspect/disable only — never as
 *    the registration path — and without the stale plan-limit or
 *    allowed-window claims (F-7).
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relative: string): string => readFileSync(path.join(root, relative), "utf8");

describe("audit trigger documentation (F-6)", () => {
  it("documents exactly the dentalfile.delete trigger values written by the source", () => {
    const sources = [
      "lib/server/admin/dental-records.ts",
      "lib/server/admin/dental-files.ts",
      "lib/server/admin/dental-cleanup.ts",
    ].map(read);

    const written = new Set<string>();
    for (const source of sources) {
      for (const match of source.matchAll(/trigger: "([a-z_]+)"/g)) {
        written.add(match[1]);
      }
    }
    expect([...written].sort()).toEqual(["admin", "orphan", "record_delete", "sweep"]);

    const backend = read("docs/BACKEND.md");
    // The documented union matches the source union…
    expect(backend).toContain("trigger: admin|record_delete|sweep|orphan");
    expect(backend).toContain('dentalfile.delete {trigger: "record_delete"}');
    // …and the stale pre-fix tokens are gone.
    expect(backend).not.toMatch(/trigger: admin\|record\|sweep/);
    expect(backend).not.toContain('trigger: "record"');
  });
});

describe("cron registration documentation (F-7)", () => {
  const route = read("app/api/cron/dental-storage-cleanup/route.ts");
  const guide = read("docs/MANUAL_DEPLOYMENT_GUIDE.md");
  const backend = read("docs/BACKEND.md");
  const docs = [
    ["route", route],
    ["guide", guide],
    ["backend", backend],
  ] as const;

  it("documents the supported registration mechanism in all three docs", () => {
    for (const [, doc] of docs) {
      // Official mechanisms: a committed vercel.json crons entry or the CLI.
      expect(doc).toContain("vercel.json");
      expect(doc).toContain("vercel crons add");
      // The dashboard verifies/inspects/disables — it does not register.
      expect(doc).toContain("Settings → Cron Jobs");
      expect(doc).toContain("verify, inspect, or disable");
    }
  });

  it("preserves the exact cron path and schedule everywhere it is documented", () => {
    for (const [, doc] of docs) {
      expect(doc).toContain("`/api/cron/dental-storage-cleanup`");
      expect(doc).toContain("`0 3 * * *`");
    }
    // The source route itself is untouched.
    expect(route).toContain("maxDuration = 300");
  });

  it("never claims the dashboard registers the cron or repeats the stale plan claims", () => {
    expect(route).not.toMatch(/registers it in the Vercel dashboard/i);

    expect(guide).not.toContain("Hobby allows one cron");
    expect(guide).not.toMatch(/allowed 03:00–03:59 UTC window/);
    expect(guide).not.toContain("Cron registration happens **only** in the Vercel");

    expect(backend).not.toContain("Hobby plan allows one cron");
    expect(backend).not.toContain("there is no `vercel.json` in this");
  });
});

describe("deployment guide environment table (audit finding G)", () => {
  it("documents DENTAL_MAX_FILES_PER_RECORD in the guide env table with the source's default and range", () => {
    const guide = read("docs/MANUAL_DEPLOYMENT_GUIDE.md");
    const envSource = read("lib/server/env.ts");

    expect(guide).toContain("`DENTAL_MAX_FILES_PER_RECORD`");
    expect(guide).toContain("default **50**");
    expect(guide).toContain("supported range **1–500**");

    // The guide's numbers must match the source constants.
    expect(envSource).toContain("DEFAULT_DENTAL_MAX_FILES_PER_RECORD = 50");
    expect(envSource).toContain("DENTAL_MAX_FILES_PER_RECORD_HARD_CAP = 500");
  });
});
