/**
 * Direct unit tests for the output-formatting helpers. Every other test
 * in this package exercises them indirectly through a command; these
 * pin the empty-input and less-common category branches directly.
 */
import type { Diagnostic } from "@barwise/core";
import type { Counterexample } from "@barwise/core/counterexample";
import type { Verbalization } from "@barwise/core/verbalization";
import { describe, expect, it } from "vitest";
import {
  formatCounterexamples,
  formatDiagnostics,
  formatVerbalizations,
} from "../../src/workspace/format.js";

describe("formatDiagnostics", () => {
  it("returns an empty string for no diagnostics", () => {
    expect(formatDiagnostics([])).toBe("");
  });

  it("renders one line per diagnostic", () => {
    const diagnostics: Diagnostic[] = [
      { severity: "error", message: "bad", elementId: "e1", ruleId: "r1" },
    ];
    expect(formatDiagnostics(diagnostics)).toContain("ERROR");
    expect(formatDiagnostics(diagnostics)).toContain("bad");
  });
});

describe("formatCounterexamples", () => {
  it("returns an empty string for no counterexamples", () => {
    expect(formatCounterexamples([])).toBe("");
  });

  it("renders a header and one line per counterexample", () => {
    const counterexamples: Counterexample[] = [
      {
        factTypeId: "ft1",
        constraintType: "mandatory",
        populations: [],
        text: "Some customer has no name.",
      } as unknown as Counterexample,
    ];
    const out = formatCounterexamples(counterexamples);
    expect(out).toContain("Counterexamples (what the constraints rule out):");
    expect(out).toContain("Some customer has no name.");
  });
});

describe("formatVerbalizations", () => {
  it("indents a constraint line under its fact type", () => {
    const verbalizations: Verbalization[] = [
      { segments: [], text: "Customer has Name.", sourceElementId: "ft1", category: "fact_type" },
      {
        segments: [],
        text: "Each Customer has exactly one Name.",
        sourceElementId: "ft1",
        category: "constraint",
      },
    ];
    const out = formatVerbalizations(verbalizations);
    expect(out).toBe("Customer has Name.\n  Each Customer has exactly one Name.");
  });

  it("renders subtype and objectification lines unindented", () => {
    const verbalizations: Verbalization[] = [
      {
        segments: [],
        text: "Manager is a kind of Employee.",
        sourceElementId: "ot1",
        category: "subtype",
      },
      {
        segments: [],
        text: "Enrollment objectifies Student enrolls-in Course.",
        sourceElementId: "ft2",
        category: "objectification",
      },
    ];
    const out = formatVerbalizations(verbalizations);
    expect(out).toBe(
      "Manager is a kind of Employee.\nEnrollment objectifies Student enrolls-in Course.",
    );
  });

  it("falls through to the default branch for an open question", () => {
    const verbalizations: Verbalization[] = [
      {
        segments: [],
        text: "Is Email unique per Customer?",
        sourceElementId: "ot2",
        category: "open_question",
      },
    ];
    expect(formatVerbalizations(verbalizations)).toBe("Is Email unique per Customer?");
  });
});
