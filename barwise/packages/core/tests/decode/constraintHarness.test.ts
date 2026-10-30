/**
 * The cross-field harness holds for constraints (docs/specs/effect-adoption
 * .spec.md, 1r, R2), by the same planted defects R1's object type test uses:
 * each plant goes into every valid constraint -- the corpus's and derived
 * ones -- in the list it lives in, and the decoder must report exactly the
 * paths the plant declares. The pairs break each rule beside a field error
 * in the same struct, where Effect alone would not run it; each is shown to
 * need the harness, and every rule the two lists mark has a pair.
 */
import type * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { ExternalConstraintFile, InternalConstraintFile } from "../../src/decode/constraint.js";
import { CONSTRAINT_TYPES, placementOf } from "../../src/model/Constraint.js";
import { keysRead, markedChecks, nodesOf, reportedPaths } from "../helpers/decodeHarness.js";
import { derivedConstraints } from "../helpers/derivedConstraints.js";
import { corpusConstraints } from "../helpers/modelCorpus.js";

type Doc = Record<string, unknown>;
type Where = "internal" | "external";

interface Input {
  readonly where: Where;
  readonly doc: Doc;
}

interface Plant {
  readonly name: string;
  /** The planted input, or undefined when the plant does not apply to this one. */
  readonly plant: (input: Input) => Input | undefined;
  /** Every path the decoder must report, and no other. */
  readonly paths: readonly string[];
  /** For a pair: the rule it breaks beside a field error. */
  readonly rule?: string;
}

const LISTS: Record<Where, Schema.Top> = {
  internal: InternalConstraintFile,
  external: ExternalConstraintFile,
};

const without = (doc: Doc, ...keys: string[]) =>
  Object.fromEntries(Object.entries(doc).filter(([k]) => !keys.includes(k)));
const ofType = (...types: string[]) => (input: Input) => types.includes(String(input.doc.type));
const other = (where: Where): Where => (where === "internal" ? "external" : "internal");
const OPERAND_KINDS = ["disjunctive_mandatory", "exclusion", "exclusive_or"];

const edit = (applies: (input: Input) => boolean, change: (doc: Doc) => Doc) => (input: Input) =>
  applies(input) ? { where: input.where, doc: change(input.doc) } : undefined;
const always = () => true;

const PLANTS: readonly Plant[] = [
  { name: "drop id", plant: edit(always, (d) => without(d, "id")), paths: ["id"] },
  { name: "drop type", plant: edit(always, (d) => without(d, "type")), paths: ["type"] },
  {
    name: "an unknown type",
    plant: edit(always, (d) => ({ ...d, type: "nonesuch" })),
    paths: ["type"],
  },
  {
    name: "add an unknown field",
    plant: edit(always, (d) => ({ ...d, colour: "blue" })),
    paths: ["colour"],
  },
  {
    name: "an unknown modality",
    plant: edit(always, (d) => ({ ...d, modality: "possible" })),
    paths: ["modality"],
  },
  // Controls: each rule broken alone, which Effect reports without help.
  {
    name: "listed in the other list",
    plant: (input) => ({ where: other(input.where), doc: input.doc }),
    paths: [""],
  },
  {
    name: "a value constraint with neither values nor ranges",
    plant: edit(ofType("value_constraint"), (d) => without(d, "values", "ranges")),
    paths: [""],
  },
  {
    name: "a frequency with neither role nor roles",
    plant: edit(ofType("frequency"), (d) => without(d, "role", "roles")),
    paths: [""],
  },
  {
    name: "an operand with neither roles nor subtype facts",
    plant: edit(ofType(...OPERAND_KINDS), (d) => without(d, "roles", "subtype_facts")),
    paths: [""],
  },
  {
    name: "an operand with both roles and subtype facts",
    plant: edit(
      ofType(...OPERAND_KINDS),
      (d) => ({ ...d, roles: ["a", "b"], subtype_facts: ["s"] }),
    ),
    paths: ["subtype_facts"],
  },
  {
    name: "a range with neither bound",
    plant: edit(ofType("value_constraint"), (d) => ({ ...d, ranges: [{}] })),
    paths: ["ranges.0"],
  },
  {
    name: "two roles required, one given",
    plant: edit(
      ofType(...OPERAND_KINDS),
      (d) => ({ ...without(d, "subtype_facts"), roles: ["a"] }),
    ),
    paths: ["roles"],
  },
  {
    name: "two operands required, one given",
    plant: edit(
      ofType("join_equality", "join_exclusion"),
      (d) => ({ ...d, operands: [(d.operands as unknown[])[0]] }),
    ),
    paths: ["operands"],
  },
  // Pairs: each rule broken beside a field error in the same struct, or,
  // for a list's length, beside a bad item in the same list.
  {
    name: "two roles required, one given and empty",
    plant: edit(ofType(...OPERAND_KINDS), (d) => ({ ...without(d, "subtype_facts"), roles: [""] })),
    paths: ["roles", "roles.0"],
    rule: "list-min-length",
  },
  {
    name: "two operands required, one given with an empty root",
    plant: edit(ofType("join_equality", "join_exclusion"), (d) => ({
      ...d,
      operands: [{ path: { root: "", steps: [] }, projection: [0] }],
    })),
    paths: ["operands", "operands.0.path.root"],
    rule: "list-min-length",
  },
  {
    name: "listed in the other list, beside an unknown field",
    plant: (input) => ({ where: other(input.where), doc: { ...input.doc, colour: 1 } }),
    paths: ["", "colour"],
    rule: "constraint-placement",
  },
  {
    name: "neither values nor ranges, beside an unknown field",
    plant: edit(
      ofType("value_constraint"),
      (d) => ({ ...without(d, "values", "ranges"), colour: 1 }),
    ),
    paths: ["", "colour"],
    rule: "value-constraint-content",
  },
  {
    name: "neither role nor roles, beside an unknown field",
    plant: edit(ofType("frequency"), (d) => ({ ...without(d, "role", "roles"), colour: 1 })),
    paths: ["", "colour"],
    rule: "frequency-role-or-roles",
  },
  {
    name: "both roles and subtype facts, beside an unknown field",
    plant: edit(
      ofType(...OPERAND_KINDS),
      (d) => ({ ...d, roles: ["a", "b"], subtype_facts: ["s"], colour: 1 }),
    ),
    paths: ["colour", "subtype_facts"],
    rule: "roles-or-subtype-facts",
  },
  {
    name: "a range with neither bound, beside a mistyped flag",
    plant: edit(ofType("value_constraint"), (d) => ({ ...d, ranges: [{ min_inclusive: "no" }] })),
    paths: ["ranges.0", "ranges.0.min_inclusive"],
    rule: "value-range-bound",
  },
];

