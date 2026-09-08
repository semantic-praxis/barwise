/**
 * What the change variants have to guarantee, and what the compiler
 * cannot check on its own.
 *
 * The compiler already covers the drift that used to need a source
 * scanner: a variant with no classification row is a missing key in
 * `CHANGE_LEVEL`, a row for a variant that no longer exists is an
 * excess property, and a variant with no rendering arm makes
 * `describeChange` fall off its end. All three are build errors, which
 * is why the scanner in `breakingLevelDrift.test.ts` is gone rather
 * than ported.
 *
 * Two things remain that a type cannot state. The prose is what four
 * packages display, and a type says nothing about what a sentence
 * reads like -- so every variant has a golden here, and the list is
 * checked against `CHANGE_KINDS` so a new variant cannot arrive
 * without one. And a variant is required to carry a COPY of what it
 * found, which no signature expresses: `readonly` stops the delta
 * being reassigned, not the model underneath it being edited.
 */

import { describe, expect, it } from "vitest";
import { CHANGE_KINDS } from "../../src/diff/breakingLevel.js";
import type { ChangeDescription, ChangeKind } from "../../src/diff/changeDescription.js";
import { describeChange } from "../../src/diff/changeDescription.js";
import { diffModels } from "../../src/diff/ModelDiff.js";
import { OrmModel } from "../../src/model/OrmModel.js";

function role(name: string, playerName: string) {
  return { id: `role-${name}`, name, playerId: `ot-${playerName}`, playerName };
}

/**
 * One sample of each variant and the sentence it renders.
 *
 * These strings are the ones the diff emitted before the variants
 * existed, byte for byte. They are a golden rather than a derivation
 * because they are the output contract: the CLI prints them, the MCP
 * tool returns them in its JSON, and the VS Code extension joins them
 * into a summary.
 */
const GOLDENS: ReadonlyArray<{ sample: ChangeDescription; text: string; }> = [
  { sample: { change: "kind", from: "entity", to: "value" }, text: "kind: entity -> value" },
  {
    sample: { change: "referenceMode", from: "customer_id", to: undefined },
    text: `reference mode: "customer_id" -> "(none)"`,
  },
  {
    sample: { change: "sourceContext", from: undefined, to: "Sales" },
    text: `source context: "(none)" -> "Sales"`,
  },
  {
    sample: { change: "valueConstraint", from: undefined, to: { values: ["A", "B"] } },
    text: "value constraint changed",
  },
  {
    sample: { change: "cardinality", from: { min: 0, max: "unbounded" }, to: { min: 1, max: 5 } },
    text: "cardinality changed",
  },
  {
    sample: { change: "independent", from: false, to: true },
    text: "independent: false -> true",
  },
  {
    sample: { change: "defaultValue", from: "0", to: undefined },
    text: `default value: "0" -> "(none)"`,
  },
  { sample: { change: "aliases", from: ["Buyer"], to: [] }, text: "aliases changed" },
  {
    sample: {
      change: "dataTypeChanged",
      from: { name: "varchar", length: 10 },
      to: { name: "varchar", length: 20 },
    },
    text: "data type: varchar(10) -> varchar(20)",
  },
  {
    sample: { change: "dataTypeAdded", to: { name: "integer" } },
    text: "data type added: integer",
  },
  {
    sample: { change: "dataTypeRemoved", from: { name: "decimal", length: 10, scale: 2 } },
    text: "data type removed (was decimal(10,2))",
  },
  { sample: { change: "arity", from: 2, to: 3 }, text: "arity: 2 -> 3" },
  {
    sample: {
      change: "rolePlayer",
      index: 0,
      from: role("buyer", "Customer"),
      to: role("buyer", "Client"),
    },
    text: "role 0: player Customer -> Client",
  },
  {
    sample: {
      change: "roleName",
      index: 1,
      from: role("buyer", "Customer"),
      to: role("purchaser", "Customer"),
    },
    text: `role 1: name "buyer" -> "purchaser"`,
  },
  {
    sample: { change: "readings", from: ["{0} buys {1}"], to: ["{0} purchases {1}"] },
    text: "readings changed",
  },
  {
    // Deduplicated and in first-seen order, which is what the prose did
    // when it was built from the constraint list directly.
    sample: {
      change: "constraintsAdded",
      constraints: [
        { type: "mandatory", roleId: "r1" },
        { type: "internal_uniqueness", roleIds: ["r1"] },
        { type: "mandatory", roleId: "r2" },
      ],
    },
    text: "constraints added: mandatory, internal_uniqueness",
  },
  {
    sample: { change: "constraintsRemoved", constraints: [{ type: "exclusion", roleIds: ["r1"] }] },
    text: "constraints removed: exclusion",
  },
  {
    sample: {
      change: "derivation",
      from: undefined,
      to: { kind: "derived", expression: "x", isFormal: false },
    },
    text: "derivation changed",
  },
  {
    sample: { change: "definition", from: "A buyer.", to: "A purchaser." },
    text: "definition changed",
  },
  { sample: { change: "note", from: undefined, to: "Reviewed." }, text: "note changed" },
  {
    sample: { change: "definitionText", from: "Leaving.", to: "Ceasing to be a customer." },
    text: "definition text changed",
  },
  {
    sample: { change: "context", from: "Sales", to: undefined },
    text: `context: "Sales" -> "(none)"`,
  },
  {
    sample: { change: "providesIdentification", from: true, to: false },
    text: "provides identification: true -> false",
  },
  {
    sample: { change: "subtypeExclusive", from: false, to: true },
    text: "exclusive: false -> true",
  },
  {
    sample: { change: "subtypeExhaustive", from: false, to: true },
    text: "exhaustive: false -> true",
  },
  {
    sample: {
      change: "definingRule",
      from: undefined,
      to: { kind: "derived", expression: "Employee with rank > 5", isFormal: false },
    },
    text: "defining rule changed",
  },
];

