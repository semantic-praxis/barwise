/**
 * The cross-field harness holds for fact types (docs/specs/effect-adoption
 * .spec.md, 1r, R3), by R1's and R2's planted defects: each plant goes into
 * every corpus fact type, and the decoder must report exactly the paths the
 * plant declares. The reading rule's pairs break it beside a field error in
 * the same struct, and beside a role's error, where Effect alone would not
 * run it.
 *
 * Derived fact types are not among the inputs: a derived reading almost
 * never names each role, so derivation discards nearly every value (the
 * spec's R3 notes record it for M1).
 */
import { describe, expect, it } from "vitest";
import { InternalConstraintFile } from "../../src/decode/constraint.js";
import { FactTypeFile } from "../../src/decode/factType.js";
import { keysRead, markedChecks, nodesOf, reportedPaths } from "../helpers/decodeHarness.js";
import { modelCorpus } from "../helpers/modelCorpus.js";

type Doc = Record<string, unknown>;

interface Plant {
  readonly name: string;
  readonly plant: (doc: Doc) => Doc | undefined;
  readonly paths: readonly string[];
  readonly rule?: string;
}

const without = (doc: Doc, key: string) =>
  Object.fromEntries(Object.entries(doc).filter(([k]) => k !== key));
const roles = (doc: Doc) => doc.roles as Doc[];
/** A reading naming a role the fact type does not have. */
const strayReading = (doc: Doc) => `{0} r {${roles(doc).length + 3}}`;

const PLANTS: readonly Plant[] = [
  { name: "drop id", plant: (d) => without(d, "id"), paths: ["id"] },
  { name: "drop name", plant: (d) => without(d, "name"), paths: ["name"] },
  { name: "a blank name", plant: (d) => ({ ...d, name: "  " }), paths: ["name"] },
  { name: "drop roles", plant: (d) => without(d, "roles"), paths: ["roles"] },
  { name: "drop readings", plant: (d) => without(d, "readings"), paths: ["readings"] },
  { name: "add an unknown field", plant: (d) => ({ ...d, colour: 1 }), paths: ["colour"] },
  {
    name: "a role without a player",
    plant: (d) => ({ ...d, roles: [without(roles(d)[0]!, "player"), ...roles(d).slice(1)] }),
    paths: ["roles.0.player"],
  },
  {
    name: "a blank reading, reported once",
    plant: (d) => ({ ...d, readings: ["  ", ...(d.readings as string[])] }),
    paths: ["readings.0"],
  },
  // A control: the rule broken alone, which Effect reports without help.
  {
    name: "a reading naming a role the fact type lacks",
    plant: (d) => ({ ...d, readings: [strayReading(d)] }),
    paths: ["readings.0"],
  },
  {
    name: "no roles, which the readings do not repeat",
    plant: (d) => ({ ...d, roles: [] }),
    paths: ["roles"],
  },
  // Pairs: the rule broken beside a field error, and beside a role's.
  {
    name: "a stray placeholder, beside an unknown field",
    plant: (d) => ({ ...d, readings: [strayReading(d)], colour: 1 }),
    paths: ["colour", "readings.0"],
    rule: "readings-fit-roles",
  },
  {
    name: "a stray placeholder, beside a role without a player",
    plant: (d) => ({
      ...d,
      readings: [strayReading(d)],
      roles: [without(roles(d)[0]!, "player"), ...roles(d).slice(1)],
    }),
    paths: ["readings.0", "roles.0.player"],
    rule: "readings-fit-roles",
  },
];

const inputs = modelCorpus().flatMap(({ doc }) => (doc.model.fact_types ?? []) as unknown as Doc[]);
const reported = (doc: Doc, harness = true) => reportedPaths(FactTypeFile, doc, harness);

/** The fact type's own rules: its constraints' are held by the constraint harness test. */
const constraintRules = new Set(markedChecks(InternalConstraintFile.ast).map((c) => c.mark.id));
const marked = markedChecks(FactTypeFile.ast).filter((c) => !constraintRules.has(c.mark.id));

describe("the cross-field harness, over fact types", () => {
  it("starts from inputs that all decode", () => {
    expect(inputs.length).toBeGreaterThan(1000);
    for (const doc of inputs) expect([doc.id, reported(doc)]).toEqual([doc.id, []]);
  });

  for (const p of PLANTS) {
    it(`reports exactly what is planted: ${p.name}`, () => {
      for (const doc of inputs) {
        expect([doc.id, reported(p.plant(doc)!)]).toEqual([doc.id, [...p.paths].sort()]);
      }
    });
  }

  it("is what reports each pair's rule: without it, the rule goes unreported", () => {
    for (const p of PLANTS.filter((p) => p.rule)) {
      const planted = p.plant(inputs[0]!)!;
      expect([p.name, reported(planted).length - reported(planted, false).length]).toEqual([
        p.name,
        1,
      ]);
    }
  });

  it("has a pair for every rule the fact type marks", () => {
    const pairs = new Set(PLANTS.flatMap((p) => (p.rule ? [p.rule] : [])));
    expect([...new Set(marked.map((c) => c.mark.id))].sort()).toEqual([...pairs].sort());
  });

  it("runs each rule only on fields it declares it reads", () => {
    for (const { node, check, mark } of marked) {
      expect([mark.id, keysRead(check, node)]).toEqual([mark.id, [...mark.reads].sort()]);
    }
  });

  it("walks a Schema that makes no transformation, so a decoded value is the raw one", () => {
    expect(nodesOf(FactTypeFile.ast).filter((n) => n.encoding !== undefined)).toEqual([]);
  });
});
