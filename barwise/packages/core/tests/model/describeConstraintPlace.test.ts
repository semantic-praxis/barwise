/**
 * The one description of a repeated constraint id that both the 3.0
 * loader's refusal and `structural/duplicate-constraint-id` print, so the
 * same repeat reads the same whichever path reports it. Each branch is
 * pinned, the empty ones included, since an empty list once printed as
 * nothing.
 */
import { describe, expect, it } from "vitest";
import {
  type Constraint,
  describeConstraintPlace,
  describeConstraintRepeat,
  describeConstraintRepeats,
} from "../../src/model/Constraint.js";

describe("describeConstraintPlace", () => {
  it("names a constraint in a fact type by kind, fact type and roles", () => {
    expect(describeConstraintPlace({ type: "mandatory", id: "c", roleId: "r1" }, "A runs"))
      .toBe('mandatory in fact type "A runs" over roles r1');
  });

  it("tells apart two of one kind in the same fact type by their roles", () => {
    const one = describeConstraintPlace({ type: "mandatory", id: "c", roleId: "r1" }, "A runs");
    const two = describeConstraintPlace({ type: "mandatory", id: "c", roleId: "r2" }, "A runs");
    expect(one).not.toBe(two);
  });

  it("JSON-quotes a fact type name, so a quote or a newline cannot break the line", () => {
    expect(describeConstraintPlace({ type: "mandatory", id: "c", roleId: "r1" }, 'A "runs"'))
      .toBe('mandatory in fact type "A \\"runs\\"" over roles r1');
    expect(describeConstraintPlace({ type: "mandatory", id: "c", roleId: "r1" }, "A\nruns"))
      .not.toContain("\n");
  });

  it("names one stored on the model by the role ids it names, an empty list included", () => {
    expect(
      describeConstraintPlace({ type: "exclusion", id: "x", roleIds: ["r1", "r2"] }, undefined),
    ).toBe("exclusion over roles r1, r2");
    expect(describeConstraintPlace({ type: "exclusion", id: "x", roleIds: [] }, undefined))
      .toBe("exclusion over no roles");
  });

  it("names one over subtypes by its subtype facts, an empty list included", () => {
    expect(
      describeConstraintPlace(
        { type: "exclusion", id: "x", subtypeFactIds: ["sf1", "sf2"] },
        undefined,
      ),
    ).toBe("exclusion over subtype facts sf1, sf2");
    expect(describeConstraintPlace({ type: "exclusion", id: "x", subtypeFactIds: [] }, undefined))
      .toBe("exclusion over no subtype facts");
  });
});

describe("describeConstraintRepeat and describeConstraintRepeats", () => {
  const holder = (role: string): readonly [Constraint, string] => [
    { type: "mandatory", id: "c", roleId: role },
    "F",
  ];

  it("JSON-quotes the id", () => {
    expect(describeConstraintRepeat('a"b', [holder("r1"), holder("r2")]))
      .toBe(
        '"a\\"b" (mandatory in fact type "F" over roles r1; mandatory in fact type "F" over roles r2)',
      );
  });

  it("caps the holders of one id and counts the rest", () => {
    const holders = ["r1", "r2", "r3", "r4", "r5", "r6", "r7"].map(holder);
    expect(describeConstraintRepeat("c", holders)).toMatch(/over roles r5; and 2 more\)$/);
  });

  it("caps the list of ids and counts the rest", () => {
    expect(describeConstraintRepeats(["a", "b", "c", "d", "e", "f", "g"]))
      .toBe("a, b, c, d, e, and 2 more");
    expect(describeConstraintRepeats(["a", "b"])).toBe("a, b");
  });
});
