/**
 * The mapping must not change what a consumer sees.
 *
 * WS3 moves reference checks out of the rules and into `graphOf`. A
 * diagnostic id is a promise to whoever reads validator output, so the
 * test that matters is not "the mapping produces something" but "the
 * mapping produces what the rules produce today". Each case below builds
 * a model with one dangling reference, runs the CURRENT engine, and
 * asserts the mapped diagnostic matches it exactly.
 *
 * Two reference kinds cannot be tested that way, and the reason is worth
 * recording rather than working around: `OrmModel.addObjectifiedFactType`
 * and `OrmModel.addPopulation` throw on a missing reference and offer no
 * `skipPlayerValidation` escape, so no caller -- the deserializer
 * included -- can hand the validator a model carrying one. The rules
 * that report those two (`structural/objectified-dangling-*`,
 * `population/dangling-fact-type`) have therefore never fired for any
 * consumer, and there is no "today's behaviour" for the mapping to
 * reproduce. Those cases assert the diagnostic directly instead, so the
 * arm is covered if the constructors are ever relaxed (barwise-977).
 */
import { describe, expect, it } from "vitest";
import { graphOf } from "../../src/model/graph.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { referenceDiagnostics } from "../../src/validation/referenceDiagnostics.js";
import { RULE_ID } from "../../src/validation/ruleId.js";
import { ValidationEngine } from "../../src/validation/ValidationEngine.js";
import { ModelBuilder } from "../helpers/ModelBuilder.js";

function base(): OrmModel {
  return new ModelBuilder("Ref")
    .withEntityType("Customer")
    .withValueType("Name")
    .withBinaryFactType("Customer has Name", {
      role1: { player: "Customer", name: "has" },
      role2: { player: "Name", name: "is of" },
      readings: ["{0} has {1}", "{1} is of {0}"],
    })
    .build();
}

/** What the engine says now, for the diagnostics of one rule id. */
function today(model: OrmModel, ruleId: string) {
  return new ValidationEngine().validate(model).filter((d) => d.ruleId === ruleId);
}

function mapped(model: OrmModel, ruleId: string) {
  const result = graphOf(model);
  if (result.ok) throw new Error("expected graphOf to fail");
  return referenceDiagnostics(result.unresolved).filter((d) => d.ruleId === ruleId);
}

/**
 * The expected diagnostic, captured by RUNNING the pre-change engine.
 *
 * The obvious form of this test compares the mapping against
 * `new ValidationEngine().validate(model)`, and that is what it did
 * until the engine started routing through the mapping -- at which point
 * it compared `referenceDiagnostics` with `referenceDiagnostics` and
 * would have agreed with any change to either. That is barwise-906's
 * class exactly: an instrument that cannot report the outcome it claims
 * to check.
 *
 * So the other side of the comparison is pinned text, and the text is
 * not written by hand. It was produced on 8410d6e (this branch's merge
 * base, before any of these checks moved) by building each model below
 * and printing `validate(model)` filtered to the rule id. A message
 * changing here means a consumer's output changed, which is the whole
 * claim the workstream rests on.
 */
const BEFORE: Record<string, { ruleId: string; severity: string; message: string; }> = {
  mandatory: {
    ruleId: "constraint/mandatory-invalid-role",
    severity: "error",
    message:
      'Mandatory constraint in fact type "Customer has Name" references role id "bogus" which does not belong to this fact type.',
  },
  ring: {
    ruleId: "constraint/ring-invalid-role",
    severity: "error",
    message:
      'Ring constraint in fact type "Customer has Name" references role id "bogus" which does not belong to this fact type.',
  },
  frequency: {
    ruleId: "constraint/frequency-invalid-role",
    severity: "error",
    message:
      'Frequency constraint in fact type "Customer has Name" references role id "bogus" which does not belong to this fact type.',
  },
  cardinality: {
    ruleId: "constraint/cardinality-invalid-role",
    severity: "error",
    message:
      'Cardinality constraint in fact type "Customer has Name" references role id "bogus" which does not belong to this fact type.',
  },
  subtypeDangling: {
    ruleId: "structural/subtype-dangling-subtype",
    severity: "error",
    message: 'Subtype fact references subtype id "sub-missing" which does not exist in the model.',
  },
  supertypeDangling: {
    ruleId: "structural/subtype-dangling-supertype",
    severity: "error",
    message:
      'Subtype fact references supertype id "sup-missing" which does not exist in the model.',
  },
  joinRoot: {
    ruleId: "constraint/join-unknown-root",
    severity: "error",
    message:
      'Join constraint in fact type "Customer has Name" references an unknown root object type "ot-missing".',
  },
  joinStep: {
    ruleId: "constraint/join-bad-step",
    severity: "error",
    message:
      'Join constraint in fact type "Customer has Name" has a step whose entry "Customer has Name::role1" / exit "role-missing" are not both roles of one fact type.',
  },
  rolePlayer: {
    ruleId: "structural/dangling-role-reference",
    severity: "error",
    message:
      'Role "is of" in fact type "Customer has X" references object type id "ot-missing" which does not exist in the model.',
  },
};

