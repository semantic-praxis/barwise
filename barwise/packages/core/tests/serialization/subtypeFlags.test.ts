/**
 * The 2.0 subtype flags and the constraints over subtypes that replace
 * them (orm-format-3, migration step 3 and WS4b). The corpus has no
 * partly overlapping or one-member group, so each case of step 3 has its
 * own fixture here.
 */
import { describe, expect, it } from "vitest";
import { OrmModel } from "../../src/model/OrmModel.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";
import {
  type FlaggedSubtypeFact,
  subtypeConstraintsFromFlags,
  subtypeFlagsFromConstraints,
} from "../../src/serialization/subtypeFlags.js";

const sf = (
  id: string,
  supertype: string,
  flags: { x?: boolean; h?: boolean; } = {},
): FlaggedSubtypeFact => ({
  id,
  supertype,
  ...(flags.x ? { is_exclusive: true } : {}),
  ...(flags.h ? { is_exhaustive: true } : {}),
});

const shapes = (facts: FlaggedSubtypeFact[]) =>
  subtypeConstraintsFromFlags(facts).map((c) => [
    c.type,
    "subtypeFactIds" in c ? c.subtypeFactIds : undefined,
  ]);

describe("subtypeConstraintsFromFlags (step 3)", () => {
  it("gives one exclusive-or when the exclusive and exhaustive groups are equal", () => {
    const facts = [sf("m", "p", { x: true, h: true }), sf("f", "p", { x: true, h: true })];
    expect(shapes(facts)).toEqual([["exclusive_or", ["m", "f"]]]);
  });

  it("gives an exclusion and a disjunctive mandatory when the groups differ", () => {
    const facts = [
      sf("a", "p", { x: true, h: true }),
      sf("b", "p", { x: true }),
      sf("c", "p", { h: true }),
    ];
    expect(shapes(facts)).toEqual([
      ["exclusion", ["a", "b"]],
      ["disjunctive_mandatory", ["a", "c"]],
    ]);
  });

  it("drops an exclusive group of one, which states nothing", () => {
    expect(shapes([sf("a", "p", { x: true }), sf("b", "p")])).toEqual([]);
  });

  it("keeps an exhaustive group of one", () => {
    // "Every Person is a Male" is a real, if odd, rule.
    expect(shapes([sf("m", "p", { h: true })])).toEqual([["disjunctive_mandatory", ["m"]]]);
  });

  it("does not take one exclusive-or for a single member flagged both ways", () => {
    expect(shapes([sf("m", "p", { x: true, h: true })])).toEqual([
      ["disjunctive_mandatory", ["m"]],
    ]);
  });

  it("groups by supertype, in the order each first appears", () => {
    const facts = [
      sf("a", "q", { x: true }),
      sf("m", "p", { x: true, h: true }),
      sf("b", "q", { x: true }),
      sf("f", "p", { x: true, h: true }),
    ];
    expect(shapes(facts)).toEqual([["exclusion", ["a", "b"]], ["exclusive_or", ["m", "f"]]]);
  });

  it("derives ids from the supertype and the kind, the same on every call", () => {
    const facts = [sf("a", "p", { x: true }), sf("b", "p", { x: true, h: true })];
    const first = subtypeConstraintsFromFlags(facts).map((c) => c.id);
    expect(subtypeConstraintsFromFlags(facts).map((c) => c.id)).toEqual(first);
    expect(new Set(first).size).toBe(2);
    const other = subtypeConstraintsFromFlags([
      sf("a", "q", { x: true }),
      sf("b", "q", { x: true, h: true }),
    ]).map((c) => c.id);
    expect(other.some((id) => first.includes(id))).toBe(false);
  });
});

describe("subtypeFlagsFromConstraints", () => {
  it("writes back exactly the flags step 3 read", () => {
    const facts = [
      sf("a", "p", { x: true, h: true }),
      sf("b", "p", { x: true }),
      sf("c", "p", { h: true }),
      sf("m", "q", { x: true, h: true }),
      sf("f", "q", { x: true, h: true }),
      sf("n", "r"),
    ];
    const flags = subtypeFlagsFromConstraints(subtypeConstraintsFromFlags(facts));
    for (const f of facts) {
      expect(flags.get(f.id) ?? { exclusive: false, exhaustive: false }, f.id).toEqual({
        exclusive: f.is_exclusive ?? false,
        exhaustive: f.is_exhaustive ?? false,
      });
    }
  });

  it("ignores a constraint over roles", () => {
    expect(subtypeFlagsFromConstraints([{ type: "exclusion", roleIds: ["r1", "r2"] }]).size)
      .toBe(0);
  });
});

