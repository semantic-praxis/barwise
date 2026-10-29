/**
 * The mint guard (`sentenceHolds` and `isMintable`) against validation's
 * constraint rules. The guard restates part of what those rules check, so
 * every `constraint/*` rule is classified here: either validation's report
 * means the sentence would misstate the constraint, and the guard refuses
 * a model that rule reports, or the sentence still states what is stored,
 * for the reason given. A rule added later fails the first test until it
 * is classified, which is what keeps the restatement from drifting.
 *
 * Spec: docs/specs/iri-identity.spec.md, WS6 6a implementation notes.
 */
import { describe, expect, it } from "vitest";
import type { Constraint } from "../../src/model/Constraint.js";
import { isMintable } from "../../src/model/mint.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { RULE_IDS } from "../../src/validation/ruleId.js";
import { ValidationEngine } from "../../src/validation/ValidationEngine.js";

// Built on `OrmModel` directly, not `ModelBuilder`: the constraints below
// name role ids, so the ids are written out.

/**
 * Person works for Company (w0, w1), Person lives in City (l0, l1),
 * Company is in City (h0, h1), Person knows Person (k0, k1), Person
 * smokes (u0); Manager and Clerk are Persons, Branch is a Company.
 */
function base(): OrmModel {
  const m = new OrmModel({ name: "Agreement" });
  for (
    const [id, name] of [["P", "Person"], ["C", "Company"], ["M", "Manager"], ["K", "Clerk"], [
      "B",
      "Branch",
    ]] as const
  ) {
    m.addObjectType({ id, name, kind: "entity", referenceMode: "nr" });
  }
  m.addObjectType({ id: "T", name: "City", kind: "value" });
  const binary = (id: string, a: string, b: string, verb: string) =>
    m.addFactType({
      id,
      name: `${id} fact`,
      roles: [
        { id: `${id}0`, name: verb, playerId: a },
        { id: `${id}1`, name: `${verb} by`, playerId: b },
      ],
      readings: [`{0} ${verb} {1}`],
    });
  binary("w", "P", "C", "works for");
  binary("l", "P", "T", "lives in");
  binary("h", "C", "T", "is in");
  binary("k", "P", "P", "knows");
  m.addFactType({
    id: "u",
    name: "Person smokes",
    roles: [{ id: "u0", name: "smokes", playerId: "P" }],
    readings: ["{0} smokes"],
  });
  m.addSubtypeFact({ id: "sM", subtypeId: "M", supertypeId: "P" });
  m.addSubtypeFact({ id: "sK", subtypeId: "K", supertypeId: "P" });
  m.addSubtypeFact({ id: "sB", subtypeId: "B", supertypeId: "C" });
  return m;
}

const hop = (root: string, entry: string, exit: string, projection: number[]) => ({
  path: { root, steps: [{ entry, exit }] },
  projection,
});
/** Person -> City through `lives in`. */
const personCity = hop("P", "l0", "l1", [0, 1]);
/** Company -> City through `is in`. */
const companyCity = hop("C", "h0", "h1", [0, 1]);

/** A constraint, and the fact type it lives in when it is internal. */
interface Refused {
  readonly constraint: Constraint;
  readonly host?: string;
}

