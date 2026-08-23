/**
 * What validation found, as rule ids rather than counts
 * (docs/specs/pipeline-observability.spec.md, barwise-838).
 *
 * The record the spec asked for and the first pass did not build. It is
 * separate from the extraction record because extraction never
 * validates -- `ValidationEngine` is constructed downstream, at more
 * than a dozen call sites -- so one record would be half-empty
 * depending on who emitted it, and a surface that validates a
 * hand-written model would have nowhere to report.
 */
import { describe, expect, it } from "vitest";
import { emitValidationRecord, summariseValidation } from "../../src/observe/validationLog.js";

const AT = "2026-08-22T12:00:00.000Z";

const DIAGS = [
  { severity: "error", ruleId: "constraint/ring-different-players" },
  { severity: "error", ruleId: "constraint/ring-different-players" },
  { severity: "error", ruleId: "population/incomplete-instance" },
  { severity: "warning", ruleId: "completeness/fact-type-without-uniqueness" },
  { severity: "info", ruleId: "constraint/spanning-all-roles" },
];

describe("summariseValidation", () => {
  it("splits the tally by severity", () => {
    const record = summariseValidation({
      startedAt: AT,
      source: "validate:model",
      diagnostics: DIAGS,
    });

    expect(record.errorsByRule).toEqual({
      "constraint/ring-different-players": 2,
      "population/incomplete-instance": 1,
    });
    expect(record.warningsByRule).toEqual({
      "completeness/fact-type-without-uniqueness": 1,
    });
  });

  it("keeps each tally in step with its count", () => {
    // The failure a count-only field could never expose: a tally that
    // disagrees with its own total.
    const record = summariseValidation({ startedAt: AT, source: "s", diagnostics: DIAGS });

    const summed = (m: Readonly<Record<string, number>>) =>
      Object.values(m).reduce((a, b) => a + b, 0);
    expect(summed(record.errorsByRule)).toBe(record.errors);
    expect(summed(record.warningsByRule)).toBe(record.warnings);
  });

  it("ignores the info tier entirely", () => {
    // It carries no weight in any score, and recording it would grow
    // every row for a tier nobody acts on.
    const record = summariseValidation({
      startedAt: AT,
      source: "s",
      diagnostics: [{ severity: "info", ruleId: "constraint/spanning-all-roles" }],
    });

    expect(record.errors).toBe(0);
    expect(record.warnings).toBe(0);
    expect(record.errorsByRule).toEqual({});
    expect(record.warningsByRule).toEqual({});
  });

  it("attributes a diagnostic with no rule id rather than dropping it", () => {
    // Dropping it would make the tally disagree with the count, which
    // is the one thing this record exists to prevent.
    const record = summariseValidation({
      startedAt: AT,
      source: "s",
      diagnostics: [{ severity: "error" }],
    });

    expect(record.errors).toBe(1);
    expect(record.errorsByRule).toEqual({ "(unattributed)": 1 });
  });

  it("records no diagnostic message", () => {
    // A message interpolates element names, which on an extracted model
    // came from the transcript. Same no-content rule as the correction
    // descriptions, asserted over the serialised record for the same
    // reason: a field added later without thought is how it leaks.
    const record = summariseValidation({
      startedAt: AT,
      source: "validate:model",
      diagnostics: [{ severity: "error", ruleId: "constraint/ring-different-players" }],
    });

    expect(JSON.stringify(record)).not.toContain("must be played by");
    expect(Object.keys(record)).not.toContain("messages");
  });

  it("is empty rather than absent on a clean model", () => {
    const record = summariseValidation({ startedAt: AT, source: "s", diagnostics: [] });

    expect(record.errorsByRule).toEqual({});
    expect(record.warningsByRule).toEqual({});
    expect(record.errors).toBe(0);
  });
});

describe("emitValidationRecord", () => {
  it("swallows a throwing sink", () => {
    expect(() =>
      emitValidationRecord(
        {
          record: () => {
            throw new Error("disk full");
          },
        },
        summariseValidation({ startedAt: AT, source: "s", diagnostics: [] }),
      )
    ).not.toThrow();
  });

  it("does nothing without a sink", () => {
    expect(() =>
      emitValidationRecord(
        undefined,
        summariseValidation({ startedAt: AT, source: "s", diagnostics: [] }),
      )
    ).not.toThrow();
  });
});
