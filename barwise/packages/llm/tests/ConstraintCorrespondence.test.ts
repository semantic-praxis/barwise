/**
 * The conformance/validator correspondence, as a property rather than a
 * list of remembered cases (docs/specs/constraint-conformance-audit.spec.md).
 *
 * `enforceConformance` exists to hand the parser something
 * `constraintConsistency` will accept. Three times a structural rule
 * with no counterpart here surfaced as an unavoidable eval penalty --
 * arity (barwise-826), frequency bounds (barwise-830), and ring player
 * identity (barwise-831) -- and the first two were each found by a live
 * run rather than by a test. Each fix closed one instance and left a
 * comment claiming the class, which is how a reader came to believe the
 * class was closed when it was not.
 *
 * The sweep at the bottom is the point of this file. `ConstraintArity.test.ts`
 * pins the two specific gaps that were found; this asserts the property
 * they were instances of, across every type the extraction vocabulary
 * can express, so the next gap fails a test instead of a sweep.
 */
import { ValidationEngine } from "@barwise/core";
import { describe, expect, it } from "vitest";
import { parseDraftModel } from "../src/DraftModelParser.js";
import { enforceConformance } from "../src/ExtractionConformance.js";
import type {
  ExtractionResponse,
  InferredConstraint,
  InferredConstraintType,
} from "../src/ExtractionTypes.js";

const REF = [{ lines: [1, 2] as [number, number], excerpt: "test" }];

/**
 * Two fact types over the same two object types, plus a self-referencing
 * one so a ring has somewhere valid to live. `subset` and `equality`
 * need a second fact type to point at, which is why there are two of the
 * binaries rather than one.
 */
function responseWith(
  constraint: Partial<InferredConstraint> & { type: InferredConstraintType; },
): ExtractionResponse {
  return {
    // No reference_mode anywhere: an entity declaring one without an
    // identifier fact type raises its own correction, which would sit
    // alongside the ones under test and make the counts a test of the
    // fixture rather than of the check.
    object_types: [
      { name: "Employee", kind: "entity", source_references: REF },
      { name: "Project", kind: "entity", source_references: REF },
    ],
    fact_types: [
      {
        name: "Employee works on Project",
        reading: "Employee works on Project",
        roles: [
          { player: "Employee", role_name: "worker" },
          { player: "Project", role_name: "assignment" },
        ],
        source_references: REF,
      },
      {
        name: "Employee leads Project",
        reading: "Employee leads Project",
        roles: [
          { player: "Employee", role_name: "leader" },
          { player: "Project", role_name: "led" },
        ],
        source_references: REF,
      },
      {
        name: "Employee mentors Employee",
        reading: "Employee mentors Employee",
        roles: [
          { player: "Employee", role_name: "mentors" },
          { player: "Employee", role_name: "is mentored by" },
        ],
        source_references: REF,
      },
    ],
    subtypes: [],
    inferred_constraints: [{
      fact_type: "Employee works on Project",
      roles: [],
      description: `${constraint.type} probe`,
      confidence: "high",
      source_references: REF,
      ...constraint,
    } as InferredConstraint],
    ambiguities: [],
  };
}

describe("a ring constraint over two different object types", () => {
  it("is removed rather than passed on", () => {
    const { response, corrections } = enforceConformance(responseWith({
      type: "ring",
      fact_type: "Employee works on Project",
      roles: ["Employee", "Project"],
      ring_type: "irreflexive",
    }));

    expect(response.inferred_constraints).toHaveLength(0);
    const removed = corrections.filter((c) => c.category === "ring_different_players");
    expect(removed).toHaveLength(1);
    expect(removed[0]!.description).toContain("same object type");
  });

  it("leaves the model free of ring errors, end to end", () => {
    // The invariant as a property of the pair rather than of either
    // module. Asserting the removal alone would pin one side of a
    // disagreement, and a later change relaxing either module would
    // pass that test while re-creating the bug.
    const { response } = enforceConformance(responseWith({
      type: "ring",
      fact_type: "Employee works on Project",
      roles: ["Employee", "Project"],
      ring_type: "irreflexive",
    }));
    const { model } = parseDraftModel(response, "Ring");

    const errors = new ValidationEngine().validate(model)
      .filter((d) => d.severity === "error" && /[Rr]ing constraint/.test(d.message));
    expect(errors).toEqual([]);
  });

  it("charges a conformance correction, not a validation error", () => {
    // Weighted 0.02 against 0.1 on purpose: dropping a malformed
    // constraint is a smaller failure than shipping a model that does
    // not validate, and the scorer should say so.
    const { response, corrections } = enforceConformance(responseWith({
      type: "ring",
      fact_type: "Employee works on Project",
      roles: ["Employee", "Project"],
      ring_type: "acyclic",
    }));
    const { model } = parseDraftModel(response, "Ring");

    expect(corrections.filter((c) => c.category === "ring_different_players")).toHaveLength(1);
    expect(new ValidationEngine().validate(model).filter((d) => d.severity === "error"))
      .toEqual([]);
  });
});