/**
 * The mapping reproduces what the pre-change engine said, and the engine
 * still delivers it. Both halves matter: the first is the mapping's
 * contract, the second is that nothing between the mapping and the
 * caller drops or duplicates it.
 */
function expectSame(model: OrmModel, key: keyof typeof BEFORE): void {
  const before = BEFORE[key]!;
  const got = mapped(model, before.ruleId);
  expect(got).toHaveLength(1);
  expect(got[0]!.ruleId).toBe(before.ruleId);
  expect(got[0]!.severity).toBe(before.severity);
  expect(got[0]!.message).toBe(before.message);
  expect(today(model, before.ruleId)).toEqual(got);
}

describe("referenceDiagnostics reproduces today's diagnostics", () => {
  it("dangling role player", () => {
    const model = new OrmModel({ name: "M" });
    model.addObjectType({ name: "Customer", kind: "entity", referenceMode: "id" });
    model.addFactType({
      name: "Customer has X",
      roles: [
        { name: "has", playerId: model.objectTypes[0]!.id },
        { name: "is of", playerId: "ot-missing" },
      ],
      readings: ["{0} has {1}"],
    }, { skipPlayerValidation: true });
    expectSame(model, "rolePlayer");
  });

  it("dangling mandatory constraint role", () => {
    const model = base();
    model.factTypes[0]!.addConstraint({ type: "mandatory", roleId: "bogus", id: "c1" });
    expectSame(model, "mandatory");
  });

  it("dangling ring constraint role", () => {
    const model = base();
    const ft = model.factTypes[0]!;
    ft.addConstraint({
      type: "ring",
      id: "c2",
      roleId1: "bogus",
      roleId2: ft.roles[1]!.id,
      ringType: "irreflexive",
    });
    expectSame(model, "ring");
  });

  it("dangling frequency constraint role", () => {
    const model = base();
    model.factTypes[0]!.addConstraint({
      type: "frequency",
      id: "c3",
      roleIds: ["bogus"],
      min: 1,
      max: 2,
    });
    expectSame(model, "frequency");
  });

  it("dangling cardinality constraint role", () => {
    const model = base();
    model.factTypes[0]!.addConstraint({
      type: "cardinality",
      id: "c4",
      roleId: "bogus",
      min: 0,
      max: 1,
    });
    expectSame(model, "cardinality");
  });

  it("dangling subtype and supertype", () => {
    const model = base();
    model.addSubtypeFact(
      { subtypeId: "sub-missing", supertypeId: "sup-missing" },
      { skipPlayerValidation: true },
    );
    expectSame(model, "subtypeDangling");
    expectSame(model, "supertypeDangling");
  });
});

describe("referenceDiagnostics for what the graph is first to check", () => {
  it("names a duplicate role id as its own finding, not a missing player", () => {
    const model = base();
    const shared = model.factTypes[0]!.roles[0]!.id;
    model.addFactType({
      name: "Customer has Code",
      roles: [
        { name: "has code", playerId: model.objectTypes[0]!.id, id: shared },
        { name: "is code of", playerId: model.objectTypes[1]!.id },
      ],
      readings: ["{0} has code {1}", "{1} is code of {0}"],
    });

    const result = graphOf(model);
    if (result.ok) throw new Error("expected graphOf to fail on a duplicate role id");
    const diags = referenceDiagnostics(result.unresolved);

    expect(diags.map((d) => d.ruleId)).toEqual([RULE_ID.duplicateRoleId]);
    expect(diags[0]!.message).toContain(shared);
    // Not the dangling-player message, whose text would claim the id
    // named a missing object type.
    expect(diags[0]!.message).not.toContain("object type");
    // No rule reported this before, so there is nothing for it to
    // duplicate -- and the engine surfaces it like any other.
    expect(new ValidationEngine().validate(model).map((d) => d.ruleId))
      .toContain(RULE_ID.duplicateRoleId);
  });
});

