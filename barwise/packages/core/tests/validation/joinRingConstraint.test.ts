/**
 * Ring constraints over a join path (`docs/specs/join-ring-constraint.spec.md`,
 * WS1): the per-variant bar the role-path spec set -- a round trip, a
 * verbalization golden per ring type, a satisfied and a violated population
 * per property, the structural rules seen failing, and a diff and merge case.
 *
 * The fixture is the case that motivated the kind: `Person is child of
 * Person` joined to itself, projecting [0, 2], is grandparenthood, whose
 * two projected roles both belong to the one parenthood fact type.
 */
import { describe, expect, it } from "vitest";
import { diffModels } from "../../src/diff/ModelDiff.js";
import { mergeModels } from "../../src/diff/ModelMerge.js";
import type { JoinOperand, JoinRingConstraint, RingType } from "../../src/model/Constraint.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";
import { joinConstraintRules } from "../../src/validation/rules/joinConstraintRules.js";
import { populationValidationRules } from "../../src/validation/rules/populationValidation.js";
import { ConstraintVerbalizer } from "../../src/verbalization/ConstraintVerbalizer.js";
import { graphFor } from "../helpers/graphFor.js";

const parenthood = { entry: "r-child", exit: "r-parent" };
const grandparent: JoinOperand = {
  path: { root: "person", steps: [parenthood, parenthood] },
  projection: [0, 2],
};

function ring(ringType: RingType, operand: JoinOperand = grandparent): JoinRingConstraint {
  return { type: "join_ring", id: "jr", operand, ringType };
}

/** Person, Country, parenthood and birthplace; `rows` are (child, parent). */
function model(constraint: JoinRingConstraint, rows: readonly [string, string][] = []) {
  const m = new OrmModel({ name: "M" });
  m.addObjectType({ id: "person", name: "Person", kind: "entity", referenceMode: "nr" });
  m.addObjectType({ id: "country", name: "Country", kind: "entity", referenceMode: "code" });
  m.addFactType({
    id: "ft-parent",
    name: "Person is child of Person",
    roles: [
      { id: "r-child", name: "is child of", playerId: "person" },
      { id: "r-parent", name: "is parent of", playerId: "person" },
    ],
    readings: ["{0} is child of {1}"],
  });
  m.addFactType({
    id: "ft-born",
    name: "Person was born in Country",
    roles: [
      { id: "r-born", name: "was born in", playerId: "person" },
      { id: "r-place", name: "is birthplace of", playerId: "country" },
    ],
    readings: ["{0} was born in {1}"],
  });
  m.addConstraint(constraint);
  if (rows.length > 0) {
    const pop = m.addPopulation({ id: "pop", factTypeId: "ft-parent" });
    for (const [child, parent] of rows) {
      pop.addInstance({ roleValues: { "r-child": child, "r-parent": parent } });
    }
  }
  return m;
}

const structural = (m: OrmModel) => joinConstraintRules(m, graphFor(m)).map((d) => d.ruleId);
const population = (m: OrmModel) =>
  populationValidationRules(m, graphFor(m))
    .filter((d) => d.ruleId === "population/join-ring-violation")
    .map((d) => d.message);

describe("join_ring lives in the model", () => {
  it("is stored by the model and refused by a fact type", () => {
    const m = model(ring("irreflexive"));
    expect(m.getConstraint("jr")).toMatchObject({ type: "join_ring" });
    expect(() => m.getFactType("ft-parent")!.addConstraint(ring("acyclic") as never)).toThrow();
  });

  it("round-trips through .orm.yaml", () => {
    const serializer = new OrmYamlSerializer();
    const m = model(ring("acyclic"));
    const back = serializer.deserialize(serializer.serialize(m));
    expect(back.getConstraint("jr")).toEqual(m.getConstraint("jr"));
  });
});

describe("structural rules", () => {
  it("accept the grandparent self-join, two hops over one fact type, with no warning", () => {
    expect(structural(model(ring("irreflexive")))).toEqual([]);
  });

  it("report a projection that is not two columns", () => {
    const three = { ...grandparent, projection: [0, 1, 2] };
    expect(structural(model(ring("irreflexive", three)))).toEqual([
      "constraint/join-ring-arity",
    ]);
  });

  it("report projected ends played by different object types", () => {
    const personCountry = {
      path: { root: "person", steps: [{ entry: "r-born", exit: "r-place" }] },
      projection: [0, 1],
    };
    expect(structural(model(ring("irreflexive", personCountry)))).toContain(
      "constraint/join-ring-different-players",
    );
  });

  it("warn that one hop projecting both ends is a plain ring", () => {
    const oneHop = { path: { root: "person", steps: [parenthood] }, projection: [0, 1] };
    expect(structural(model(ring("irreflexive", oneHop)))).toEqual([
      "constraint/join-ring-single-fact-type",
    ]);
  });

  it("report a bad step as the other join kinds do", () => {
    const badStep = {
      path: { root: "person", steps: [{ entry: "r-child", exit: "r-place" }] },
      projection: [0, 1],
    };
    expect(structural(model(ring("irreflexive", badStep)))).toEqual(["constraint/join-bad-step"]);
  });
});

