/**
 * One value range for object types and role value constraints
 * (src/model/valueRangeSchema.ts): one canonical record, read the same from
 * a file and from a config, and the same on both kinds of element.
 */
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { ConstraintYamlCodec } from "../../src/model/constraintSchema.js";
import { createObjectType } from "../../src/model/ObjectType.js";
import { decodeObjectType, runObjectTypeDecode } from "../../src/model/objectTypeDecoder.js";

const fileRange = { min: "1", max: "9", min_inclusive: true, max_inclusive: false };
const canonical = { min: "1", max: "9", maxInclusive: false };

describe("a value range", () => {
  it("reads from a file without an inclusive flag, as today's reader did", () => {
    const ot = runObjectTypeDecode(decodeObjectType({
      id: "ot-1",
      name: "Grade",
      kind: "value",
      value_constraint: { ranges: [fileRange] },
    }));
    expect("valueConstraint" in ot && ot.valueConstraint?.ranges).toEqual([canonical]);
  });

  it("reads the same on a role's value constraint", () => {
    const c = Schema.decodeUnknownSync(ConstraintYamlCodec)({
      id: "c-1",
      type: "value_constraint",
      role: "r-1",
      ranges: [fileRange],
    });
    expect("ranges" in c && c.ranges).toEqual([canonical]);
  });

  it("accepts minInclusive: true from a config, and canonicalizes it", () => {
    const ot = createObjectType({
      name: "Grade",
      kind: "value",
      valueConstraint: { values: [], ranges: [{ min: "1", minInclusive: true }] },
    });
    expect("valueConstraint" in ot && ot.valueConstraint?.ranges).toEqual([{ min: "1" }]);
  });

  it("refuses a range with neither bound, which no file could hold", () => {
    expect(() =>
      createObjectType({
        name: "Grade",
        kind: "value",
        valueConstraint: { values: [], ranges: [{}] },
      })
    ).toThrow();
  });
});

describe("a range with neither bound is named by its path", () => {
  // The check carries the schema's keys and is worded from where Effect found
  // it, so a value type with several ranges is told which one.
  it("at construction, in the config's spelling", () => {
    expect(() =>
      createObjectType({
        name: "Grade",
        kind: "value",
        valueConstraint: { values: [], ranges: [{ min: "1" }, { max: "9" }, {}] },
      })
    ).toThrow(
      'Value type "Grade" is missing "valueConstraint.ranges.2.min" or "valueConstraint.ranges.2.max".',
    );
  });

  it("on load, in the file's spelling", () => {
    expect(() =>
      runObjectTypeDecode(decodeObjectType({
        id: "ot-1",
        name: "Grade",
        kind: "value",
        value_constraint: { ranges: [{}] },
      }))
    ).toThrow(
      'Value type "Grade" is missing "value_constraint.ranges.0.min" or "value_constraint.ranges.0.max".',
    );
  });
});
