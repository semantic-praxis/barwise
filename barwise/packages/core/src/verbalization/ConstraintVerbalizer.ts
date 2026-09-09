import { type Constraint, requiresLocalRoles, roleIdsOf } from "../model/Constraint.js";
import type { FactType } from "../model/FactType.js";
import type { OrmModel } from "../model/OrmModel.js";
import {
  verbalizeExternalUniqueness,
  verbalizeInternalUniqueness,
  verbalizeMandatory,
  verbalizeValueConstraint,
} from "./constraints/phase1.js";
import {
  verbalizeCardinality,
  verbalizeDisjunctiveMandatory,
  verbalizeEquality,
  verbalizeExclusion,
  verbalizeExclusiveOr,
  verbalizeFrequency,
  verbalizeJoinEquality,
  verbalizeJoinExclusion,
  verbalizeJoinSubset,
  verbalizeRing,
  verbalizeSubset,
  verbalizeValueComparison,
} from "./constraints/phase2.js";
import { buildVerbalization, kwSeg, refSeg, textSeg, type Verbalization } from "./Verbalization.js";

/** The English name of a constraint kind, for the malformed sentence. */
const KIND_NAME: Record<Constraint["type"], string> = {
  internal_uniqueness: "uniqueness",
  mandatory: "mandatory",
  value_constraint: "value",
  ring: "ring",
  frequency: "frequency",
  cardinality: "cardinality",
  value_comparison: "value comparison",
  external_uniqueness: "external uniqueness",
  disjunctive_mandatory: "disjunctive mandatory",
  exclusion: "exclusion",
  exclusive_or: "exclusive-or",
  subset: "subset",
  equality: "equality",
  join_subset: "join subset",
  join_equality: "join equality",
  join_exclusion: "join exclusion",
};

/**
 * What a constraint says when it names roles its fact type does not have.
 *
 * The alternative this replaces was prose built from the raw id --
 * "Each r3 must: r3 has r3." -- which reads as a statement about the
 * domain and is not one. A reader cannot tell it from a real sentence
 * about a type called r3, which is the failure worth removing: the
 * output looked like an answer.
 *
 * Not a refusal, deliberately. `verbalize` is the capability that runs
 * on models nobody has validated -- no surface validates before
 * verbalizing -- so refusing the whole model would take away its use on
 * work in progress. The other constraints still verbalize; this one says
 * what is wrong with it.
 */
function verbalizeMalformedConstraint(
  constraint: Constraint,
  factType: FactType,
  foreignRoleIds: readonly string[],
): Verbalization {
  const plural = foreignRoleIds.length > 1;
  // `factType.id`, as every other constraint row in phase1 and phase2
  // passes. `constraint.id ?? factType.id` would put two id spaces in
  // one field depending on whether the constraint happened to carry an
  // id, and `barwise verbalize --format json` emits it: a consumer
  // resolving rows with `getFactType(sourceElementId)` would get
  // `undefined` for exactly the malformed ones.
  return buildVerbalization(factType.id, "constraint", [
    kwSeg("Malformed: "),
    textSeg(`the ${KIND_NAME[constraint.type]} constraint on `),
    refSeg(factType.name, factType.id),
    textSeg(
      ` names ${plural ? "roles" : "role"} ${
        foreignRoleIds.map((r) => `"${r}"`).join(", ")
      }, which ${plural ? "are" : "is"} not among its roles.`,
    ),
  ]);
}

/**
 * Render a constraint's verbalization as a deontic obligation: prefix
 * "It is obligatory that " and lower-case a leading keyword so the
 * sentence reads as an obligation ("Each ..." -> "... that each ...").
 */
function toDeontic(v: Verbalization): Verbalization {
  const segments = v.segments.map((s, i) =>
    i === 0 && s.kind === "keyword" && s.text.length > 0
      ? { ...s, text: s.text.charAt(0).toLowerCase() + s.text.slice(1) }
      : s
  );
  return buildVerbalization(v.sourceElementId, v.category, [
    kwSeg("It is obligatory that "),
    ...segments,
  ]);
}

