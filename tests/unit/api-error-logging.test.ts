/**
 * F-8 — `handleRouteError()` diagnostic-logging contract.
 *
 *  - Error instances are logged WITH THEIR STACK (as the function documents),
 *    not just the message.
 *  - The whole error object is NEVER logged: attached extras (Prisma `meta`,
 *    request configs, headers, cookies, signed URLs, PHI) must not reach the
 *    server log.
 *  - Non-Error values are coerced to a plain string — never serialized —
 *    so arbitrary objects cannot leak their contents.
 *  - The client always receives the generic 500 with no internals.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { handleRouteError } from "@/lib/server/api";

type Restore = { mockRestore(): void };
const activeSpies: Restore[] = [];

/** Captures console.error output as TEXT (strings pass through, objects
 *  are JSON-encoded so an accidental object log would still be detectable). */
function captureErrors(): string[] {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    lines.push(
      args
        .map((value) => {
          if (typeof value === "string") return value;
          try {
            return JSON.stringify(value) ?? String(value);
          } catch {
            return String(value);
          }
        })
        .join(" "),
    );
  });
  activeSpies.push(spy);
  return lines;
}

describe("handleRouteError server-side logging (F-8)", () => {
  afterEach(() => {
    while (activeSpies.length > 0) activeSpies.pop()?.mockRestore();
  });

  it("logs the STACK for an Error instance and returns a generic 500", async () => {
    const lines = captureErrors();

    const response = handleRouteError(new Error("quota check failed"), "unit/ctx");

    expect(lines).toHaveLength(1);
    const logged = lines.join("\n");
    expect(logged).toContain("[api] unit/ctx:");
    expect(logged).toContain("Error: quota check failed");
    // Real stack frames — the whole point of F-8.
    expect(logged).toMatch(/\bat\b/);

    // Client sees only the generic envelope — no message, no stack.
    expect(response.status).toBe(500);
    const body = await response.json();
    const text = JSON.stringify(body);
    expect(body.error.code).toBe("INTERNAL");
    expect(text).not.toContain("quota check failed");
    expect(text).not.toContain("at ");
  });

  it("never logs attached PHI, secrets, cookies or signed URLs", async () => {
    const error = new Error("database operation failed");
    Object.assign(error, {
      // Simulated driver/adapter extras that must stay out of the log.
      meta: {
        patientName: "Meera Iyer",
        diagnosis: "Dental caries — 36 MO",
        clinicalNotes: "Sensitive to cold sweets.",
      },
      config: { headers: { cookie: "tgd_session=leaked-session-cookie" } },
      signedUrl:
        "https://acct.r2.cloudflarestorage.com/dental/p/r/f.jpg?X-Amz-Signature=cafebabe00",
      passwordHash: "$2b$12$leakedPasswordHashValue",
    });

    const lines = captureErrors();
    const response = handleRouteError(error, "unit/phi");
    const logged = lines.join("\n");

    for (const marker of [
      "Meera Iyer",
      "Dental caries",
      "Sensitive to cold",
      "tgd_session=leaked-session-cookie",
      "cafebabe00",
      "leakedPasswordHashValue",
      "X-Amz-Signature",
    ]) {
      expect(logged, `leaked: ${marker}`).not.toContain(marker);
    }
    // The diagnostics that ARE wanted survive: context + stack (message and
    // frames only — attached properties are not part of `stack`).
    expect(logged).toContain("[api] unit/phi:");
    expect(logged).toContain("Error: database operation failed");

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("Meera Iyer");
  });

  it("coerces non-Error values to a plain string without serializing them", async () => {
    const lines = captureErrors();

    const response = handleRouteError(
      { patientName: "Should Not Appear", note: "clinical note" },
      "unit/non-error",
    );

    const logged = lines.join("\n");
    expect(logged).toContain("[api] unit/non-error:");
    expect(logged).toContain("[object Object]");
    expect(logged).not.toContain("Should Not Appear");
    expect(logged).not.toContain("clinical note");

    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe("INTERNAL");
  });
});
