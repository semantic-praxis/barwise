/**
 * Tests for barwise-945: a population instance must respect the domain
 * its ROLE PLAYER declares, not only the domain a role-level constraint
 * declares.
 *
 * The bug was that ORM states a value type's domain in two places and
 * only one of them was ever checked against data, so the same
 * enumeration was live or dead depending on which spelling the modeller
 * picked, with nothing telling them which they had used.
 */
import { describe, expect, it } from "vitest";
import type { ConceptualDataTypeName, ValueRange } from "../../src/model/ObjectType.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { populationValidationRules } from "../../src/validation/rules/populationValidation.js";
import { graphFor } from "../helpers/graphFor.js";

interface Options {
  /** Declared on the value type itself -- the half that was never checked. */
  playerValues?: string[];
  playerRanges?: ValueRange[];
  playerDataType?: ConceptualDataTypeName;
  /** Declared as a role-level constraint -- the half that always was. */
  roleValues?: string[];
  playerKind?: "value" | "entity";
}

/** "Person scores Score", with Score's domain declared either way. */
function makeModel(values: string[], options: Options = {}): OrmModel {
  const model = new OrmModel({ name: "Test" });
  const person = model.addObjectType({
    name: "Person",
    kind: "entity",
    referenceMode: "person_id",
  });
  const score = model.addObjectType({
    name: "Score",
    kind: options.playerKind ?? "value",
    ...(options.playerKind === "entity" ? { referenceMode: "score_id" } : {}),
    ...(options.playerValues || options.playerRanges
      ? {
        valueConstraint: {
          values: options.playerValues ?? [],
          ...(options.playerRanges ? { ranges: options.playerRanges } : {}),
        },
      }
      : {}),
    ...(options.playerDataType ? { dataType: { name: options.playerDataType } } : {}),
  });

  const factType = model.addFactType({
    name: "Person scores Score",
    roles: [
      { name: "scores", playerId: person.id },
      { name: "is scored by", playerId: score.id },
    ],
    readings: ["{0} scores {1}", "{1} is scored by {0}"],
  });

  const scoreRole = factType.roles[1]!;
  if (options.roleValues) {
    factType.addConstraint({
      type: "value_constraint",
      roleId: scoreRole.id,
      values: options.roleValues,
    });
  }

  const pop = model.addPopulation({ factTypeId: factType.id });
  values.forEach((v, i) => {
    pop.addInstance({
      roleValues: { [factType.roles[0]!.id]: `P${i}`, [scoreRole.id]: v },
    });
  });

  return model;
}

const run = (model: OrmModel) => populationValidationRules(model, graphFor(model));
const idsOf = (model: OrmModel) => run(model).map((d) => d.ruleId);

describe("a population respects the domain its role player declares", () => {
  it("reports a value outside the value type's own enumeration", () => {
    const violation = run(makeModel(["banana"], { playerValues: ["A", "B", "C"] })).find(
      (d) => d.ruleId === "population/value-type-domain-violation",
    );
    expect(violation).toBeDefined();
    expect(violation!.message).toContain('"banana"');
    expect(violation!.message).toContain("Score");
    expect(violation!.message).toContain("[A, B, C]");
    expect(violation!.severity).toBe("error");
  });

  it("accepts a value inside it", () => {
    expect(idsOf(makeModel(["B"], { playerValues: ["A", "B", "C"] })))
      .not.toContain("population/value-type-domain-violation");
  });

  it("honours a ranges-only domain, which the enumeration alone would miss", () => {
    // barwise-958 was exactly this shape: a consumer reading `values`
    // and ignoring `ranges`. Reusing `valueDomainPredicate` is what
    // makes ranges work here, so the reuse is what this pins.
    const opts = { playerValues: [], playerRanges: [{ min: "1", max: "9" }] };
    expect(idsOf(makeModel(["5"], opts)))
      .not.toContain("population/value-type-domain-violation");
    expect(idsOf(makeModel(["12"], opts)))
      .toContain("population/value-type-domain-violation");
  });

  it("leaves an entity-played role alone", () => {
    // `valueConstraintOf` and `dataTypeOf` return undefined for an
    // entity type, so the rule needs no guard of its own -- which is
    // exactly the sort of claim worth a test rather than a comment.
    expect(idsOf(makeModel(["anything"], { playerKind: "entity" })))
      .not.toContain("population/value-type-domain-violation");
  });
});

