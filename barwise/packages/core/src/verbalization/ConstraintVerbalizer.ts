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
  verbalizeDisjunctiveMandatory,
  verbalizeEquality,
  verbalizeExclusion,
  verbalizeExclusiveOr,
  verbalizeFrequency,
  verbalizeRing,
  verbalizeSubset,
} from "./constraints/phase2.js";
import type { Verbalization } from "./Verbalization.js";

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
          constraint.roleId,
          constraint.min,
          constraint.max,
          factType,
          model,
        );
    }
  }
}
