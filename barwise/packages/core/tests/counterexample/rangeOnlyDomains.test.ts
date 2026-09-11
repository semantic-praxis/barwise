/**
 * barwise-959: a counterexample must not break a rule with the values it
 * mints for the roles it is not probing.
 *
 * `mintValue` consulted a role's value constraint only when that
 * constraint carried an ENUMERATION, so a range-only domain read as "no
 * constraint" and the role was filled with a player-named token the
 * range forbids. The uniqueness probe for "Person scores Score" then
 * reported `population/value-constraint-violation` beside its own rule:
 * it said "this is what uniqueness forbids" while showing a population
 * that broke something else too.
 *
 * The sibling of barwise-958, which was the same asymmetry on the
 * forbidding side.
 */
import { describe, expect, it } from "vitest";
import type { Counterexample } from "../../src/counterexample/Counterexample.js";
import { generateCounterexamples } from "../../src/counterexample/CounterexampleGenerator.js";
import type { ValueRange } from "../../src/model/ObjectType.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { populationValidationRules } from "../../src/validation/rules/populationValidation.js";
import { graphFor } from "../helpers/graphFor.js";

interface Options {
  /** Declared as a role-level constraint on the Score role. */
  roleRanges?: ValueRange[];
  /** Declared on the Score value type itself. */
  playerRanges?: ValueRange[];
  playerDataType?: "integer" | "boolean";
  /**
   * An enumeration AND a range on the value type, where only the range
   * yields something the declared data type also admits.
   */
  playerEnumOverRange?: { values: string[]; ranges: ValueRange[]; dataType: "decimal"; };
  /** An integer value type enumerating non-integers: nothing satisfies both. */
  playerContradiction?: true;
  /** A role range AND an integer player, where only a whole number satisfies both. */
  roleRangesWithIntegerPlayer?: ValueRange[];
}

/** "Person scores Score", uniqueness on the Person role, Score bounded. */
function makeModel(options: Options): OrmModel {
  const model = new OrmModel({ name: "Probe" });
  const person = model.addObjectType({
    name: "Person",
    kind: "entity",
    referenceMode: "person_id",
  });
  const score = model.addObjectType({
    name: "Score",
    kind: "value",
    ...(options.playerRanges
      ? { valueConstraint: { values: [], ranges: options.playerRanges } }
      : {}),
    ...(options.playerContradiction
      ? {
        valueConstraint: { values: ["v1", "v2"] },
        dataType: { name: "integer" as const },
      }
      : {}),
    ...(options.playerEnumOverRange
      ? {
        valueConstraint: {
          values: options.playerEnumOverRange.values,
          ranges: options.playerEnumOverRange.ranges,
        },
        dataType: { name: options.playerEnumOverRange.dataType },
      }
      : {}),
    ...(options.playerDataType ? { dataType: { name: options.playerDataType } } : {}),
    ...(options.roleRangesWithIntegerPlayer !== undefined
      ? { dataType: { name: "integer" as const } }
      : {}),
  });

  const ft = model.addFactType({
    name: "Person scores Score",
    roles: [
      { name: "scores", playerId: person.id },
      { name: "is scored by", playerId: score.id },
    ],
    readings: ["{0} scores {1}", "{1} is scored by {0}"],
    constraints: [{ type: "internal_uniqueness", roleIds: [] }],
  });
  // Point the uniqueness at the Person role now that its id exists.
  const [personRole, scoreRole] = ft.roles;
  (ft.constraints[0] as { roleIds: string[]; }).roleIds = [personRole!.id];
  const ranges = options.roleRanges ?? options.roleRangesWithIntegerPlayer;
  if (ranges) {
    ft.addConstraint({
      type: "value_constraint",
      roleId: scoreRole!.id,
      values: [],
      ranges,
    });
  }
  return model;
}

/** Every rule the uniqueness counterexample trips, attached in isolation. */
function rulesTripped(model: OrmModel): string[] {
  const uniqueness = generateCounterexamples(model).find(
    (ce: Counterexample) => ce.constraintType === "internal_uniqueness",
  );
  expect(uniqueness, "the model must yield a uniqueness counterexample").toBeDefined();

  for (const forbidden of uniqueness!.forbidden) {
    const pop = model.addPopulation({ factTypeId: forbidden.factTypeId });
    for (const inst of forbidden.instances) {
      pop.addInstance({ roleValues: { ...inst.roleValues } });
    }
  }
  return [...new Set(populationValidationRules(model, graphFor(model)).map((d) => d.ruleId))];
}

