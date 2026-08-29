/**
 * The build/parse pair is one module so it cannot drift
 * (docs/specs/recorded-evidence-commands.spec.md). The round trip is the
 * test that matters: it is what a rename has to keep true.
 */
import { describe, expect, it } from "vitest";
import { parsePayloadFileName, payloadFileName } from "../src/record/payloadName.js";

describe("payload filenames round-trip", () => {
  it.each([
    ["order-management", 0],
    ["clinic-appointments", 4],
    ["subscription-billing", 41],
  ])("%s run %i", (caseId, index) => {
    const parsed = parsePayloadFileName(payloadFileName(caseId, index));
    expect(parsed).toEqual({ caseId, index });
  });

  it("writes the one-based form the recorded rounds already use", () => {
    // Not cosmetic: eval-payloads/ on disk is named this way, and a
    // zero-based rename would orphan every committed round.
    expect(payloadFileName("order-management", 0)).toBe("order-management-run1.json");
  });

  it("splits on the last -run<n>, since a case id may contain hyphens", () => {
    expect(parsePayloadFileName("clinic-appointments-run2.json"))
      .toEqual({ caseId: "clinic-appointments", index: 1 });
  });

  it("returns undefined for a name that is not a payload", () => {
    for (const name of ["notes.md", "order-management.json", "x-run0.json", "x-runN.json"]) {
      expect(parsePayloadFileName(name), name).toBeUndefined();
    }
  });
});
