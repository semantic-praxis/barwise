import { describe, expect, it } from "vitest";
import { formatConstraintReport } from "../src/constraintReport.js";

const spec = (verbalization: string, pseudocode = "p", example = "e") => ({
  verbalization,
  pseudocode,
  example,
});

describe("formatConstraintReport", () => {
  it("reports nothing for no specs", () => {
    expect(formatConstraintReport(undefined, "ddl")).toBeUndefined();
    expect(formatConstraintReport([], "ddl")).toBeUndefined();
  });

  it("counts rules, not spills, and marks a repeated rule once", () => {
    // The DDL router spills one rule once per table it touches.
    expect(formatConstraintReport([spec("Rule A."), spec("Rule B."), spec("Rule A.")], "ddl")).toBe(
      "2 constraint(s) the ddl format could not express:\n  - Rule A. (x2)\n  - Rule B.",
    );
  });

  it("names the domain", () => {
    expect(formatConstraintReport([spec("Rule A.")], "ossie", { domain: "crm" })).toBe(
      "1 constraint(s) the ossie format could not express (domain crm):\n  - Rule A.",
    );
  });

  it("adds pseudocode and example in detail, continuation lines indented", () => {
    const report = formatConstraintReport(
      [spec("Rule A.", "x != y", "valid: (1, 2)\ninvalid: (1, 1)"), spec("Rule A.")],
      "ddl",
      { detail: true },
    );
    expect(report).toBe(
      [
        "1 constraint(s) the ddl format could not express:",
        "",
        "- Rule A. (x2)",
        "  Pseudocode: x != y",
        "  Example: valid: (1, 2)",
        "    invalid: (1, 1)",
      ].join("\n"),
    );
  });
});