/** Validation's report on these means the sentence would misstate it. */
const REFUSED: Record<string, Refused> = {
  "constraint/across-fact-types-unknown-role": {
    constraint: { type: "external_uniqueness", id: "x", roleIds: ["w1", "nope"] } as Constraint,
  },
  "constraint/cardinality-invalid-role": {
    constraint: { type: "cardinality", id: "x", roleId: "nope", min: 0, max: 1 } as Constraint,
    host: "u",
  },
  "constraint/cardinality-non-unary": {
    constraint: { type: "cardinality", id: "x", roleId: "w1", min: 0, max: 3 } as Constraint,
    host: "w",
  },
  "constraint/subtype-constraint-mixed-supertypes": {
    constraint: { type: "exclusion", id: "x", subtypeFactIds: ["sM", "sB"] } as Constraint,
  },
  "constraint/subtype-constraint-unknown-subtype-fact": {
    constraint: { type: "exclusion", id: "x", subtypeFactIds: ["sM", "nope"] } as Constraint,
  },
  "constraint/exclusion-too-few-roles": {
    // "No Person both works for ..." forbids what a one-role exclusion
    // does not constrain at all.
    constraint: { type: "exclusion", id: "x", roleIds: ["w0"] } as Constraint,
  },
  "constraint/frequency-empty-roles": {
    constraint: { type: "frequency", id: "x", roleIds: [], min: 1, max: 2 } as Constraint,
    host: "w",
  },
  "constraint/frequency-invalid-role": {
    constraint: { type: "frequency", id: "x", roleIds: ["nope"], min: 1, max: 2 } as Constraint,
    host: "w",
  },
  "constraint/internal-uniqueness-invalid-role": {
    constraint: { type: "internal_uniqueness", id: "x", roleIds: ["nope"] } as Constraint,
    host: "w",
  },
  "constraint/join-arity-mismatch": {
    constraint: {
      type: "join_equality",
      id: "x",
      operands: [personCity, hop("P", "l0", "l1", [0])],
    } as Constraint,
  },
  "constraint/join-bad-projection": {
    constraint: {
      type: "join_equality",
      id: "x",
      operands: [personCity, hop("P", "l0", "l1", [0, 2])],
    } as Constraint,
  },
  "constraint/join-bad-step": {
    constraint: {
      type: "join_equality",
      id: "x",
      operands: [personCity, hop("P", "l0", "h1", [0, 1])],
    } as Constraint,
  },
  "constraint/join-column-type-mismatch": {
    constraint: {
      type: "join_equality",
      id: "x",
      operands: [personCity, companyCity],
    } as Constraint,
  },
  "constraint/join-discontiguous": {
    constraint: {
      type: "join_equality",
      id: "x",
      operands: [personCity, hop("C", "l0", "l1", [0, 1])],
    } as Constraint,
  },
  "constraint/join-empty-projection": {
    constraint: {
      type: "join_equality",
      id: "x",
      operands: [personCity, hop("P", "l0", "l1", [])],
    } as Constraint,
  },
  "constraint/join-ring-arity": {
    constraint: {
      type: "join_ring",
      id: "x",
      operand: hop("P", "k0", "k1", [0, 0]),
      ringType: "irreflexive",
    } as Constraint,
  },
  "constraint/join-ring-different-players": {
    constraint: {
      type: "join_ring",
      id: "x",
      operand: personCity,
      ringType: "irreflexive",
    } as Constraint,
  },
  "constraint/join-too-few-operands": {
    constraint: { type: "join_equality", id: "x", operands: [personCity] } as Constraint,
  },
  "constraint/join-unknown-root": {
    constraint: {
      type: "join_equality",
      id: "x",
      operands: [personCity, hop("nope", "l0", "l1", [0, 1])],
    } as Constraint,
  },
  "constraint/mandatory-invalid-role": {
    constraint: { type: "mandatory", id: "x", roleId: "nope" } as Constraint,
    host: "w",
  },
  "constraint/ring-different-players": {
    constraint: {
      type: "ring",
      id: "x",
      roleId1: "w0",
      roleId2: "w1",
      ringType: "irreflexive",
    } as Constraint,
    host: "w",
  },
  "constraint/ring-invalid-role": {
    constraint: {
      type: "ring",
      id: "x",
      roleId1: "k0",
      roleId2: "nope",
      ringType: "irreflexive",
    } as Constraint,
    host: "k",
  },
  "constraint/value-comparison-invalid-role": {
    constraint: {
      type: "value_comparison",
      id: "x",
      roleId1: "k0",
      roleId2: "nope",
      operator: "<",
    } as Constraint,
    host: "k",
  },
  "constraint/value-constraint-invalid-role": {
    constraint: { type: "value_constraint", id: "x", roleId: "nope", values: ["a"] } as Constraint,
    host: "w",
  },
};

/** Validation reports these, and the sentence still states what is stored. */
const STATED: Record<string, string> = {
  "constraint/cardinality-max-less-than-min": "the sentence prints both bounds as stored",
  "constraint/disjunctive-mandatory-too-few-roles":
    "one role reads as a plain mandatory, which is what is stored",
  "constraint/equality-arity-mismatch": "each side's roles are printed as stored",
  "constraint/subtype-constraint-too-few-subtypes": "the subtypes named are printed as stored",
  "constraint/exclusive-or-too-few-roles":
    "one role is printed as stored; none is refused as empty",
  "constraint/external-uniqueness-all-local":
    "the roles are printed as stored; the report is about placement",
  "constraint/frequency-invalid-min": "the sentence prints the bound as stored",
  "constraint/frequency-max-less-than-min": "the sentence prints both bounds as stored",
  "constraint/join-ring-single-fact-type": "a warning that a plain ring says the same thing",
  "constraint/spanning-all-roles":
    "advice about the fact type; a list that spans by naming one role twice is refused for that",
  "constraint/subset-arity-mismatch": "each side's roles are printed as stored",
};

describe("the mint guard against validation's constraint rules", () => {
  it("classifies every constraint rule, once", () => {
    const rules = RULE_IDS.filter((id) => id.startsWith("constraint/")).sort();
    const classified = [...Object.keys(REFUSED), ...Object.keys(STATED)].sort();
    expect(classified).toEqual(rules);
  });

  it.each(Object.entries(REFUSED))("refuses what %s reports", (rule, { constraint, host }) => {
    const m = base();
    if (host === undefined) m.addConstraint(constraint);
    else m.getFactType(host)!.addConstraint(constraint as never);
    const reported = new ValidationEngine().validate(m).map((d) => d.ruleId);
    expect(reported, "validation reports the rule on this fixture").toContain(rule);
    const inView = [...m.everyConstraint()].find(([c]) => c.id === "x")!;
    expect(isMintable({ kind: "constraint", inView }, m)).toBe(false);
  });
});
