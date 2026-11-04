/**
 * `groupRepeats` answers "what is a repeat" for the 3.0 loader,
 * `OrmModel.constraintsSharingAnId` and `structural/duplicate-subtype-fact`,
 * so its contract is pinned here rather than only through them. The loader
 * names the groups in order in its error, so order is part of the contract.
 */
import { describe, expect, it } from "vitest";
import { groupRepeats } from "../../src/util/groupRepeats.js";

describe("groupRepeats", () => {
  const key = (s: string) => s.split(":")[0];

  it("keeps only keys that occur more than once", () => {
    expect([...groupRepeats(["a:1", "b:1", "a:2"], key)]).toEqual([["a", ["a:1", "a:2"]]]);
  });

  it("orders groups by first occurrence, and items within a group by input order", () => {
    expect([...groupRepeats(["b:1", "a:1", "a:2", "b:2", "a:3"], key)]).toEqual([
      ["b", ["b:1", "b:2"]],
      ["a", ["a:1", "a:2", "a:3"]],
    ]);
  });

  it("never groups an item whose key is undefined", () => {
    const groups = groupRepeats([1, 2, 3, 4], (n) => (n % 2 === 0 ? undefined : "odd"));
    expect([...groups]).toEqual([["odd", [1, 3]]]);
  });

  it("returns an empty map when nothing repeats", () => {
    expect(groupRepeats(["a", "b"], (s) => s).size).toBe(0);
  });
});
