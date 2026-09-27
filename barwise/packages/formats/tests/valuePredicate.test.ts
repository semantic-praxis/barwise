/**
 * The CHECK predicate the DDL export writes reads back as the value
 * constraint it was written from (ddl-round-trip-fixed-point.spec.md, R2).
 * The two functions are one grammar in two directions, so the test is the
 * round trip: every case goes out through `renderValuePredicate` and must
 * come back unchanged through `parseValuePredicate`.
 */
import type { ValueConstraintDef } from "@barwise/core";
import { describe, expect, it } from "vitest";
import { parseValuePredicate, renderValuePredicate } from "../src/ddl/valuePredicate.js";

const cases: [string, ValueConstraintDef][] = [
  ["strings", { values: ["scheduled", "checked-in", "no-show"] }],
  ["an embedded quote", { values: ["it's", "O'Brien"] }],
  ["numbers", { values: ["1", "2", "-3", "4.5"] }],
  ["booleans", { values: ["TRUE", "FALSE"] }],
  ["a comma and OR inside a string", { values: ["a, b", "x OR y"] }],
  ["an inclusive range", { values: [], ranges: [{ min: "1", max: "5" }] }],
  [
    "an exclusive range",
    { values: [], ranges: [{ min: "0", max: "100", minInclusive: false, maxInclusive: false }] },
  ],
  ["an open-above range", { values: [], ranges: [{ min: "18" }] }],
  ["an open-below range", { values: [], ranges: [{ max: "9.99", maxInclusive: false }] }],
  ["values and ranges together", {
    values: ["N/A"],
    ranges: [{ min: "1", max: "5" }, { min: "10" }],
  }],
];

describe("renderValuePredicate and parseValuePredicate are inverses", () => {
  it.each(cases)("%s", (_name, constraint) => {
    const sql = renderValuePredicate("score", constraint.values, constraint.ranges);
    expect(parseValuePredicate(sql), sql).toEqual({ column: "score", constraint });
  });
});

describe("a predicate outside the grammar is not read", () => {
  it.each([
    ["two columns", "a IN (1, 2) OR b IN (3)"],
    ["a function", "LENGTH(code) = 3"],
    ["a negation", "status NOT IN ('x')"],
    ["a pattern", "code LIKE 'A%'"],
    ["a comparison between columns", "start_date <= end_date"],
  ])("%s", (_name, sql) => {
    expect(parseValuePredicate(sql)).toBeUndefined();
  });
});