const inputs: Input[] = [
  ...corpusConstraints().map(({ where, constraint }) => ({ where, doc: constraint })),
  ...CONSTRAINT_TYPES.flatMap((t) =>
    derivedConstraints(t, { count: 20, seed: 7 }).map((doc) => ({
      where: placementOf(t)!,
      doc: doc as unknown as Doc,
    }))
  ),
];

const reported = (input: Input, harness = true) =>
  reportedPaths(LISTS[input.where], input.doc, harness);

const marked = [
  ...markedChecks(InternalConstraintFile.ast),
  ...markedChecks(ExternalConstraintFile.ast),
];

describe("the cross-field harness, over constraints", () => {
  it("starts from inputs that all decode, of every kind", () => {
    expect(inputs.length).toBeGreaterThan(2000);
    expect(new Set(inputs.map((i) => i.doc.type)).size).toBe(CONSTRAINT_TYPES.length);
    for (const input of inputs) expect([input.doc.id, reported(input)]).toEqual([input.doc.id, []]);
  });

  for (const p of PLANTS) {
    it(`reports exactly what is planted: ${p.name}`, () => {
      let applied = 0;
      for (const input of inputs) {
        const planted = p.plant(input);
        if (planted === undefined) continue;
        applied++;
        expect([input.doc.id, reported(planted)]).toEqual([input.doc.id, [...p.paths].sort()]);
      }
      expect(applied).toBeGreaterThan(0);
    });
  }

  it("is what reports each pair's rule: without it, the rule goes unreported", () => {
    for (const p of PLANTS.filter((p) => p.rule)) {
      const input = inputs.find((i) => p.plant(i) !== undefined)!;
      const planted = p.plant(input)!;
      const withHarness = reported(planted);
      const without = reported(planted, false);
      // The rule's own path is the one the harness adds.
      expect([p.name, withHarness.length - without.length]).toEqual([p.name, 1]);
    }
  });

  it("has a pair for every rule the two lists mark", () => {
    const pairs = new Set(PLANTS.flatMap((p) => (p.rule ? [p.rule] : [])));
    expect([...new Set(marked.map((c) => c.mark.id))].sort()).toEqual([...pairs].sort());
  });

  it("runs each rule only on fields it declares it reads", () => {
    for (const { node, check, mark } of marked) {
      expect([mark.id, keysRead(check, node)]).toEqual([mark.id, [...mark.reads].sort()]);
    }
  });

  it("walks Schemas that make no transformation, so a decoded value is the raw one", () => {
    const transforming = [
      ...nodesOf(InternalConstraintFile.ast),
      ...nodesOf(ExternalConstraintFile.ast),
    ].filter((n) => n.encoding !== undefined);
    expect(transforming.map((n) => n._tag)).toEqual([]);
  });
});