/**
 * Verbalizes ORM constraints using FORML sentence patterns. The
 * per-constraint logic lives in ./constraints/{phase1,phase2,sentence}.
 */
export class ConstraintVerbalizer {
  /**
   * Verbalize all constraints on a fact type.
   */
  verbalizeAll(
    factType: FactType,
    model: OrmModel,
  ): Verbalization[] {
    return factType.constraints.map((c) => this.verbalize(c, factType, model));
  }

  /**
   * Verbalize a single constraint.
   */
  verbalize(
    constraint: Constraint,
    factType: FactType,
    model: OrmModel,
  ): Verbalization {
    // One guard for every kind, before dispatch, rather than a fallback
    // at each of the places a role lookup can miss. Below this line a
    // local-role constraint's roles are all roles of `factType`, which
    // is what lets the per-kind verbalizers index them without guarding
    // (barwise-979).
    //
    // `requiresLocalRoles` is what stops this flagging the constraints
    // that span fact types on purpose -- an external uniqueness
    // constraint is SUPPOSED to reach across, and reporting it here
    // would be a false finding on a correct model.
    if (requiresLocalRoles(constraint)) {
      const foreign = roleIdsOf(constraint).filter((rid) => !factType.hasRole(rid));
      if (foreign.length > 0) {
        return verbalizeMalformedConstraint(constraint, factType, foreign);
      }
    }
    const v = this.verbalizeByType(constraint, factType, model);
    return constraint.modality === "deontic" ? toDeontic(v) : v;
  }

  private verbalizeByType(
    constraint: Constraint,
    factType: FactType,
    model: OrmModel,
  ): Verbalization {
    switch (constraint.type) {
      case "internal_uniqueness":
        return verbalizeInternalUniqueness(
          constraint.roleIds,
          factType,
          model,
        );
      case "mandatory":
        return verbalizeMandatory(
          constraint.roleId,
          factType,
          model,
        );
      case "value_constraint":
        return verbalizeValueConstraint(
          constraint.roleId,
          constraint.values,
          constraint.ranges,
          factType,
          model,
        );
      case "external_uniqueness":
        return verbalizeExternalUniqueness(
          constraint.roleIds,
          factType,
          model,
        );
      case "disjunctive_mandatory":
        return verbalizeDisjunctiveMandatory(
          constraint.roleIds,
          factType,
          model,
        );
      case "exclusion":
        return verbalizeExclusion(
          constraint.roleIds,
          factType,
          model,
        );
      case "exclusive_or":
        return verbalizeExclusiveOr(
          constraint.roleIds,
          factType,
          model,
        );
      case "subset":
        return verbalizeSubset(
          constraint.subsetRoleIds,
          constraint.supersetRoleIds,
          factType,
          model,
        );
      case "equality":
        return verbalizeEquality(
          constraint.roleIds1,
          constraint.roleIds2,
          factType,
          model,
        );
      case "ring":
        return verbalizeRing(
          constraint.roleId1,
          constraint.roleId2,
          constraint.ringType,
          factType,
          model,
        );
      case "frequency":
        return verbalizeFrequency(
          constraint.roleIds,
          constraint.min,
          constraint.max,
          factType,
          model,
        );
      case "value_comparison":
        return verbalizeValueComparison(
          constraint.roleId1,
          constraint.roleId2,
          constraint.operator,
          factType,
          model,
        );
      case "cardinality":
        return verbalizeCardinality(
          constraint.roleId,
          constraint.min,
          constraint.max,
          factType,
          model,
        );
      case "join_subset":
        return verbalizeJoinSubset(constraint.subset, constraint.superset, factType, model);
      case "join_equality":
        return verbalizeJoinEquality(constraint.operands, factType, model);
      case "join_exclusion":
        return verbalizeJoinExclusion(constraint.operands, factType, model);
    }
  }
}
