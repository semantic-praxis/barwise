/**
 * Minted names and their keys (iri-identity, section 3 and WS6 6a). A
 * name is the element's sentence through `localName()`; its key is what
 * the sentence was made from, with no ids in it; and nothing is minted
 * from a sentence that is not of the element.
 *
 * Spec: docs/specs/iri-identity.spec.md, WS6 6a.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type Constraint,
  CONSTRAINT_TYPES,
  isExternalConstraint,
} from "../../src/model/Constraint.js";
import type { ConstraintInView } from "../../src/model/constraintModel.js";
import { isMintable, mint, type Mintable, mintedKey, mintedName } from "../../src/model/mint.js";
import { localName } from "../../src/model/name.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { ConstraintVerbalizer } from "../../src/verbalization/ConstraintVerbalizer.js";
import { arbOrmModel } from "../arbitraries/model.js";

// These fixtures build `OrmModel` directly rather than through
// `ModelBuilder`: ids are what the tests vary, so they are written out.

/**
 * One model, every id prefixed by `p`, so two copies differ in every id and
 * agree in everything a sentence says.
 */
function people(p: string): OrmModel {
  const m = new OrmModel({ name: "People" });
  m.addObjectType({ id: `${p}P`, name: "Person", kind: "entity", referenceMode: "nr" });
  m.addObjectType({ id: `${p}C`, name: "Car", kind: "entity", referenceMode: "vin" });
  m.addObjectType({ id: `${p}N`, name: "Name", kind: "value" });
  m.addObjectType({ id: `${p}A`, name: "Age", kind: "value" });
  m.addObjectType({ id: `${p}D`, name: "Driver", kind: "entity", referenceMode: "nr" });
  m.addObjectType({ id: `${p}R`, name: "Rider", kind: "entity", referenceMode: "nr" });
  const binary = (
    id: string,
    name: string,
    a: string,
    b: string,
    ra: string,
    rb: string,
    reading: string,
  ) =>
    m.addFactType({
      id: `${p}${id}`,
      name,
      roles: [
        { id: `${p}${id}0`, name: ra, playerId: `${p}${a}` },
        { id: `${p}${id}1`, name: rb, playerId: `${p}${b}` },
      ],
      readings: [reading],
    });
  binary("d", "Person drives Car", "P", "C", "drives", "is driven by", "{0} drives {1}");
  binary("n", "Person has Name", "P", "N", "has", "is of", "{0} has {1}");
  binary("a", "Person has Age", "P", "A", "has", "is of", "{0} has {1}");
  binary("k", "Person knows Person", "P", "P", "knows", "is known by", "{0} knows {1}");
  m.addSubtypeFact({ id: `${p}s1`, subtypeId: `${p}D`, supertypeId: `${p}P` });
  m.addSubtypeFact({ id: `${p}s2`, subtypeId: `${p}R`, supertypeId: `${p}P` });
  return m;
}

/** One constraint of every kind, over `people(p)`. */
function everyKind(p: string): Constraint[] {
  const r = (x: string) => `${p}${x}`;
  const hop = {
    path: { root: r("P"), steps: [{ entry: r("d0"), exit: r("d1") }] },
    projection: [0, 1],
  };
  const ringHop = {
    path: {
      root: r("P"),
      steps: [{ entry: r("k0"), exit: r("k1") }, { entry: r("k0"), exit: r("k1") }],
    },
    projection: [0, 2],
  };
  return [
    { type: "internal_uniqueness", id: r("iu"), roleIds: [r("d1")] },
    { type: "mandatory", id: r("m"), roleId: r("n0") },
    { type: "external_uniqueness", id: r("eu"), roleIds: [r("n1"), r("a1")] },
    { type: "value_constraint", id: r("vc"), roleId: r("a1"), values: ["18", "21"] },
    { type: "disjunctive_mandatory", id: r("dm"), roleIds: [r("d0"), r("n0")] },
    { type: "exclusion", id: r("ex"), subtypeFactIds: [r("s1"), r("s2")] },
    { type: "exclusive_or", id: r("xo"), roleIds: [r("d0"), r("n0")] },
    { type: "subset", id: r("sub"), subsetRoleIds: [r("d0")], supersetRoleIds: [r("n0")] },
    { type: "equality", id: r("eq"), roleIds1: [r("d0")], roleIds2: [r("n0")] },
    { type: "ring", id: r("ring"), roleId1: r("k0"), roleId2: r("k1"), ringType: "irreflexive" },
    { type: "frequency", id: r("freq"), roleIds: [r("d0")], min: 1, max: 2 },
    { type: "value_comparison", id: r("vcmp"), roleId1: r("k0"), roleId2: r("k1"), operator: "<" },
    { type: "cardinality", id: r("card"), roleId: r("d0"), min: 0, max: 3 },
    { type: "join_subset", id: r("js"), subset: hop, superset: hop },
    { type: "join_equality", id: r("je"), operands: [hop, hop] },
    { type: "join_exclusion", id: r("jx"), operands: [hop, hop] },
    { type: "join_ring", id: r("jr"), operand: ringHop, ringType: "irreflexive" },
  ] as Constraint[];
}