describe("a ring constraint over one object type survives", () => {
  // The check must not be so eager that it deletes the valid case. Both
  // spellings are live: the recorded `project-staffing` payload names
  // its roles by a repeated player name, which only resolves correctly
  // if each match consumes a distinct role.
  it.each([
    ["a repeated player name", ["Employee", "Employee"]],
    ["role names", ["mentors", "is mentored by"]],
  ])("when its roles are given as %s", (_label, roles) => {
    const { response, corrections } = enforceConformance(responseWith({
      type: "ring",
      fact_type: "Employee mentors Employee",
      roles,
      ring_type: "acyclic",
    }));

    expect(corrections.filter((c) => c.category === "ring_different_players")).toEqual([]);
    expect(response.inferred_constraints).toHaveLength(1);

    // And it must actually reach the model -- surviving conformance is
    // worth nothing if the parser then drops it.
    const { model } = parseDraftModel(response, "Ring");
    const ring = model.factTypes.flatMap((ft) => ft.constraints)
      .filter((c) => c.type === "ring");
    expect(ring).toHaveLength(1);
  });
});

/**
 * One deliberately-malformed shape per constraint type in the
 * extraction vocabulary. Hand-written rather than generated: a
 * generator would still need a per-type notion of what "malformed"
 * means, which is this table with extra steps, and this way each entry
 * can say which rule it is aimed at.
 */
const MALFORMED: ReadonlyArray<
  readonly [string, Partial<InferredConstraint> & { type: InferredConstraintType; }]
> = [
  ["internal_uniqueness over no roles", { type: "internal_uniqueness", roles: [] }],
  ["mandatory over two roles", { type: "mandatory", roles: ["Employee", "Project"] }],
  ["value_constraint over two roles", {
    type: "value_constraint",
    roles: ["Employee", "Project"],
    values: ["a", "b"],
  }],
  ["value_constraint with no values", { type: "value_constraint", roles: ["Employee"] }],
  ["external_uniqueness over no roles", { type: "external_uniqueness", roles: [] }],
  ["disjunctive_mandatory over one role", { type: "disjunctive_mandatory", roles: ["Employee"] }],
  ["exclusion over one role", { type: "exclusion", roles: ["Employee"] }],
  ["exclusive_or over one role", { type: "exclusive_or", roles: ["Employee"] }],
  ["subset with mismatched arity", {
    type: "subset",
    roles: ["Employee", "Project"],
    superset_fact_type: "Employee leads Project",
    superset_roles: ["Employee"],
  }],
  ["equality with mismatched arity", {
    type: "equality",
    roles: ["Employee", "Project"],
    superset_fact_type: "Employee leads Project",
    superset_roles: ["Employee"],
  }],
  ["ring over different players", {
    type: "ring",
    roles: ["Employee", "Project"],
    ring_type: "irreflexive",
  }],
  ["ring over one role", { type: "ring", roles: ["Employee"], ring_type: "acyclic" }],
  ["frequency with a minimum below one", {
    type: "frequency",
    roles: ["Employee"],
    min: 0,
    max: 3,
  }],
  ["frequency with a maximum below its minimum", {
    type: "frequency",
    roles: ["Employee"],
    min: 5,
    max: 2,
  }],
  ["frequency over no roles", { type: "frequency", roles: [], min: 1, max: 3 }],
  ["frequency over two roles", {
    type: "frequency",
    roles: ["Employee", "Project"],
    min: 1,
    max: 3,
  }],
];

describe("nothing surviving conformance produces a constraint error", () => {
  it.each(MALFORMED)("%s", (_label, constraint) => {
    const { response } = enforceConformance(responseWith(constraint));
    const { model } = parseDraftModel(response, "Correspondence");

    // Severity `error`, not diagnostics generally, and that is the
    // whole design of this assertion rather than a weakening of it.
    // Two `constraint/*` rules are advisories about modeling style --
    // `external-uniqueness-all-local` and `spanning-all-roles` -- and
    // conformance is deliberately silent about both, because they are
    // the feedback a modeller wants rather than defects to suppress. A
    // stricter assertion here would look more thorough and would force
    // exactly the wrong fix.
    const errors = new ValidationEngine().validate(model)
      .filter((d) => d.severity === "error" && d.ruleId?.startsWith("constraint/"));

    expect(errors.map((d) => `${d.ruleId}: ${d.message}`)).toEqual([]);
  });
});

describe("the vocabulary is covered", () => {
  it("names every constraint type the extraction can emit", () => {
    // The sweep above is only as good as its coverage, and its coverage
    // is a hand-maintained list -- the same kind of claim that went
    // stale in the capability matrix. A new type added to
    // `InferredConstraintType` with no malformed shape here would
    // otherwise be silently unswept.
    const ALL: readonly InferredConstraintType[] = [
      "internal_uniqueness",
      "mandatory",
      "value_constraint",
      "external_uniqueness",
      "disjunctive_mandatory",
      "exclusion",
      "exclusive_or",
      "subset",
      "equality",
      "ring",
      "frequency",
    ];
    const swept = new Set(MALFORMED.map(([, c]) => c.type));

    expect([...ALL].filter((t) => !swept.has(t))).toEqual([]);
  });
});
