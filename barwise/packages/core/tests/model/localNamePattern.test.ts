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

/**
 * Whether localName keeps a character rather than encoding or dropping it.
 * Not "returns it unchanged": NFC rewrites some kept characters (U+2F800
 * becomes U+4E3D), which is normalization, not a character the pattern
 * should refuse.
 */
const kept = (ch: string) => {
  const local = localName(ch);
  return local !== "" && !local.includes("%");
};

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

  it("accept a character exactly when localName keeps it", () => {
    // The other direction: the pattern restates localName's kept characters
    // and ranges, so a character the pattern takes and localName encodes
    // (or the reverse) is a drift between the two statements.
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0x10ffff }), (cp) => {
        const ch = cp >= 0xd800 && cp <= 0xdfff
          ? String.fromCharCode(cp)
          : String.fromCodePoint(cp);
        expect([cp.toString(16), LOCAL_NAME_PATTERN.test(ch)]).toEqual([
          cp.toString(16),
          kept(ch),
        ]);
      }),
      { seed: 20261030, numRuns: 20000 },
    );
    // The edges of each range, which random code points rarely land on.
    for (
      const cp of [
        0x9f,
        0xa0,
        0x200d,
        0x200e,
        0x200f,
        0x2010,
        0x2029,
        0x202a,
        0x202e,
        0x202f,
        0x2065,
        0x2066,
        0x2069,
        0x206a,
        0xd7ff,
        0xe000,
        0xf8ff,
        0xf900,
        0xfdcf,
        0xfdd0,
        0xfdef,
        0xfdf0,
        0xffef,
        0xfff0,
        0x1fffd,
        0x1fffe,
        0xdfffd,
        0xe0000,
        0xe0fff,
        0xe1000,
        0xefffd,
        0xefffe,
        0xf0000,
        0x10fffd,
      ]
    ) {
      const ch = String.fromCodePoint(cp);
      expect([cp.toString(16), LOCAL_NAME_PATTERN.test(ch)]).toEqual([
        cp.toString(16),
        kept(ch),
      ]);
    }
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
