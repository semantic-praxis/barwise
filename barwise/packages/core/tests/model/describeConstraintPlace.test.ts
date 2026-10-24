/**
 * The one description of a constraint that both the 3.0 loader's refusal
 * and `structural/duplicate-constraint-id` print, so two constraints sharing
 * an id read the same whichever path reports them. Each branch is pinned,
 * the empty ones included, since an empty list once printed as nothing.
 */
import { describe, expect, it } from "vitest";
import {
  describeConstraintPlace,
  describeRepeatedConstraintIds,
} from "../../src/model/Constraint.js";

describe("describeConstraintPlace", () => {
  it("names a constraint in a fact type by its kind and the fact type, quoted safely", () => {
    expect(describeConstraintPlace({ type: "mandatory", id: "c", roleId: "r1" }, "A runs"))
      .toBe('mandatory in fact type "A runs"');
    expect(describeConstraintPlace({ type: "mandatory", id: "c", roleId: "r1" }, 'A "runs"'))
      .toBe('mandatory in fact type "A \\"runs\\""');
  });

  it("names one stored on the model by the role ids it names", () => {
    expect(
      describeConstraintPlace({ type: "exclusion", id: "x", roleIds: ["r1", "r2"] }, undefined),
    )
      .toBe("exclusion over roles r1, r2");
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

describe("describeRepeatedConstraintIds", () => {
  it("lists each id with its places", () => {
    expect(describeRepeatedConstraintIds([["c", ["a", "b"]], ["d", ["e", "f"]]]))
      .toBe('"c" (a; b), "d" (e; f)');
  });

  it("caps the list and counts the rest, so one message stays one readable line", () => {
    const repeats = ["a", "b", "c", "d", "e", "f", "g"].map((id) => [id, ["x", "y"]] as const);
    expect(describeRepeatedConstraintIds(repeats))
      .toBe('"a" (x; y), "b" (x; y), "c" (x; y), "d" (x; y), "e" (x; y), and 2 more');
  });
});
