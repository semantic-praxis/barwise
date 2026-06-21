import type { Constraint } from "../model/Constraint.js";
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
import { buildVerbalization, kwSeg, type Verbalization } from "./Verbalization.js";

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
        return verbalizeJoinEquality(constraint.paths, factType, model);
      case "join_exclusion":
        return verbalizeJoinExclusion(constraint.paths, factType, model);
    }
  }
}
