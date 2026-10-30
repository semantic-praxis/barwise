/**
 * The model's id index (iri-identity WS6, 6b): every id the model holds,
 * across kinds, kept in step with the per-kind stores through every add and
 * remove, and the constraints a fact type in the model is given later.
 *
 * Spec: docs/specs/iri-identity.spec.md, WS6 6b, "The cross-kind index".
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Constraint } from "../../src/model/Constraint.js";
import { FactType } from "../../src/model/FactType.js";
import { IdIndex, type IdKind } from "../../src/model/idIndex.js";
import { DuplicateIdError, OrmModel } from "../../src/model/OrmModel.js";
import { arbOrmModel } from "../arbitraries/model.js";

/** What the index should hold, recomputed from the stores. */
function expected(model: OrmModel): Map<string, Map<IdKind, number>> {
  const held = new Map<string, Map<IdKind, number>>();
  const hold = (id: string | undefined, kind: IdKind) => {
    if (id === undefined) return;
    const kinds = held.get(id) ?? new Map<IdKind, number>();
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    held.set(id, kinds);
  };
  for (const ot of model.objectTypes) hold(ot.id, "object type");
  for (const ft of model.factTypes) {
    hold(ft.id, "fact type");
    for (const r of ft.roles) hold(r.id, "role");
    for (const c of ft.internalConstraints) hold(c.id, "constraint");
  }
  for (const c of model.constraints) hold(c.id, "constraint");
  for (const sf of model.subtypeFacts) hold(sf.id, "subtype fact");
  for (const o of model.objectifiedFactTypes) hold(o.id, "objectification");
  for (const p of model.populations) hold(p.id, "population");
  return held;
}

/** The index itself; private, read here because the invariant is about it. */
const indexOf = (model: OrmModel) => (model as unknown as { _ids: IdIndex; })._ids.snapshot();

describe("IdIndex", () => {
  it("counts holders by kind, and forgets an id when its last holder goes", () => {
    const index = new IdIndex();
    index.hold("x", "constraint");
    index.hold("x", "constraint");
    index.hold("x", "object type");
    index.hold(undefined, "constraint");
    expect(index.kindsHolding("x")).toEqual(["constraint", "object type"]);
    index.release("x", "constraint");
    expect(index.kindsHolding("x")).toEqual(["constraint", "object type"]);
    index.release("x", "constraint");
    index.release("x", "object type");
    expect(index.holds("x")).toBe(false);
    expect(index.kindsHolding("x")).toEqual([]);
  });

  it("refuses to release an id nothing of that kind holds", () => {
    const index = new IdIndex();
    index.hold("x", "role");
    expect(() => index.release("x", "constraint")).toThrow(/no constraint holds "x"/);
    expect(() => index.release("y", "role")).toThrow(/no role holds "y"/);
  });
});

describe("the model's id index", () => {
  it("holds what the stores hold through adds, admissions and removes", () => {
    fc.assert(
      fc.property(arbOrmModel(), fc.array(fc.nat(), { maxLength: 12 }), (model, picks) => {
        expect(indexOf(model)).toEqual(expected(model));
        // Fact types removed along the way, which may be given constraints
        // after they leave: those must reach no index.
        const removed: FactType[] = [];
        for (const pick of picks) {
          // A step the model refuses (an object type still played, a fact
          // type still objectified) changes nothing, so it is skipped.
          const admit = (ft: FactType) => () => {
            ft.addConstraint({ type: "mandatory", roleId: ft.roles[0]!.id });
          };
          const steps: (() => void)[] = [
            ...model.factTypes.map(admit),
            ...removed.map(admit),
            ...model.constraints.map((c) => () => model.removeConstraint(c)),
            ...model.subtypeFacts.map((sf) => () => model.removeSubtypeFact(sf.id)),
            ...model.objectifiedFactTypes.map((o) => () => model.removeObjectifiedFactType(o.id)),
            ...model.populations.map((p) => () => model.removePopulation(p.id)),
            ...model.factTypes.map((ft) => () => {
              model.removeFactType(ft.id);
              removed.push(ft);
            }),
            ...model.objectTypes.map((ot) => () => model.removeObjectType(ot.id)),
          ];
          if (steps.length === 0) break;
          try {
            steps[pick % steps.length]!();
          } catch {
            continue;
          }
          expect(indexOf(model)).toEqual(expected(model));
        }
      }),
      { seed: 20261030, numRuns: 150 },
    );
  });

  it("holds a constraint a fact type in the model is given later", () => {
    const m = new OrmModel({ name: "M" });
    m.addObjectType({ id: "P", name: "Person", kind: "entity", referenceMode: "nr" });
    const ft = m.addFactType({
      id: "f",
      name: "Person smokes",
      roles: [{ id: "f0", name: "smokes", playerId: "P" }],
      readings: ["{0} smokes"],
    });
    const stored = ft.addConstraint({ type: "mandatory", id: "mand", roleId: "f0" });
    expect(stored.id).toBe("mand");
    expect(m.idKindsHolding("mand")).toEqual(["constraint"]);
    // One given no id gets one, and that id is held too.
    const minted = ft.addConstraint({ type: "internal_uniqueness", roleIds: ["f0"] });
    expect(m.idKindsHolding(minted.id!)).toEqual(["constraint"]);
    expect(indexOf(m)).toEqual(expected(m));
  });

  it("is joined once: a fact type is in one model", () => {
    const ft = new FactType({
      name: "Person smokes",
      roles: [{ name: "smokes", playerId: "P" }],
      readings: ["{0} smokes"],
    });
    const admission = { admitConstraint: <C>(c: C) => c };
    ft.joinModel(admission);
    expect(() => ft.joinModel(admission)).toThrow(/already in a model/);
  });

  it("forgets a fact type the model removed: a constraint given it later is held nowhere", () => {
    const m = new OrmModel({ name: "M" });
    m.addObjectType({ id: "P", name: "Person", kind: "entity", referenceMode: "nr" });
    const ft = m.addFactType({
      id: "f",
      name: "Person smokes",
      roles: [{ id: "f0", name: "smokes", playerId: "P" }],
      readings: ["{0} smokes"],
    });
    m.removeFactType("f");
    ft.addConstraint({ type: "mandatory", id: "late", roleId: "f0" });
    expect(m.idKindsHolding("late")).toEqual([]);
    expect(indexOf(m)).toEqual(expected(m));
  });

  it("still refuses an id only within a kind, as format 3.0 does", () => {
    // Across kinds is format 4.0's rule; a 3.0 file may hold one id as an
    // object type's and a fact type's.
    const m = new OrmModel({ name: "M" });
    m.addObjectType({ id: "x", name: "Person", kind: "entity", referenceMode: "nr" });
    m.addFactType({
      id: "x",
      name: "Person smokes",
      roles: [{ id: "x0", name: "smokes", playerId: "x" }],
      readings: ["{0} smokes"],
    });
    expect(m.idKindsHolding("x")).toEqual(["fact type", "object type"]);
    expect(() => m.addObjectType({ id: "x", name: "Car", kind: "entity", referenceMode: "vin" }))
      .toThrow(DuplicateIdError);
    m.addConstraint(
      { type: "external_uniqueness", id: "x0", roleIds: ["x0"] } as Constraint as never,
    );
    expect(m.idKindsHolding("x0")).toEqual(["constraint", "role"]);
  });
});