describe("the value a bounded range mints", () => {
  // `values.ts` promises referential transparency: same model in,
  // identical output out. The candidate order is part of that promise
  // and not only a correctness question -- an inclusive bound is the
  // most obvious value to show a reader, so it is preferred over the
  // neighbours and the midpoint, all of which would also be valid.
  const scoreValueFor = (ranges: ValueRange[]): string => {
    const model = makeModel({ roleRanges: ranges });
    const ce = generateCounterexamples(model).find(
      (c: Counterexample) => c.constraintType === "internal_uniqueness",
    );
    const scoreRoleId = model.getFactTypeByName("Person scores Score")!.roles[1]!.id;
    return ce!.forbidden[0]!.instances[0]!.roleValues[scoreRoleId]!;
  };

  it("walks up from an inclusive lower bound, so index 0 is the bound itself", () => {
    expect(scoreValueFor([{ min: "1", max: "9" }])).toBe("1");
  });

  it("starts one step in when the lower bound is exclusive", () => {
    // Not the upper bound, which would also be admissible: the smallest
    // admissible whole number is the more readable answer and the one a
    // player declaring `integer` can hold.
    expect(scoreValueFor([{ min: "1", minInclusive: false, max: "9" }])).toBe("2");
  });

  it("offers a non-numeric inclusive bound as itself", () => {
    // The numeric walk-up cannot apply to a bound that is not a number,
    // so the bound is offered directly. This is the candidate the
    // numeric arm would otherwise hide.
    expect(scoreValueFor([{ min: "alpha", max: "omega" }])).toBe("alpha");
  });

  it("clears a non-numeric exclusive lower bound by appending", () => {
    expect(scoreValueFor([{ min: "alpha", minInclusive: false }])).toBe("alphaa");
  });
});

describe("a probe fills its other roles with values those roles accept", () => {
  it("trips uniqueness alone when the other role's domain is range-only", () => {
    // The reproduction from the bead: values [] with ranges 1..9.
    const tripped = rulesTripped(makeModel({ roleRanges: [{ min: "1", max: "9" }] }));
    expect(tripped).toEqual(["population/uniqueness-violation"]);
  });

  it("honours a range-only domain declared on the value type itself", () => {
    // The same defect one layer out, which barwise-945's rules made
    // visible: the player's own valueConstraint was never consulted.
    const tripped = rulesTripped(makeModel({ playerRanges: [{ min: "1", max: "9" }] }));
    expect(tripped).toEqual(["population/uniqueness-violation"]);
  });

  it("honours the player's declared data type", () => {
    const tripped = rulesTripped(makeModel({ playerDataType: "integer" }));
    expect(tripped).toEqual(["population/uniqueness-violation"]);
  });

  it("honours an exclusive lower bound, which the bound itself does not satisfy", () => {
    const tripped = rulesTripped(
      makeModel({ roleRanges: [{ min: "1", minInclusive: false, max: "9" }] }),
    );
    expect(tripped).toEqual(["population/uniqueness-violation"]);
  });

  it("honours an exclusive lower bound with no upper bound", () => {
    // Distinct from the bounded case above, and the reason the
    // candidate list carries `min + 1` at all: with no maximum there is
    // no midpoint to fall back on, so the neighbour is the only
    // candidate that clears an exclusive lower bound numerically.
    const tripped = rulesTripped(
      makeModel({ roleRanges: [{ min: "1", minInclusive: false }] }),
    );
    expect(tripped).toEqual(["population/uniqueness-violation"]);
  });

  it("honours an exclusive upper bound with no lower bound", () => {
    // The mirror, and the reason for `max - 1`.
    const tripped = rulesTripped(
      makeModel({ roleRanges: [{ max: "9", maxInclusive: false }] }),
    );
    expect(tripped).toEqual(["population/uniqueness-violation"]);
  });

  it("finds a value inside an exclusive range too narrow for a whole number", () => {
    // Exclusive 1..2 admits neither neighbour, so the midpoint is the
    // only candidate that clears it. This is what keeps the midpoint
    // from being dead code behind the two neighbours.
    const tripped = rulesTripped(
      makeModel({
        roleRanges: [{ min: "1", minInclusive: false, max: "2", maxInclusive: false }],
      }),
    );
    expect(tripped).toEqual(["population/uniqueness-violation"]);
  });

  it("clears an exclusive lower bound with a whole number when the player is integer", () => {
    // With no maximum there is no midpoint, and the player-named token
    // the minter would otherwise fall back to satisfies the RANGE -- it
    // sorts above "1" lexically -- while failing the integer data type.
    // The whole-number neighbour is the only candidate satisfying both,
    // which is what keeps it out of dead-code territory.
    const tripped = rulesTripped(
      makeModel({ roleRangesWithIntegerPlayer: [{ min: "1", minInclusive: false }] }),
    );
    expect(tripped).toEqual(["population/uniqueness-violation"]);
  });

  it("still trips uniqueness alone when the other role is unconstrained", () => {
    // The pre-existing behaviour, unchanged: no domain means the
    // player-named token is right.
    expect(rulesTripped(makeModel({}))).toEqual(["population/uniqueness-violation"]);
  });

  it("prefers a value its enumeration AND its data type both admit", () => {
    // barwise-995, the layer conjunction. Each layer used to be asked
    // alone and the first that answered won: the enumeration answered
    // "v1", which is in the enumeration and is not a decimal, and the
    // data type never got to object. Only "10" clears both, and it is
    // in the range the same constraint declares.
    const tripped = rulesTripped(
      makeModel({
        playerEnumOverRange: {
          values: ["v1", "v2"],
          ranges: [{ max: "10" }],
          dataType: "decimal",
        },
      }),
    );
    expect(tripped).toEqual(["population/uniqueness-violation"]);
  });

  it("mints the enumeration entry anyway when no value clears every layer", () => {
    // The contradictory model: an integer value type enumerating
    // non-integers admits nothing at all. The minter answers for the
    // narrowest layer and leaves the contradiction visible, rather than
    // choosing a value for no reason -- the model error is real and
    // belongs in front of the modeller (barwise-1013).
    expect(rulesTripped(makeModel({ playerContradiction: true }))).toEqual([
      "population/uniqueness-violation",
      "population/value-type-data-type-violation",
    ]);
  });
});

