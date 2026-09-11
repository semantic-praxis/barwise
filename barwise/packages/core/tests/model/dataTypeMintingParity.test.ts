/**
 * barwise-999(a): `mintValueOfType` and `dataTypeAdmits` are parallel
 * switches over the same closed set, and nothing related them.
 *
 * One says what a conceptual data type ADMITS and the other constructs
 * a value OF it. They must agree on the boolean spelling and on the
 * numeric shapes, and they agreed only because one person wrote both:
 * minting a boolean as "yes" was caught by nothing, planted with
 * `mutate.mjs` and reported UNCAUGHT.
 *
 * A must-agree pair gets shared code, derivation, a parity-manifest
 * entry, or a drift test. Sharing is not available here -- one is a
 * predicate over a value and the other a generator over an index, and
 * neither can be written in terms of the other without inventing a
 * search. So: a drift test, and it is exhaustive rather than
 * illustrative. `CONCEPTUAL_DATA_TYPE_NAMES` is the metamodel's own
 * list, so a data type added later is covered here the day it is added
 * rather than the day someone remembers this file.
 *
 * Several indices because both sides vary with it: `boolean` alternates
 * its two values, and the numeric types walk upward, so a defect that
 * only shows at an odd index is reachable.
 */
import { describe, expect, it } from "vitest";
import { CONCEPTUAL_DATA_TYPE_NAMES } from "../../src/model/ObjectType.js";
import { dataTypeAdmits, mintValueOfType } from "../../src/model/valueDomain.js";

const INDICES = [0, 1, 2, 3];

describe("what a data type mints, the same data type admits", () => {
  it.each(CONCEPTUAL_DATA_TYPE_NAMES)("%s", (type) => {
    for (const index of INDICES) {
      const minted = mintValueOfType(type, index);
      if (minted === undefined) continue; // no constructor for this type
      expect(
        dataTypeAdmits(type, minted),
        `mintValueOfType(${type}, ${index}) produced ${JSON.stringify(minted)}, `
          + "which dataTypeAdmits rejects",
      ).toBe(true);
    }
  });

  it("covers every type the minter constructs, and says which those are", () => {
    // The assertion above is vacuous for a type that mints nothing, and
    // a reader cannot tell which those are. Naming them here means a
    // type that STOPS minting -- a switch arm deleted -- fails, rather
    // than quietly turning its row above into a no-op.
    const constructed = CONCEPTUAL_DATA_TYPE_NAMES.filter(
      (type) => mintValueOfType(type, 0) !== undefined,
    );
    expect([...constructed].sort()).toEqual(
      ["auto_counter", "boolean", "decimal", "float", "integer", "money"],
    );
  });
});
