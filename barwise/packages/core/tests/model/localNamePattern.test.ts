/**
 * Format 4.0's id patterns (iri-identity WS6, the schema bullet): every
 * name's local name matches the local-name pattern, so a 4.0 file holds
 * what `localName` gives; the rule-given shapes of role, population and
 * instance ids match theirs; and `.` and `:` stay out of a local name.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  INSTANCE_ID_PATTERN,
  LOCAL_NAME_PATTERN,
  localName,
  REFERENCE_PATTERN,
  ROLE_ID_PATTERN,
} from "../../src/model/name.js";

describe("format 4.0's id patterns", () => {
  it("match every local name localName gives", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary", minLength: 1 }), (name) => {
        const local = localName(name);
        fc.pre(local !== "");
        expect(local).toMatch(LOCAL_NAME_PATTERN);
        expect(`${local}.${local}`).toMatch(ROLE_ID_PATTERN);
        expect(`${local}.population.${local}`).toMatch(INSTANCE_ID_PATTERN);
        expect(`${local}:${local}`).toMatch(REFERENCE_PATTERN);
      }),
      { seed: 20261030, numRuns: 500 },
    );
  });

  it("refuse what no rule gives", () => {
    for (const id of ["", "a.b", "a:b", "a b", "%2e", "a%2", "‎", "a#b", "a/b"]) {
      expect(id, id).not.toMatch(LOCAL_NAME_PATTERN);
    }
    expect("Ft").not.toMatch(ROLE_ID_PATTERN);
    expect("Ft.a.b").not.toMatch(ROLE_ID_PATTERN);
    expect("0193c8e2-6f4b-7c3a-9d1e-2b4f6a8c0e12").not.toMatch(ROLE_ID_PATTERN);
    expect("Ft.population").not.toMatch(INSTANCE_ID_PATTERN);
    expect("a:b:c").not.toMatch(REFERENCE_PATTERN);
    expect("Person_drives_Car.population_2").toMatch(ROLE_ID_PATTERN);
  });
});