describe("a 2.0 file with subtype flags", () => {
  const serializer = new OrmYamlSerializer();
  const yaml = `orm_version: "2.0"
model:
  name: People
  object_types:
    - { id: p, name: Person, kind: entity, reference_mode: id }
    - { id: m, name: Male, kind: entity, reference_mode: id }
    - { id: f, name: Female, kind: entity, reference_mode: id }
  subtype_facts:
    - { id: sf-m, subtype: m, supertype: p, is_exclusive: true, is_exhaustive: true }
    - { id: sf-f, subtype: f, supertype: p, is_exclusive: true, is_exhaustive: true }
`;

  it("loads to a constraint over its subtype facts", () => {
    const model = serializer.deserialize(yaml);
    expect(model.constraints).toHaveLength(1);
    expect(model.constraints[0]).toMatchObject({
      type: "exclusive_or",
      subtypeFactIds: ["sf-m", "sf-f"],
    });
  });

  it("saves it as a 3.0 constraint over the subtype facts, and reloads to the same id", () => {
    const model = serializer.deserialize(yaml);
    const saved = serializer.serialize(model);
    expect(saved).not.toContain("is_exclusive");
    expect(saved).not.toContain("is_exhaustive");
    expect(saved).toContain(
      "  constraints:\n    - type: exclusive_or\n      subtype_facts:\n        - sf-m\n        - sf-f\n      id: ",
    );
    const again = serializer.deserialize(saved);
    expect(again.constraints.map((c) => c.id)).toEqual(model.constraints.map((c) => c.id));
  });

  it("saves a constraint built in code, with no fact type to nest it under", () => {
    const model = new OrmModel({ name: "People" });
    const p = model.addObjectType({ id: "p", name: "Person", kind: "entity", referenceMode: "id" });
    const m = model.addObjectType({ id: "m", name: "Male", kind: "entity", referenceMode: "id" });
    const sfm = model.addSubtypeFact({ subtypeId: m.id, supertypeId: p.id });
    model.addConstraint({ type: "disjunctive_mandatory", subtypeFactIds: [sfm.id] });
    const again = serializer.deserialize(serializer.serialize(model));
    expect(again.constraints).toMatchObject([
      { type: "disjunctive_mandatory", subtypeFactIds: [sfm.id] },
    ]);
  });

  it("drops the constraint when removing a subtype leaves an exclusive-or over one", () => {
    const model = serializer.deserialize(yaml);
    model.removeSubtypeFact("sf-m");
    expect(model.constraints).toEqual([]);
  });
});

describe("removing a subtype fact keeps only what still holds", () => {
  /** Person with subtypes a, b and c, and one constraint over all three. */
  function three(type: "exclusion" | "exclusive_or" | "disjunctive_mandatory") {
    const model = new OrmModel({ name: "People" });
    model.addObjectType({ id: "p", name: "Person", kind: "entity", referenceMode: "id" });
    for (const s of ["a", "b", "c"]) {
      model.addObjectType({ id: s, name: s.toUpperCase(), kind: "entity", referenceMode: "id" });
      model.addSubtypeFact({ id: `sf-${s}`, subtypeId: s, supertypeId: "p" });
    }
    model.addConstraint({
      id: "c",
      type,
      modality: "deontic",
      subtypeFactIds: ["sf-a", "sf-b", "sf-c"],
    });
    model.removeSubtypeFact("sf-a");
    return model.constraints;
  }

  it("narrows an exclusion: no Person is two of the rest still holds", () => {
    expect(three("exclusion")).toEqual([
      { id: "c", modality: "deontic", type: "exclusion", subtypeFactIds: ["sf-b", "sf-c"] },
    ]);
  });

  it("keeps an exclusive-or's exclusion half and drops its exhaustive one", () => {
    // "Exactly one of A, B, C" without A is not "exactly one of B, C",
    // which would forbid a Person who was only an A.
    expect(three("exclusive_or")).toEqual([
      { id: "c", modality: "deontic", type: "exclusion", subtypeFactIds: ["sf-b", "sf-c"] },
    ]);
  });

  it("drops a disjunctive mandatory, which would otherwise grow stronger", () => {
    // "At least one of A, B, C" without A is not "at least one of B, C".
    expect(three("disjunctive_mandatory")).toEqual([]);
  });
});