/** The constraint as the model holds it, with the fact type an internal one lives in. */
function inView(model: OrmModel, c: Constraint): ConstraintInView {
  if (isExternalConstraint(c)) return [c, undefined];
  const host = model.factTypesHolding(roleIdsOfInternal(c))[0]!;
  return [c, host] as ConstraintInView;
}
function roleIdsOfInternal(c: Constraint): string[] {
  const any = c as { roleId?: string; roleIds?: string[]; roleId1?: string; };
  return any.roleIds ?? [any.roleId ?? any.roleId1!];
}
const asConstraint = (model: OrmModel, c: Constraint): Mintable => ({
  kind: "constraint",
  inView: inView(model, c),
});

describe("a minted constraint name", () => {
  it("is the constraint's sentence through localName, without its period", () => {
    const m = people("a");
    const c = everyKind("a")[0]!;
    const [constraint, host] = inView(m, c);
    const text = new ConstraintVerbalizer().verbalize(constraint, host!, m).text;
    expect(mintedName(asConstraint(m, c), m)).toBe(localName(text.replace(/\.$/, "")));
    expect(mintedName(asConstraint(m, c), m)).not.toMatch(/\.$/);
  });

  it("covers every constraint kind, and its key holds no id", () => {
    // The walk refuses a field it has not classified, so a kind added
    // later fails here until its references are named.
    expect(new Set(everyKind("a").map((c) => c.type))).toEqual(new Set(CONSTRAINT_TYPES));
    const m = people("a");
    for (const c of everyKind("a")) {
      const element = asConstraint(m, c);
      expect(isMintable(element, m), c.type).toBe(true);
      const key = mintedKey(element, m)!;
      expect(key, c.type).toBeDefined();
      // Every id in the fixture starts with the prefix, then a capital or a
      // lower-case letter run; none survives into the key.
      expect(key, `${c.type}: ${key}`).not.toMatch(/"a[A-Za-z0-9]+"/);
    }
  });

  it("is the same for two models that differ only in ids", () => {
    const a = people("a");
    const b = people("b");
    const ka = everyKind("a");
    const kb = everyKind("b");
    for (const [i, c] of ka.entries()) {
      expect(mintedName(asConstraint(b, kb[i]!), b), c.type).toBe(
        mintedName(asConstraint(a, c), a),
      );
      expect(mintedKey(asConstraint(b, kb[i]!), b), c.type).toBe(mintedKey(asConstraint(a, c), a));
    }
  });

  it("changes its key with what the constraint says", () => {
    const m = people("a");
    const one = { type: "frequency", id: "f1", roleIds: ["ad0"], min: 1, max: 2 } as Constraint;
    const two = { type: "frequency", id: "f2", roleIds: ["ad0"], min: 1, max: 3 } as Constraint;
    expect(mintedKey(asConstraint(m, one), m)).not.toBe(mintedKey(asConstraint(m, two), m));
  });

  it.each(
    [
      ["a role no fact type holds", { type: "mandatory", id: "x", roleId: "nope" }, undefined],
      ["a role of another fact type, for an internal constraint", {
        type: "mandatory",
        id: "x",
        roleId: "an0",
      }, "ad"],
      ["a subtype fact that does not exist", {
        type: "exclusion",
        id: "x",
        subtypeFactIds: ["as1", "nope"],
      }, undefined],
      ["a join path rooted at no object type", {
        type: "join_equality",
        id: "x",
        operands: [{
          path: { root: "nope", steps: [{ entry: "ad0", exit: "ad1" }] },
          projection: [0, 1],
        }, { path: { root: "nope", steps: [{ entry: "ad0", exit: "ad1" }] }, projection: [0, 1] }],
      }, undefined],
      // What the sentence assumes of the shape (`sentenceHolds`): each of
      // these resolves, and its sentence would still misstate it.
      ["a disjunctive mandatory over roles of two players", {
        type: "disjunctive_mandatory",
        id: "x",
        roleIds: ["ad1", "an0"],
      }, undefined],
      ["an exclusive-or over roles of two players", {
        type: "exclusive_or",
        id: "x",
        roleIds: ["an0", "ad1"],
      }, undefined],
      ["an exclusion over subtype facts of two supertypes", {
        type: "exclusion",
        id: "x",
        subtypeFactIds: ["as1", "as3"],
      }, undefined],
      ["an exclusion over no subtype facts", {
        type: "exclusion",
        id: "x",
        subtypeFactIds: [],
      }, undefined],
      ["a join projecting a negative index", {
        type: "join_ring",
        id: "x",
        operand: {
          path: { root: "aP", steps: [{ entry: "ak0", exit: "ak1" }] },
          projection: [-1, 1],
        },
        ringType: "irreflexive",
      }, undefined],
      ["a join projecting nothing", {
        type: "join_ring",
        id: "x",
        operand: {
          path: { root: "aP", steps: [{ entry: "ak0", exit: "ak1" }] },
          projection: [],
        },
        ringType: "irreflexive",
      }, undefined],
      ["a uniqueness over no roles", { type: "internal_uniqueness", id: "x", roleIds: [] }, "ad"],
      ["an external uniqueness over no roles", {
        type: "external_uniqueness",
        id: "x",
        roleIds: [],
      }, undefined],
      ["a join projecting a node the path does not reach", {
        type: "join_ring",
        id: "x",
        operand: {
          path: { root: "aP", steps: [{ entry: "ak0", exit: "ak1" }] },
          projection: [0, 2],
        },
        ringType: "irreflexive",
      }, undefined],
      ["a join step that crosses fact types", {
        type: "join_ring",
        id: "x",
        operand: {
          path: { root: "aP", steps: [{ entry: "ad0", exit: "an1" }] },
          projection: [0, 1],
        },
        ringType: "irreflexive",
      }, undefined],
      ["a join rooted at a type its first step is not entered by", {
        type: "join_ring",
        id: "x",
        operand: {
          path: { root: "aC", steps: [{ entry: "ad0", exit: "ad1" }] },
          projection: [0, 1],
        },
        ringType: "irreflexive",
      }, undefined],
      ["a join step that enters and exits by one role", {
        type: "join_ring",
        id: "x",
        operand: {
          path: { root: "aP", steps: [{ entry: "ad0", exit: "ad0" }] },
          projection: [0, 1],
        },
        ringType: "irreflexive",
      }, undefined],
    ] as const,
  )("is not minted for %s", (_what, raw, hostId) => {
    const m = people("a");
    m.addObjectType({ id: "aV", name: "Van", kind: "entity", referenceMode: "vin" });
    m.addSubtypeFact({ id: "as3", subtypeId: "aV", supertypeId: "aC" });
    const c = raw as unknown as Constraint;
    const host = hostId === undefined ? undefined : m.getFactType(hostId);
    const element: Mintable = { kind: "constraint", inView: [c, host] as ConstraintInView };
    expect(isMintable(element, m)).toBe(false);
    expect(mintedName(element, m)).toBeUndefined();
    expect(mintedKey(element, m)).toBeUndefined();
    expect(mint(element, m)).toBeUndefined();
  });

  it("changes its key when a fact type or role it names is renamed", () => {
    // The sentence prints both, so a key without them would call a name
    // current that no longer reads true.
    const keyOf = (rename: (m: OrmModel) => void) => {
      const m = people("a");
      rename(m);
      const c = { type: "mandatory", id: "x", roleId: "ad0" } as Constraint;
      return mintedKey(asConstraint(m, c), m);
    };
    const base = keyOf(() => {});
    expect(keyOf((m) => (m.getFactType("ad")!.name = "Person operates Car"))).not.toBe(base);
    expect(keyOf((m) => (m.getFactType("ad")!.roles[0]!.name = "operates"))).not.toBe(base);
  });

  it("keys an internal constraint by its fact type even where no role names it", () => {
    const m = people("a");
    const vc = { type: "value_constraint", id: "x", values: ["1"] } as Constraint;
    const on = (id: string) =>
      mintedKey({ kind: "constraint", inView: [vc, m.getFactType(id)] as ConstraintInView }, m);
    expect(on("an")).toBeDefined();
    expect(on("an")).not.toBe(on("aa"));
  });

  it("gives mint the same name and key as the two halves", () => {
    const m = people("a");
    for (const c of everyKind("a")) {
      const element = asConstraint(m, c);
      expect(mint(element, m), c.type).toEqual({
        name: mintedName(element, m),
        key: mintedKey(element, m),
      });
    }
  });

  it("is not minted when a player of the role's fact type dangles", () => {
    const m = new OrmModel({ name: "M" });
    m.addObjectType({ id: "P", name: "Person", kind: "entity", referenceMode: "nr" });
    m.addFactType(
      {
        id: "f",
        name: "Person owns Thing",
        roles: [{ id: "f0", name: "owns", playerId: "P" }, {
          id: "f1",
          name: "owned by",
          playerId: "gone",
        }],
        readings: ["{0} owns {1}"],
      },
      { skipPlayerValidation: true },
    );
    const c = { type: "mandatory", id: "x", roleId: "f0" } as Constraint;
    expect(
      isMintable({ kind: "constraint", inView: [c, m.getFactType("f")] as ConstraintInView }, m),
    )
      .toBe(false);
  });
});