describe("referenceDiagnostics for states no constructor admits", () => {
  it("dangling objectification references keep their historical ids", () => {
    const model = base();
    const ft = model.factTypes[0]!;
    const ot = model.objectTypes[0]!;
    const oft = model.addObjectifiedFactType({ factTypeId: ft.id, objectTypeId: ot.id });

    const diags = referenceDiagnostics([
      {
        from: { kind: "objectifiedFactType", objectifiedFactType: oft },
        field: "factTypeId",
        missing: "ft-missing",
      },
      {
        from: { kind: "objectifiedFactType", objectifiedFactType: oft },
        field: "objectTypeId",
        missing: "ot-missing",
      },
    ]);

    expect(diags.map((d) => d.ruleId)).toEqual([
      RULE_ID.objectifiedDanglingFactType,
      RULE_ID.objectifiedDanglingObjectType,
    ]);
    expect(diags[0]!.message).toContain("ft-missing");
    expect(diags[1]!.message).toContain("ot-missing");
    expect(diags.every((d) => d.elementId === oft.id)).toBe(true);
  });

  it("dangling population fact type keeps its historical id", () => {
    const model = base();
    const pop = model.addPopulation({ factTypeId: model.factTypes[0]!.id });

    const diags = referenceDiagnostics([
      { from: { kind: "population", population: pop }, field: "factTypeId", missing: "ft-missing" },
    ]);

    expect(diags[0]!.ruleId).toBe(RULE_ID.danglingFactType);
    expect(diags[0]!.message).toContain("ft-missing");
    expect(diags[0]!.message).toContain(pop.id);
  });
});

describe("referenceDiagnostics for join constraint paths", () => {
  /** A model whose one join constraint has the given subset path. */
  function withJoin(
    subsetPath: (m: OrmModel) => { root: string; steps: { entry: string; exit: string; }[]; },
  ): OrmModel {
    const model = base();
    model.factTypes[0]!.addConstraint({
      type: "join_subset",
      id: "jc1",
      subset: { path: subsetPath(model), projection: [0] },
      superset: { path: { root: model.objectTypes[0]!.id, steps: [] }, projection: [0] },
    });
    return model;
  }

  it("unknown path root", () => {
    expectSame(withJoin(() => ({ root: "ot-missing", steps: [] })), "joinRoot");
  });

  it("reports every dangling hop, where the old rule stopped at the first", () => {
    const model = withJoin((m) => ({
      root: m.objectTypes[0]!.id,
      steps: [
        { entry: m.factTypes[0]!.roles[0]!.id, exit: "role-missing-1" },
        { entry: m.factTypes[0]!.roles[1]!.id, exit: "role-missing-2" },
      ],
    }));

    const badSteps = mapped(model, RULE_ID.joinBadStep);

    // The behaviour change `referenceDiagnostics`'s header states: the
    // rule walked and returned at the first bad hop (its `return
    // undefined` is still there, for paths that DO resolve), so it
    // reported one; the graph enumerates references, so it reports both.
    // Asserted on the graph's own output rather than against "before",
    // which this suite cannot run.
    expect(badSteps).toHaveLength(2);
    expect(badSteps[0]!.message).toContain("role-missing-1");
    expect(badSteps[1]!.message).toContain("role-missing-2");
    // And the engine passes both through without duplicating either.
    expect(today(model, RULE_ID.joinBadStep)).toEqual(badSteps);
  });

  it("bad path step", () => {
    const model = withJoin((m) => ({
      root: m.objectTypes[0]!.id,
      steps: [{ entry: m.factTypes[0]!.roles[0]!.id, exit: "role-missing" }],
    }));
    expectSame(model, "joinStep");
  });
});
