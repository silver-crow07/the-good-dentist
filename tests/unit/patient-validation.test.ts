/**
 * Phase C patient + clinical-note validation — pure, no database required.
 */

import { describe, expect, it } from "vitest";

import {
  adminPatientsQuerySchema,
  clinicalNoteSchema,
  createPatientSchema,
  safeParseWith,
  updatePatientSchema,
} from "@/lib/server/validation";

describe("adminPatientsQuerySchema", () => {
  it("accepts an empty query (defaults to page 1)", () => {
    const result = adminPatientsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.page).toBeUndefined();
  });

  it("coerces numeric strings from the query string", () => {
    const result = adminPatientsQuerySchema.safeParse({ page: "3", pageSize: "50" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(3);
      expect(result.data.pageSize).toBe(50);
    }
  });

  it("rejects page/pageSize outside their bounds", () => {
    expect(adminPatientsQuerySchema.safeParse({ page: "0" }).success).toBe(false);
    expect(adminPatientsQuerySchema.safeParse({ page: "-2" }).success).toBe(false);
    expect(adminPatientsQuerySchema.safeParse({ pageSize: "101" }).success).toBe(false);
    expect(adminPatientsQuerySchema.safeParse({ pageSize: "abc" }).success).toBe(false);
  });

  it("trims and bounds the search term", () => {
    const result = adminPatientsQuerySchema.safeParse({ q: "  asha  " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.q).toBe("asha");
    expect(adminPatientsQuerySchema.safeParse({ q: "x".repeat(101) }).success).toBe(false);
  });
});

describe("createPatientSchema", () => {
  it("accepts a registration with name + phone only", () => {
    const result = createPatientSchema.safeParse({
      fullName: "  Asha   Verma ",
      phone: "98765 43210",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.phone).toBe("9876543210");
  });

  it("accepts an optional email and rejects a malformed one", () => {
    expect(
      createPatientSchema.safeParse({
        fullName: "Rahul Sen",
        phone: "9876543210",
        email: "rahul@example.com",
      }).success,
    ).toBe(true);
    expect(
      createPatientSchema.safeParse({
        fullName: "Rahul Sen",
        phone: "9876543210",
        email: "not-an-email",
      }).success,
    ).toBe(false);
  });

  it("rejects missing/blank name or an invalid phone", () => {
    expect(createPatientSchema.safeParse({ fullName: "", phone: "9876543210" }).success).toBe(false);
    expect(createPatientSchema.safeParse({ fullName: "Asha", phone: "" }).success).toBe(false);
    expect(createPatientSchema.safeParse({ fullName: "Asha", phone: "123" }).success).toBe(false);
  });
});

describe("updatePatientSchema", () => {
  it("accepts a partial update with any single field", () => {
    expect(updatePatientSchema.safeParse({ fullName: "New Name" }).success).toBe(true);
    expect(updatePatientSchema.safeParse({ phone: "9876543210" }).success).toBe(true);
    expect(updatePatientSchema.safeParse({ email: "a@example.com" }).success).toBe(true);
  });

  it("rejects an empty object (nothing to update)", () => {
    const result = updatePatientSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("treats an empty-string email as CLEARING (null)", () => {
    const result = updatePatientSchema.safeParse({ email: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBeNull();
  });

  it("passes an explicit null through unchanged", () => {
    const result = updatePatientSchema.safeParse({ email: null });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBeNull();
  });

  it("rejects a malformed email and normalises the phone", () => {
    expect(updatePatientSchema.safeParse({ email: "nope" }).success).toBe(false);
    const result = updatePatientSchema.safeParse({ phone: "98765 43210" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.phone).toBe("9876543210");
  });
});

describe("clinicalNoteSchema", () => {
  it("trims a valid note body", () => {
    const result = clinicalNoteSchema.safeParse({ body: "  Patient prefers morning slots.  " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.body).toBe("Patient prefers morning slots.");
  });

  it("rejects an empty or whitespace-only note", () => {
    expect(clinicalNoteSchema.safeParse({ body: "" }).success).toBe(false);
    expect(clinicalNoteSchema.safeParse({ body: "   " }).success).toBe(false);
  });

  it("rejects a note beyond 2000 characters", () => {
    expect(clinicalNoteSchema.safeParse({ body: "x".repeat(2000) }).success).toBe(true);
    expect(clinicalNoteSchema.safeParse({ body: "x".repeat(2001) }).success).toBe(false);
  });
});

describe("safeParseWith (patient flows)", () => {
  it("maps patient registration errors to field errors", () => {
    const result = safeParseWith(createPatientSchema, { fullName: "", phone: "abc" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fields.fullName).toBeTruthy();
      expect(result.fields.phone).toBeTruthy();
    }
  });
});
