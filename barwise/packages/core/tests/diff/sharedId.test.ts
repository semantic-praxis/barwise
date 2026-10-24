/**
 * A shared id is the same element (model invariants, decision 1): renaming
 * an object type or fact type under its kept id is one modification, and
 * merging it keeps one of everything that refers to it. The renamed-pair
 * law in `tests/laws/renamedPair.law.test.ts` states this over generated
 * models; these are the spec's named cases, small enough to read.
 *
 * Spec: docs/specs/model-invariants.spec.md, WS2 (barwise-ue5).
 */
import { describe, expect, it } from "vitest";
import { diffModels } from "../../src/diff/ModelDiff.js";
import { mergeAndValidate } from "../../src/diff/ModelMerge.js";
import { OrmModel } from "../../src/model/OrmModel.js";

/**
 * `x` plays roles, has a preferred identifier and is a supertype; `f` has
 * a population, an objectification and a constraint across it and `h`.
 */
function model(xName: string, fName: string): OrmModel {
  const m = new OrmModel({ name: "M" });
  m.addObjectType({ id: "x", name: xName, kind: "entity", referenceMode: "x_id" });
  m.addObjectType({ id: "code", name: "Code", kind: "value" });
  m.addObjectType({ id: "sub", name: "Sub", kind: "entity", referenceMode: "sub_id" });
  m.addObjectType({ id: "asg", name: "Assignment", kind: "entity", referenceMode: "asg_id" });
  m.addFactType({
    id: "f",
    name: fName,
    roles: [{ id: "fr0", name: "holder", playerId: "x" }, {
      id: "fr1",
      name: "code",
      playerId: "code",
    }],
    readings: ["{0} has {1}", "{1} is of {0}"],
    constraints: [
      { type: "internal_uniqueness", id: "u1", roleIds: ["fr1"] },
      { type: "internal_uniqueness", id: "u2", roleIds: ["fr0"] },
      { type: "mandatory", id: "m1", roleId: "fr0" },
    ],
  });
  m.addFactType({
    id: "h",
    name: "Archived",
    roles: [{ id: "hr0", name: "archived", playerId: "x" }],
    readings: ["{0} is archived"],
  });
  m.addConstraint({ type: "exclusion", id: "ex1", roleIds: ["fr0", "hr0"] });
  m.setPreferredIdentifier("x", "u1");
  m.addSubtypeFact({ id: "sf1", subtypeId: "sub", supertypeId: "x" });
  m.addObjectifiedFactType({ id: "of1", factTypeId: "f", objectTypeId: "asg" });
  m.addPopulation({
    id: "pop1",
    factTypeId: "f",
    instances: [{ id: "i1", roleValues: { fr0: "x1", fr1: "C1" } }],
  });
  return m;
}

const counts = (m: OrmModel) => ({
  objectTypes: m.objectTypes.length,
  factTypes: m.factTypes.length,
  constraints: m.everyConstraint().length,
  subtypeFacts: m.subtypeFacts.length,
  objectifications: m.objectifiedFactTypes.length,
  populations: m.populations.length,
});