describe("a population respects the data type its role player declares", () => {
  it("reports a value that cannot be read as an integer", () => {
    const violation = run(makeModel(["banana"], { playerDataType: "integer" })).find(
      (d) => d.ruleId === "population/value-type-data-type-violation",
    );
    expect(violation).toBeDefined();
    expect(violation!.message).toContain('"banana"');
    expect(violation!.message).toContain("integer");
  });

  it("accepts integers, signs and surrounding space, and rejects a decimal", () => {
    for (const ok of ["7", "-7", "+7", " 7 "]) {
      expect(idsOf(makeModel([ok], { playerDataType: "integer" })))
        .not.toContain("population/value-type-data-type-violation");
    }
    expect(idsOf(makeModel(["7.5"], { playerDataType: "integer" })))
      .toContain("population/value-type-data-type-violation");
  });

  it("accepts a decimal in a decimal role and rejects a non-number", () => {
    expect(idsOf(makeModel(["7.5"], { playerDataType: "decimal" })))
      .not.toContain("population/value-type-data-type-violation");
    expect(idsOf(makeModel(["seven"], { playerDataType: "decimal" })))
      .toContain("population/value-type-data-type-violation");
  });

  it("accepts every boolean spelling a SQL or CSV export produces", () => {
    for (const ok of ["true", "false", "TRUE", "False", "1", "0"]) {
      expect(idsOf(makeModel([ok], { playerDataType: "boolean" })))
        .not.toContain("population/value-type-data-type-violation");
    }
    expect(idsOf(makeModel(["maybe"], { playerDataType: "boolean" })))
      .toContain("population/value-type-data-type-violation");
  });

  it("admits anything for the types whose spelling the metamodel does not fix", () => {
    // The partiality is the design rather than an oversight: no date
    // format is declared anywhere, and this corpus carries NORMA-derived
    // ids a strict uuid test would reject. Pinned so that widening the
    // checked set is a deliberate act which fails this test first.
    const unchecked = [
      "date",
      "time",
      "datetime",
      "timestamp",
      "uuid",
      "text",
      "binary",
      "other",
    ] as const;
    for (const type of unchecked) {
      expect(idsOf(makeModel([`not a ${type}`], { playerDataType: type })))
        .not.toContain("population/value-type-data-type-violation");
    }
  });
});

describe("the two spellings of one enumeration agree", () => {
  // The acceptance criterion barwise-945 names. It holds structurally --
  // both ask `valueDomainPredicate`, and `ValueConstraintDef` and a
  // `ValueConstraint` constraint carry the same `{ values, ranges }`
  // shape -- but the shapes agreeing today does not guarantee they stay
  // that way, so the verdict is compared rather than assumed.
  const cases: Array<{ value: string; accepted: boolean; }> = [
    { value: "A", accepted: true },
    { value: "C", accepted: true },
    { value: "banana", accepted: false },
    { value: "", accepted: false },
    { value: "a", accepted: false },
  ];

  for (const { value, accepted } of cases) {
    it(`"${value}" is ${accepted ? "accepted" : "rejected"} by both spellings`, () => {
      const asPlayerField = !idsOf(makeModel([value], { playerValues: ["A", "B", "C"] }))
        .includes("population/value-type-domain-violation");
      const asRoleConstraint = !idsOf(makeModel([value], { roleValues: ["A", "B", "C"] }))
        .includes("population/value-constraint-violation");

      expect(asPlayerField).toBe(accepted);
      expect(asRoleConstraint).toBe(accepted);
      expect(asPlayerField).toBe(asRoleConstraint);
    });
  }

  it("leaves the role-level rule's own behaviour untouched", () => {
    // barwise-945's last criterion. The role-level rule must still fire
    // under its own id, with its own wording.
    const violation = run(makeModel(["banana"], { roleValues: ["A", "B"] })).find(
      (d) => d.ruleId === "population/value-constraint-violation",
    );
    expect(violation).toBeDefined();
    expect(violation!.message).toContain("which is not in the allowed set [A, B]");
  });
});