describe("a minted subtype fact or objectification name", () => {
  it("names a subtype fact by its sentence and keys it by its two types' names", () => {
    const a = people("a");
    const sf = a.getSubtypeFact("as1")!;
    expect(mintedName({ kind: "subtypeFact", subtypeFact: sf }, a)).toBe(
      localName("Driver is a subtype of Person"),
    );
    const b = people("b");
    expect(mintedKey({ kind: "subtypeFact", subtypeFact: b.getSubtypeFact("bs1")! }, b)).toBe(
      mintedKey({ kind: "subtypeFact", subtypeFact: sf }, a),
    );
  });

  it("names an objectification by its sentence", () => {
    const m = people("a");
    m.addObjectType({ id: "aDr", name: "Driving", kind: "entity", referenceMode: "nr" });
    m.addObjectifiedFactType({ id: "ao", factTypeId: "ad", objectTypeId: "aDr" });
    const o = m.getObjectifiedFactType("ao")!;
    expect(mintedName({ kind: "objectification", objectification: o }, m)).toBe(
      localName("Driving is where Person drives Car"),
    );
    expect(mintedKey({ kind: "objectification", objectification: o }, m)).not.toMatch(
      /"a[A-Za-z0-9]+"/,
    );
  });

  it("keys a defining rule by its expression alone", () => {
    const keyOf = (rule: object) => {
      const m = people("a");
      m.addObjectType({ id: "aV", name: "Veteran", kind: "entity", referenceMode: "nr" });
      m.addSubtypeFact({
        id: "x",
        subtypeId: "aV",
        supertypeId: "aP",
        definingRule: rule as never,
      });
      return mintedKey({ kind: "subtypeFact", subtypeFact: m.getSubtypeFact("x")! }, m);
    };
    const said = { kind: "derived", expression: "each Person who served" };
    expect(keyOf({ ...said, storage: "stored" })).toBe(keyOf(said));
    expect(keyOf({ ...said, expression: "each Person who retired" })).not.toBe(keyOf(said));
  });

  it("is not minted for a subtype fact whose end dangles", () => {
    const m = people("a");
    const element: Mintable = {
      kind: "subtypeFact",
      subtypeFact: { id: "x", subtypeId: "gone", supertypeId: "aP" } as never,
    };
    expect(mintedName(element, m)).toBeUndefined();
  });
});

describe("minting over generated models", () => {
  it("is defined or refused for every constraint, never throws, and keys hold no id", () => {
    // The generator's ids (`ot0`, `ft2`, `ft2r1`, `sf0`, `c3`, `pref1`)
    // are never also names (`T0`, `F2`, `plays1`), so one appearing as a
    // whole string in a key is an id the walk let through.
    const generatedId = /"(?:ot|ft|sf|c|pref)\d+(?:r\d+)?"/;
    let minted = 0;
    fc.assert(
      fc.property(arbOrmModel(), (model) => {
        for (const inView of model.everyConstraint()) {
          const element: Mintable = { kind: "constraint", inView };
          const result = mint(element, model);
          expect(result === undefined).toBe(!isMintable(element, model));
          if (result === undefined) continue;
          minted++;
          expect(result.key).not.toMatch(generatedId);
        }
      }),
      { seed: 20261029, numRuns: 100 },
    );
    // A run that minted nothing would pass every assertion above.
    expect(minted).toBeGreaterThan(0);
  });
});