describe("a probe that puts one value in several roles asks all of them", () => {
  /**
   * Two unary fact types under one exclusion constraint. The probe puts
   * the SAME value in both roles -- that is what an exclusion
   * counterexample is -- and the two roles have different players, so
   * the value has to clear both.
   *
   * Minted from the first role alone it was `Alpha#1`, a player-named
   * token for an entity type with no domain at all, which the integer
   * value type on the other side rejects. "1" clears both, and it is
   * the second role's own candidate (barwise-995).
   */
  function exclusionModel(): OrmModel {
    const model = new OrmModel({ name: "Probe" });
    const alpha = model.addObjectType({
      name: "Alpha",
      kind: "entity",
      referenceMode: "alpha_id",
    });
    const beta = model.addObjectType({
      name: "Beta",
      kind: "value",
      dataType: { name: "integer" },
    });

    const flagged = model.addFactType({
      name: "Alpha is flagged",
      roles: [{ name: "is flagged", playerId: alpha.id }],
      readings: ["{0} is flagged"],
    });
    const counted = model.addFactType({
      name: "Beta is counted",
      roles: [{ name: "is counted", playerId: beta.id }],
      readings: ["{0} is counted"],
    });

    flagged.addConstraint({
      type: "exclusion",
      roleIds: [flagged.roles[0]!.id, counted.roles[0]!.id],
    });
    return model;
  }

  it("trips exclusion alone, not the other player's data type", () => {
    const model = exclusionModel();
    const exclusion = generateCounterexamples(model).find(
      (ce: Counterexample) => ce.constraintType === "exclusion",
    );
    expect(exclusion, "the model must yield an exclusion counterexample").toBeDefined();

    for (const forbidden of exclusion!.forbidden) {
      const pop = model.addPopulation({ factTypeId: forbidden.factTypeId });
      for (const inst of forbidden.instances) {
        pop.addInstance({ roleValues: { ...inst.roleValues } });
      }
    }
    const tripped = [
      ...new Set(populationValidationRules(model, graphFor(model)).map((d) => d.ruleId)),
    ];
    expect(tripped).toEqual(["population/exclusion-violation"]);
  });
});
