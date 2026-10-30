/**
 * The cross-field harness reports a rule over several fields whatever else
 * is wrong (docs/specs/effect-adoption.spec.md, WS1b part A; 1r, R1).
 *
 * Held by planted defects, which need no second validator: a plant knows
 * where it put its defect. Each plant is put into every valid input -- the
 * corpus's object types and derived ones -- and the decoder must report
 * exactly the paths the plant declares, no more and no fewer.
 *
 * A single cross-field plant does not exercise the blind spot -- the
 * struct's other fields still decode, so Effect runs the rule anyway -- and
 * is kept as a control. The cases that do are pairs: the rule broken beside
 * an unrelated field error in the same struct. Each pair is shown to need
 * the harness (without it the rule goes unreported), and every rule the
 * Schema marks has a pair, so a marked rule cannot be left untested.
 */
import * as Arbitrary from "effect/Arbitrary";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import { ObjectTypeFile } from "../../src/decode/objectType.js";
import {
  declaredReads,
  keysRead,
  markedChecks,
  nodesOf,
  reportedPaths,
} from "../helpers/decodeHarness.js";
import { modelCorpus } from "../helpers/modelCorpus.js";

type Doc = Record<string, unknown>;

interface Plant {
  readonly name: string;
  /** The planted input, or undefined when the plant does not apply to this one. */
  readonly plant: (doc: Doc) => Doc | undefined;
  /** Every path the decoder must report, and no other. */
  readonly paths: readonly string[];
  /** For a pair: the rule it breaks beside a field error. */
  readonly rule?: string;
}

const without = (doc: Doc, key: string) => {
  const { [key]: _dropped, ...rest } = doc;
  return rest;
};
const isValue = (doc: Doc) => doc.kind === "value";
const isEntity = (doc: Doc) => doc.kind === "entity";

const PLANTS: readonly Plant[] = [
  { name: "drop id", plant: (d) => without(d, "id"), paths: ["id"] },
  { name: "drop name", plant: (d) => without(d, "name"), paths: ["name"] },
  { name: "drop kind", plant: (d) => without(d, "kind"), paths: [""] },
  {
    name: "drop an entity's reference mode",
    plant: (d) => (isEntity(d) ? without(d, "reference_mode") : undefined),
    paths: ["reference_mode"],
  },
  { name: "add an unknown field", plant: (d) => ({ ...d, colour: "blue" }), paths: ["colour"] },
  { name: "give the name a number", plant: (d) => ({ ...d, name: 3 }), paths: ["name"] },
  // Controls: each rule broken alone, which Effect reports without help.
  {
    name: "cardinality max below min",
    plant: (d) => ({ ...d, cardinality: { min: 5, max: 1 } }),
    paths: ["cardinality"],
  },
  {
    name: "a value constraint with neither values nor ranges",
    plant: (d) => (isValue(d) ? { ...d, value_constraint: {} } : undefined),
    paths: ["value_constraint"],
  },
  {
    name: "a range with neither bound",
    plant: (d) => (isValue(d) ? { ...d, value_constraint: { ranges: [{}] } } : undefined),
    paths: ["value_constraint.ranges.0"],
  },
  // Pairs: each rule broken beside a field error in the same struct.
  {
    name: "cardinality max below min, beside an unknown field",
    plant: (d) => ({ ...d, cardinality: { min: 5, max: 1, colour: 1 } }),
    paths: ["cardinality.colour", "cardinality"],
    rule: "cardinality-order",
  },
  {
    name: "an empty value constraint, beside an unknown field",
    plant: (d) => (isValue(d) ? { ...d, value_constraint: { colour: 1 } } : undefined),
    paths: ["value_constraint.colour", "value_constraint"],
    rule: "value-constraint-content",
  },
  {
    name: "a range with neither bound, beside a mistyped flag",
    plant: (d) =>
      isValue(d) ? { ...d, value_constraint: { ranges: [{ min_inclusive: "no" }] } } : undefined,
    paths: ["value_constraint.ranges.0.min_inclusive", "value_constraint.ranges.0"],
    rule: "value-range-bound",
  },
];

const inputs: Doc[] = [
  ...modelCorpus().flatMap(({ doc }) => (doc.model.object_types ?? []) as unknown as Doc[]),
  ...(Effect.runSync(
    Arbitrary.sampleEffect(Arbitrary.schema(ObjectTypeFile), { count: 200, seed: 7 }),
  ) as unknown as Doc[]),
];

/** Every path a decode reports, through the shell's own walk, harness on or off. */
const reported = (doc: Doc, harness = true) => reportedPaths(ObjectTypeFile, doc, harness);

describe("the cross-field harness", () => {
  it("starts from inputs that all decode", () => {
    expect(inputs.length).toBeGreaterThan(700);
    for (const doc of inputs) expect(reported(doc)).toEqual([]);
  });

  for (const p of PLANTS) {
    it(`reports exactly what is planted: ${p.name}`, () => {
      let applied = 0;
      for (const doc of inputs) {
        const planted = p.plant(doc);
        if (planted === undefined) continue;
        applied++;
        expect([doc.id, reported(planted)]).toEqual([doc.id, [...p.paths].sort()]);
      }
      expect(applied).toBeGreaterThan(0);
    });
  }

  it("is what reports each pair's rule: without it, the rule goes unreported", () => {
    for (const p of PLANTS.filter((p) => p.rule)) {
      const doc = inputs.find((d) => p.plant(d) !== undefined)!;
      const rulePath = p.paths.at(-1)!;
      expect([p.name, reported(p.plant(doc)!, false).includes(rulePath)]).toEqual([p.name, false]);
    }
  });

  it("has a pair for every rule the Schema marks", () => {
    const pairs = new Set(PLANTS.flatMap((p) => (p.rule ? [p.rule] : [])));
    const marked = new Set(markedChecks(ObjectTypeFile.ast).map((c) => c.mark.id));
    expect([...marked].sort()).toEqual([...pairs].sort());
  });

  it("runs each rule only on fields it declares it reads", () => {
    // A rule that read an undeclared field would run on it after that
    // field failed, and misread it.
    for (const { node, check, mark } of markedChecks(ObjectTypeFile.ast)) {
      expect([mark.id, keysRead(check, node)]).toEqual([mark.id, declaredReads(mark)]);
    }
  });

  it("walks a Schema that makes no transformation, so a decoded value is the raw one", () => {
    // A key rename or a decoding default anywhere would have the harness run
    // a rule on a shape Effect never checked.
    const transforming = nodesOf(ObjectTypeFile.ast).filter((n) => n.encoding !== undefined);
    expect(transforming.map((n) => n._tag)).toEqual([]);
  });
});