describe("rendering a change", () => {
  it("has a golden for every kind of change the diff can emit", () => {
    const covered = new Set<ChangeKind>(GOLDENS.map((g) => g.sample.change));
    const uncovered = CHANGE_KINDS.filter((kind) => !covered.has(kind));
    expect(uncovered).toEqual([]);
  });

  it("renders no kind of change twice under one sample set", () => {
    // Two variants rendering the same sentence would make the prose
    // ambiguous for the surfaces that only read it -- which is how
    // `definition changed` and `definition text changed` came to be
    // classified differently in the first place.
    const texts = GOLDENS.map((g) => g.text);
    expect(new Set(texts).size).toBe(texts.length);
  });

  for (const { sample, text } of GOLDENS) {
    it(`renders ${sample.change} as it always has`, () => {
      expect(describeChange(sample)).toBe(text);
    });
  }
});

describe("a delta carries copies, not references into the models", () => {
  /** A model whose fact type has a constraint the diff will report as added. */
  function model(withConstraint: boolean) {
    const m = new OrmModel({ name: "M" });
    const customer = m.addObjectType({
      name: "Customer",
      kind: "entity",
      referenceMode: "customer_id",
    });
    const order = m.addObjectType({ name: "Order", kind: "entity", referenceMode: "order_id" });
    const ft = m.addFactType({
      name: "CustomerPlacesOrder",
      roles: [
        { name: "placer", playerId: customer.id },
        { name: "placed", playerId: order.id },
      ],
      readings: ["{0} places {1}"],
    });
    if (withConstraint) {
      ft.addConstraint({ type: "mandatory", roleId: ft.roles[0]!.id });
    }
    return { m, ft };
  }

  it("survives a later mutation of the model it was computed from", () => {
    const before = model(false);
    const after = model(true);

    const { deltas } = diffModels(before.m, after.m);
    const factDelta = deltas.find((d) => d.elementType === "fact_type" && d.kind === "modified");
    expect(factDelta).toBeDefined();

    const added = factDelta!.changes.find((c) => c.change === "constraintsAdded");
    expect(added).toBeDefined();
    const carried = added!.constraints[0]!;
    expect(carried.type).toBe("mandatory");

    // Mutate the source constraint the way a caller holding the model
    // would. A variant carrying a reference would follow it; the copy
    // does not. This is the aliasing shape the merge's diagram layouts
    // had, found the same day this union was designed.
    const source = after.ft.constraints[0]! as { roleId: string; };
    const originalRoleId = source.roleId;
    source.roleId = "mutated-after-the-diff";

    expect(carried).not.toBe(source);
    expect((carried as { roleId: string; }).roleId).toBe(originalRoleId);
  });
});
