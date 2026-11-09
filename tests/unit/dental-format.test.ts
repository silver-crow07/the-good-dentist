/**
 * Phase D unit tests — audit-action display strings.
 *
 * Manifest id: [AT*] every dental audit action must render a readable
 * sentence (unknown actions still fall back gracefully).
 */

import { describe, expect, it } from "vitest";

import { formatActivityAction } from "@/lib/client/format";

describe("dental audit actions [AT*]", () => {
  const expected: Record<string, string> = {
    "dentalrecord.create": "Dental record created",
    "dentalrecord.update": "Dental record updated",
    "dentalrecord.delete": "Dental record deleted",
    "dentalfile.upload": "Dental image uploaded",
    "dentalfile.download": "Dental image downloaded",
    "dentalfile.delete": "Dental image deleted",
    "dentalfile.rejected": "Dental image rejected (failed verification)",
    "dentalfile.orphan_already_absent": "Orphan scan: object already gone",
    "dentalfile.orphan_row_backed": "Orphan scan: object protected by its record",
  };

  for (const [action, sentence] of Object.entries(expected)) {
    it(`formats ${action}`, () => {
      expect(formatActivityAction(action)).toBe(sentence);
    });
  }

  it("still falls back for unknown actions", () => {
    expect(formatActivityAction("something.new")).toBe("Something New");
    expect(formatActivityAction("dentalfile.brand_new_action")).toBe(
      "Dentalfile Brand New Action",
    );
  });
});
