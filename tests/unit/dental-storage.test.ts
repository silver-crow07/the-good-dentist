/**
 * Phase D unit tests — pure storage helpers (no DB, no network).
 *
 * Manifest ids: [K*] key building · [EX] extension parsing · [U*]
 * content-type/family validation · [FM*] magic bytes · [C] cleanupAfter
 * timing · [G*] 48 h grace predicate (inclusive, fails closed, LR6/LR7) ·
 * [EV*] evidence capture · cursor shape · newFileId format.
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  buildDentalKey,
  captureEvidence,
  cleanupAfterFor,
  extensionOf,
  familyOfContentType,
  familyOfExtension,
  GRACE_MS,
  isGraceElapsed,
  isShapeValidCursor,
  matchesFamily,
  matchesMagicBytes,
  MAX_FILE_BYTES,
  newFileId,
  setFileIdFactoryForTests,
  URL_TTL_SECONDS,
} from "@/lib/server/storage/pure";
import type { HeadResult } from "@/lib/server/storage/types";

afterEach(() => {
  setFileIdFactoryForTests(null);
});

describe("extension parsing [EX]", () => {
  it("lower-cases and strips directories", () => {
    expect(extensionOf("xray.PNG")).toBe("png");
    expect(extensionOf("C:\\images\\scan.JpEg")).toBe("jpeg");
    expect(extensionOf("/var/uploads/scan.jpg")).toBe("jpg");
  });

  it("returns null for missing, leading or trailing dots", () => {
    expect(extensionOf("noextension")).toBeNull();
    expect(extensionOf(".hidden")).toBeNull();
    expect(extensionOf("trailing.")).toBeNull();
    expect(extensionOf("")).toBeNull();
  });
});

describe("content-type / family validation [U*]", () => {
  it("maps the allow-listed types to a family", () => {
    expect(familyOfContentType("image/jpeg")).toBe("jpeg");
    expect(familyOfContentType("image/jpg")).toBe("jpeg");
    expect(familyOfContentType("IMAGE/PNG")).toBe("png");
    expect(familyOfContentType("image/png; charset=binary")).toBe("png");
  });

  it("rejects everything else", () => {
    for (const type of ["application/pdf", "image/gif", "text/html", "", "image/svg+xml"]) {
      expect(familyOfContentType(type)).toBeNull();
    }
  });

  it("maps extensions to families", () => {
    expect(familyOfExtension("jpg")).toBe("jpeg");
    expect(familyOfExtension("JPEG")).toBe("jpeg");
    expect(familyOfExtension("png")).toBe("png");
    expect(familyOfExtension("txt")).toBeNull();
  });

  it("requires the declared type and extension to agree", () => {
    expect(matchesFamily("xray.jpg", "image/jpeg")).toBe(true);
    expect(matchesFamily("xray.jpeg", "image/jpg")).toBe(true);
    expect(matchesFamily("xray.png", "image/png")).toBe(true);
    expect(matchesFamily("xray.png", "image/jpeg")).toBe(false);
    expect(matchesFamily("xray.gif", "image/gif")).toBe(false);
    expect(matchesFamily("xray", "image/jpeg")).toBe(false);
  });
});

describe("magic bytes [FM*]", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  it("accepts the real signatures for the matching extension", () => {
    expect(matchesMagicBytes("scan.jpg", jpeg)).toBe(true);
    expect(matchesMagicBytes("scan.png", png)).toBe(true);
  });

  it("rejects a mismatched family, short reads and garbage", () => {
    expect(matchesMagicBytes("scan.png", jpeg)).toBe(false);
    expect(matchesMagicBytes("scan.jpg", png)).toBe(false);
    expect(matchesMagicBytes("scan.jpg", new Uint8Array([0xff]))).toBe(false);
    expect(matchesMagicBytes("scan.jpg", new Uint8Array([0x41, 0x41, 0x41]))).toBe(false);
    expect(matchesMagicBytes("scan.txt", jpeg)).toBe(false);
  });
});

describe("key building [K*]", () => {
  it("builds a server-generated key under dental/{patient}/{record}/{file}.{ext}", () => {
    const { key, ext } = buildDentalKey({
      patientId: "pat_1",
      recordId: "rec_1",
      fileId: "cabc123",
      originalName: "XRAY-Left.JPG",
    });
    expect(key).toBe("dental/pat_1/rec_1/cabc123.jpg");
    expect(ext).toBe("jpg");
  });

  it("never lets the file name influence the directory", () => {
    const { key } = buildDentalKey({
      patientId: "pat_1",
      recordId: "rec_1",
      fileId: "cabc123",
      originalName: "../../../etc/passwd.png",
    });
    expect(key).toBe("dental/pat_1/rec_1/cabc123.png");
  });

  it("throws for unsupported or missing extensions", () => {
    for (const name of ["evil.exe", "noext", "trailing.", ""]) {
      expect(() =>
        buildDentalKey({
          patientId: "p",
          recordId: "r",
          fileId: "f",
          originalName: name,
        }),
      ).toThrow();
    }
  });
});

describe("cleanup timing [C]", () => {
  it("is createdAt + URL TTL (300 s) + 300 s buffer", () => {
    expect(URL_TTL_SECONDS).toBe(300);
    const created = new Date("2026-11-03T10:00:00.000Z");
    expect(cleanupAfterFor(created).toISOString()).toBe("2026-11-03T10:10:00.000Z");
  });

  it("caps uploads at 10 MB", () => {
    expect(MAX_FILE_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe("48 h grace predicate [G*] (fails closed)", () => {
  const t0 = new Date("2026-11-03T12:00:00.000Z");

  it("is INCLUSIVE at exactly 48 h (LR6)", () => {
    expect(GRACE_MS).toBe(48 * 60 * 60 * 1000);
    expect(isGraceElapsed(new Date(t0.getTime() - GRACE_MS), t0)).toBe(true);
  });

  it("defers anything younger than 48 h", () => {
    expect(isGraceElapsed(new Date(t0.getTime() - GRACE_MS + 1), t0)).toBe(false);
    expect(isGraceElapsed(new Date(t0.getTime() - 60_000), t0)).toBe(false);
  });

  it("never deletes on a missing or unparsable timestamp (fail closed)", () => {
    expect(isGraceElapsed(null, t0)).toBe(false);
    expect(isGraceElapsed(new Date("not-a-date"), t0)).toBe(false);
  });

  it("treats a future-dated timestamp as NOT old (LR7)", () => {
    expect(isGraceElapsed(new Date(t0.getTime() + 60_000), t0)).toBe(false);
  });
});

describe("cursor shape", () => {
  it("accepts only dental/ keys (or nothing)", () => {
    expect(isShapeValidCursor(null)).toBe(true);
    expect(isShapeValidCursor(undefined)).toBe(true);
    expect(isShapeValidCursor("dental/pat/rec/file.jpg")).toBe(true);
    expect(isShapeValidCursor("other/prefix")).toBe(false);
    expect(isShapeValidCursor("")).toBe(false);
  });
});

describe("evidence capture [EV*] (diagnostic only)", () => {
  it("snapshots a found object", () => {
    const head: HeadResult = {
      found: true,
      key: "dental/p/r/f.jpg",
      size: 2048,
      lastModified: new Date("2026-11-01T00:00:00.000Z"),
      etag: '"abc"',
    };
    expect(captureEvidence(head)).toEqual({
      size: 2048,
      lastModified: "2026-11-01T00:00:00.000Z",
      etag: '"abc"',
    });
  });

  it("returns null for absent objects and null timestamps", () => {
    expect(captureEvidence({ found: false })).toBeNull();
    const head: HeadResult = {
      found: true,
      key: "k",
      size: 1,
      lastModified: null,
      etag: null,
    };
    expect(captureEvidence(head)).toEqual({ size: 1, lastModified: null, etag: null });
  });
});

describe("file ids", () => {
  it("generates a unique-looking id (time + 64 bits of randomness)", () => {
    const id = newFileId();
    expect(id).toMatch(/^c[0-9a-z]+[0-9a-f]{8}$/);
    expect(newFileId()).not.toBe(id);
  });

  it("can be forced to collide for the reservation retry tests [KK]", () => {
    setFileIdFactoryForTests(() => "ccollision00");
    expect(newFileId()).toBe("ccollision00");
    expect(newFileId()).toBe("ccollision00");
    setFileIdFactoryForTests(null);
    expect(newFileId()).not.toBe("ccollision00");
  });
});