describe("population: each property, satisfied and violated", () => {
  // Rows are parenthood facts; the checked pairs are grandparenthood.
  const cases: readonly {
    ringType: RingType;
    ok: [string, string][];
    bad: [string, string][];
    says: string;
  }[] = [
    {
      ringType: "irreflexive",
      ok: [["A", "B"], ["B", "C"]],
      bad: [["A", "B"], ["B", "A"]],
      says: '"A" to itself',
    },
    {
      ringType: "antisymmetric",
      ok: [["A", "B"], ["B", "C"]],
      bad: [["A", "B"], ["B", "C"], ["C", "D"], ["D", "A"]],
      says: "A to C and C to A",
    },
    {
      ringType: "symmetric",
      ok: [["A", "B"], ["B", "A"]],
      bad: [["A", "B"], ["B", "C"]],
      says: "A to C but not C to A",
    },
    {
      ringType: "transitive",
      ok: [["A", "B"], ["B", "C"]],
      bad: [["A", "B"], ["B", "C"], ["C", "D"], ["D", "E"]],
      says: "but not A to E",
    },
    {
      ringType: "intransitive",
      ok: [["A", "B"], ["B", "C"], ["C", "D"], ["D", "E"]],
      bad: [["A", "A"]],
      says: "and also A to A",
    },
    {
      ringType: "acyclic",
      ok: [["A", "B"], ["B", "C"]],
      bad: [["A", "B"], ["B", "A"]],
      says: "a cycle involves",
    },
    {
      ringType: "purely_reflexive",
      ok: [["A", "A"]],
      bad: [["A", "B"], ["B", "C"]],
      says: "A to C, and only self-loops",
    },
  ];

  for (const { ringType, ok, bad, says } of cases) {
    it(`${ringType}`, () => {
      expect(population(model(ring(ringType), ok))).toEqual([]);
      const found = population(model(ring(ringType), bad));
      expect(found.length).toBeGreaterThan(0);
      expect(found.some((m) => m.includes(says))).toBe(true);
    });
  }

  it("names the ring type and the path's span in the message", () => {
    const [message] = population(model(ring("purely_reflexive"), [["A", "B"], ["B", "C"]]));
    expect(message).toMatch(/^Join purely reflexive ring constraint over .+ is violated: /);
  });
});

describe("verbalization", () => {
  const chain = '"Person is child of Person; then Person is child of Person"';
  const goldens: Record<RingType, string> = {
    irreflexive: `No Person is related to that same Person by ${chain}.`,
    asymmetric:
      `If ${chain} relates Person1 to Person2 then it does not relate Person2 to Person1.`,
    antisymmetric: `If ${chain} relates Person1 to Person2 and Person2 to Person1 then `
      + `Person1 is the same Person as Person2.`,
    intransitive: `If ${chain} relates Person1 to Person2 and Person2 to Person3 then `
      + `it does not relate Person1 to Person3.`,
    acyclic: `No Person is related to that same Person by ${chain}, `
      + `directly or through a chain of such relationships.`,
    symmetric: `If ${chain} relates Person1 to Person2 then it relates Person2 to Person1.`,
    transitive: `If ${chain} relates Person1 to Person2 and Person2 to Person3 then `
      + `it relates Person1 to Person3.`,
    purely_reflexive:
      `If ${chain} relates Person1 to Person2 then Person1 is the same Person as Person2.`,
  };
  for (const [ringType, text] of Object.entries(goldens)) {
    it(ringType, () => {
      const m = model(ring(ringType as RingType));
      const v = new ConstraintVerbalizer().verbalize(
        m.getConstraint("jr")!,
        m.getFactType("ft-parent")!,
        m,
      );
      expect(v.text).toBe(text);
    });
  }
});

describe("diff and merge", () => {
  it("reads a changed ring type under one id as a modification", () => {
    const { deltas } = diffModels(model(ring("irreflexive")), model(ring("acyclic")));
    const changed = deltas.filter((d) => d.kind !== "unchanged");
    expect(changed.map((d) => [d.kind, d.elementType])).toEqual([["modified", "constraint"]]);
  });

  it("pairs two join rings with no id by their content", () => {
    const withoutId = (ringType: RingType) => {
      const { id: _id, ...rest } = ring(ringType);
      return rest as JoinRingConstraint;
    };
    const a = model(withoutId("irreflexive"));
    const b = model(withoutId("irreflexive"));
    expect(diffModels(a, b).deltas.every((d) => d.kind === "unchanged")).toBe(true);
  });

  it("remaps the path root to the merged object type", () => {
    // The incoming model names Person under another id; merge matches it by
    // name and keeps the existing id, so the added ring's root must follow.
    const existing = model(ring("irreflexive"));
    existing.removeConstraint(existing.getConstraint("jr") as JoinRingConstraint);
    const incoming = new OrmModel({ name: "M" });
    incoming.addObjectType({ id: "person-2", name: "Person", kind: "entity", referenceMode: "nr" });
    incoming.addObjectType({
      id: "country",
      name: "Country",
      kind: "entity",
      referenceMode: "code",
    });
    incoming.addFactType({
      id: "ft-parent",
      name: "Person is child of Person",
      roles: [
        { id: "r-child", name: "is child of", playerId: "person-2" },
        { id: "r-parent", name: "is parent of", playerId: "person-2" },
      ],
      readings: ["{0} is child of {1}"],
    });
    incoming.addConstraint({
      ...ring("acyclic"),
      operand: { ...grandparent, path: { ...grandparent.path, root: "person-2" } },
    });
    const { deltas } = diffModels(existing, incoming);
    const merged = mergeModels(existing, incoming, deltas, new Set(deltas.keys()));
    const jr = merged.getConstraint("jr") as JoinRingConstraint | undefined;
    expect([jr?.ringType, jr?.operand.path.root]).toEqual(["acyclic", "person"]);
  });
});
