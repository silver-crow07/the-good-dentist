/**
 * Request-validation tests — pure, no database required.
 */

import { describe, expect, it } from "vitest";

import {
  availabilityQuerySchema,
  cancelAppointmentSchema,
  createAppointmentSchema,
  loginSchema,
  phoneSchema,
  emailSchema,
  safeParseWith,
  updateAppointmentSchema,
  zodFieldsFromError,
} from "@/lib/server/validation";

describe("phoneSchema", () => {
  it("normalises formatting characters to digits", () => {
    expect(phoneSchema.parse("98765 43210")).toBe("9876543210");
    expect(phoneSchema.parse("+91 98765-43210")).toBe("919876543210");
    expect(phoneSchema.parse("(022) 1234 5678")).toBe("02212345678");
  });

  it("rejects letters and too-short/too-long numbers", () => {
    expect(phoneSchema.safeParse("abcdefghij").success).toBe(false);
    expect(phoneSchema.safeParse("12345").success).toBe(false); // < 7 digits
    expect(phoneSchema.safeParse("1".repeat(16)).success).toBe(false); // > 15 digits
  });
});

describe("emailSchema", () => {
  it("passes valid emails and blank values (optional email)", () => {
    expect(emailSchema.parse("a@example.com")).toBe("a@example.com");
    expect(emailSchema.parse("  ")).toBeUndefined();
  });

  it("accepts a MISSING email key (browser omits it when blank)", () => {
    // Regression: the booking form sends `email: undefined`, which
    // JSON.stringify drops entirely — the server must not reject the field.
    expect(emailSchema.parse(undefined)).toBeUndefined();
    expect(
      createAppointmentSchema.safeParse({
        patient: { fullName: "No Email Person", phone: "9876543210" },
        serviceSlug: "general-dentistry",
        startsAt: "2026-11-02T09:00:00+05:30",
      }).success,
    ).toBe(true);
  });

  it("rejects malformed emails", () => {
    expect(emailSchema.safeParse("not-an-email").success).toBe(false);
    expect(emailSchema.safeParse("a@b").success).toBe(false);
  });
});

describe("createAppointmentSchema", () => {
  const validBody = {
    patient: { fullName: "Asha Sharma", phone: "98765 43210", email: "asha@example.com" },
    serviceSlug: "dental-cleaning",
    startsAt: "2026-11-02T09:00:00+05:30",
  };

  it("accepts a valid booking request", () => {
    const result = createAppointmentSchema.safeParse(validBody);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.patient.phone).toBe("9876543210");
    }
  });

  it("maps field errors to dotted paths for the UI", () => {
    const parsed = safeParseWith(createAppointmentSchema, {
      ...validBody,
      patient: { fullName: "A", phone: "xx", email: "bad" },
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.fields["patient.fullName"]).toBeTruthy();
      expect(parsed.fields["patient.phone"]).toBeTruthy();
      expect(parsed.fields["patient.email"]).toBeTruthy();
    }
  });

  it("requires startsAt to carry an explicit timezone offset", () => {
    const naive = createAppointmentSchema.safeParse({
      ...validBody,
      startsAt: "2026-11-02T09:00:00", // no offset → ambiguous, rejected
    });
    expect(naive.success).toBe(false);

    const withZ = createAppointmentSchema.safeParse({ ...validBody, startsAt: "2026-11-02T03:30:00Z" });
    expect(withZ.success).toBe(true);
  });

  it("bounds patient notes length", () => {
    const long = createAppointmentSchema.safeParse({
      ...validBody,
      patientNotes: "x".repeat(501),
    });
    expect(long.success).toBe(false);
  });

  it("rejects unknown service slug formats", () => {
    for (const slug of ["Dental Cleaning", "dental cleaning", "../etc/passwd", ""]) {
      expect(createAppointmentSchema.safeParse({ ...validBody, serviceSlug: slug }).success).toBe(false);
    }
  });
});

describe("availabilityQuerySchema", () => {
  it("requires date + serviceSlug", () => {
    expect(availabilityQuerySchema.safeParse({ date: "2026-11-02", serviceSlug: "dental-cleaning" }).success).toBe(true);
    expect(availabilityQuerySchema.safeParse({ date: "2026-11-02" }).success).toBe(false);
    expect(availabilityQuerySchema.safeParse({ date: "02/11/2026", serviceSlug: "x" }).success).toBe(false);
  });
});

describe("updateAppointmentSchema", () => {
  it("requires at least one change", () => {
    expect(updateAppointmentSchema.safeParse({}).success).toBe(false);
    expect(updateAppointmentSchema.safeParse({ status: "CONFIRMED" }).success).toBe(true);
    expect(updateAppointmentSchema.safeParse({ startsAt: "2026-11-02T10:00:00+05:30" }).success).toBe(true);
  });

  it("rejects unknown statuses", () => {
    expect(updateAppointmentSchema.safeParse({ status: "ARCHIVED" }).success).toBe(false);
  });
});

describe("cancelAppointmentSchema + loginSchema", () => {
  it("accepts empty cancel body and bounded reasons", () => {
    expect(cancelAppointmentSchema.safeParse({}).success).toBe(true);
    expect(cancelAppointmentSchema.safeParse({ reason: "Patient rescheduled" }).success).toBe(true);
    expect(cancelAppointmentSchema.safeParse({ reason: "x".repeat(301) }).success).toBe(false);
  });

  it("validates login credentials shape", () => {
    expect(loginSchema.safeParse({ email: "a@b.co", password: "secret1" }).success).toBe(true);
    expect(loginSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "nope", password: "secret1" }).success).toBe(false);
  });
});

describe("zodFieldsFromError", () => {
  it("reports the first issue per field", () => {
    const result = phoneSchema.safeParse("abc");
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = zodFieldsFromError(result.error);
      expect(Object.keys(fields)).toEqual(["_"]); // top-level schema → no path
    }
  });
});