describe("a shared id is the same element", () => {
  it.each([
    { kind: "object type", existing: model("A", "F"), incoming: model("B", "F"), id: "x" },
    { kind: "fact type", existing: model("A", "F"), incoming: model("A", "G"), id: "f" },
  ])("a $kind renamed under its kept id is one modification", ({ existing, incoming, id }) => {
    const { deltas } = diffModels(existing, incoming);
    const changed = deltas.filter((d) => d.kind !== "unchanged");
    expect(changed.map((d) => [d.kind, d.existing?.id])).toEqual([["modified", id]]);

    const at = deltas.indexOf(changed[0]!);
    for (
      const [accepted, side] of [[new Set([at]), incoming], [new Set<number>(), existing]] as const
    ) {
      const result = mergeAndValidate(existing, incoming, deltas, accepted);
      expect(result.diagnostics).toEqual([]);
      const merged = result.model!;
      expect(counts(merged)).toEqual(counts(existing));
      expect(merged.getObjectType("x")!.name).toBe(side.getObjectType("x")!.name);
      expect(merged.getFactType("f")!.name).toBe(side.getFactType("f")!.name);
      expect(merged.preferredIdentifierOf("x")).toBe("u1");
      expect(merged.subtypeFacts[0]!.supertypeId).toBe("x");
      expect(merged.objectifiedFactTypes[0]!.factTypeId).toBe("f");
      expect(merged.populations[0]!.factTypeId).toBe("f");
    }
  });

  it("refuses a swap decided half-way, naming both elements", () => {
    const swapped = (first: string, second: string) => {
      const m = new OrmModel({ name: "M" });
      m.addObjectType({ id: "a", name: first, kind: "value" });
      m.addObjectType({ id: "b", name: second, kind: "value" });
      return m;
    };
    const existing = swapped("Customer", "Client");
    const incoming = swapped("Client", "Customer");
    const { deltas } = diffModels(existing, incoming);
    const renameA = deltas.findIndex((d) => d.existing?.id === "a");

    const result = mergeAndValidate(existing, incoming, deltas, new Set([renameA]));
    expect(result.model).toBeNull();
    expect(result.diagnostics.map((d) => d.message)).toEqual([
      'Merge failed: two elements would take one name: object type "Client": '
      + 'a (renamed from "Customer"), b (kept, the rename to "Customer" not accepted). '
      + "Accept or reject the changes that share a name together, "
      + "or rename one of them in the base model first.",
    ]);
    // Deciding both together is fine either way.
    const all = new Set(deltas.map((_, i) => i));
    expect(mergeAndValidate(existing, incoming, deltas, all).model?.getObjectType("a")?.name)
      .toBe("Client");
  });

  it("refuses a rename onto a removed name when the removal is rejected", () => {
    // The default policy of `barwise merge`, the MCP merge tool and
    // transcript import: accept additions and modifications, reject
    // removals. Pairing by name used to read this as A removed and B
    // unchanged, so that policy kept A and silently lost the rename.
    const existing = new OrmModel({ name: "M" });
    existing.addObjectType({ id: "1", name: "A", kind: "value" });
    existing.addObjectType({ id: "2", name: "B", kind: "value" });
    const incoming = new OrmModel({ name: "M" });
    incoming.addObjectType({ id: "1", name: "B", kind: "value" });
    const { deltas } = diffModels(existing, incoming);
    const policy = new Set(deltas.flatMap((d, i) => (d.kind === "removed" ? [] : [i])));

    expect(mergeAndValidate(existing, incoming, deltas, policy).diagnostics.map((d) => d.message))
      .toEqual([
        'Merge failed: two elements would take one name: object type "B": '
        + '1 (renamed from "A"), '
        + "2 (removed by the incoming model, kept because the removal was not accepted). "
        + "Accept or reject the changes that share a name together, "
        + "or rename one of them in the base model first.",
      ]);
    const all = new Set(deltas.map((_, i) => i));
    expect(mergeAndValidate(existing, incoming, deltas, all).model?.objectTypes.map((o) => o.id))
      .toEqual(["1"]);
  });

  it("under content matching, coinciding positional ids pair by name", () => {
    // Two LLM samples: each numbered its object types in its own order, so
    // `ot0` is Dog in one and Cat in the other.
    const sample = (order: readonly string[]) => {
      const m = new OrmModel({ name: "S" });
      order.forEach((name, i) => m.addObjectType({ id: `ot${i}`, name, kind: "value" }));
      m.addFactType({
        id: "ft0",
        name: "Barks",
        roles: [{ id: "ft0r0", name: "barker", playerId: `ot${order.indexOf("Dog")}` }],
        readings: ["{0} barks"],
      });
      return m;
    };
    const a = sample(["Dog", "Cat"]);
    const b = sample(["Cat", "Dog"]);

    expect(diffModels(a, b, { matching: "content" }).deltas.filter((d) => d.kind !== "unchanged"))
      .toEqual([]);
    // Id-first reads the same pair as two renames and a fact type whose
    // player moved, which is right for two versions of one model and wrong
    // for two samples.
    expect(
      diffModels(a, b).deltas.filter((d) => d.kind !== "unchanged").map((d) => d.existing?.id),
    ).toEqual(["ot0", "ot1", "ft0"]);
  });
});
