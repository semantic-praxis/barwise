import {
  type Constraint,
  type ExternalConstraint,
  type InternalConstraint,
  isExternalConstraint,
  roleIdsOf,
} from "../model/Constraint.js";
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
  // Built against the fact type; `verbalize` then gives it the
  // constraint's id and fact types like every other constraint row.
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
 * A constraint row as every surface sees it (orm-format-3, Open decision
 * 9): `sourceElementId` is the constraint's own id, and `factTypeIds` names
 * the fact types it applies to, one for an internal constraint and every
 * fact type holding one of its roles, in model order, for one across fact
 * types. One rule for every constraint row, so a consumer resolves the row
 * with `model.getConstraint` and the fact types with `getFactType`, whatever
 * the kind. Every constraint has an id (barwise-nkq); the fact type id is
 * only the type system's fallback.
 */
function asConstraintRow(
  v: Verbalization,
  constraint: Constraint,
  factTypeIds: readonly string[],
  fallbackId: string,
): Verbalization {
  return { ...v, sourceElementId: constraint.id ?? fallbackId, factTypeIds };
}

/** The fact types holding a constraint's roles, in model order. */
function factTypesSpanned(constraint: Constraint, model: OrmModel): string[] {
  return model.factTypesHolding(roleIdsOf(constraint)).map((ft) => ft.id);
}

/**
 * Verbalizes ORM constraints using FORML sentence patterns. The
 * per-constraint logic lives in ./constraints/{phase1,phase2,sentence}.
 */
export class ConstraintVerbalizer {
  /**
   * Verbalize every constraint that applies to a fact type: its internal
   * constraints, then each constraint across fact types that names one of
   * its roles (`OrmModel.constraintsTouching`). This is the view of one
   * fact type; a whole-model verbalization says each constraint across fact
   * types once, in its own section (`Verbalizer.verbalizeModel`).
   */
  verbalizeAll(
    factType: FactType,
    model: OrmModel,
  ): Verbalization[] {
    // Read from the fact type itself and the model's list, rather than by
    // id through `constraintsTouching`, so a fact type the model does not
    // hold still says its own constraints.
    const touching = model.constraints.filter((c) =>
      roleIdsOf(c).some((rid) => factType.hasRole(rid))
    );
    return [...factType.internalConstraints, ...touching].map((c) =>
      this.verbalize(c, factType, model)
    );
  }

  /**
   * Verbalize a single constraint. For an internal constraint `factType` is
   * its fact type; a constraint across fact types belongs to none, so
   * `factType` is ignored for it and the sentence is the one
   * `verbalizeExternal` gives.
   */
  verbalize(
    constraint: Constraint,
    factType: FactType,
    model: OrmModel,
  ): Verbalization {
    if (isExternalConstraint(constraint)) return this.verbalizeExternal(constraint, model);
    return asConstraintRow(
      this.verbalizeInternal(constraint, factType, model),
      constraint,
      [factType.id],
      factType.id,
    );
  }

  /**
   * Verbalize a constraint across fact types. It needs no fact type: its
   * roles are resolved model-wide and the sentence names each role's fact
   * type wherever they differ.
   */
  verbalizeExternal(constraint: ExternalConstraint, model: OrmModel): Verbalization {
    const spanned = factTypesSpanned(constraint, model);
    const id = constraint.id ?? spanned[0] ?? "";
    const v = this.verbalizeExternalByType(constraint, id, model);
    return asConstraintRow(
      constraint.modality === "deontic" ? toDeontic(v) : v,
      constraint,
      spanned,
      id,
    );
  }

  private verbalizeInternal(
    constraint: InternalConstraint,
    factType: FactType,
    model: OrmModel,
  ): Verbalization {
    // One guard for every internal kind, before dispatch, rather than a
    // fallback at each of the places a role lookup can miss. Below this
    // line an internal constraint's roles are all roles of `factType`,
    // which is what lets the per-kind verbalizers index them without
    // guarding (barwise-979). A constraint across fact types never reaches
    // here: reaching across is the point of those kinds.
    const foreign = roleIdsOf(constraint).filter((rid) => !factType.hasRole(rid));
    if (foreign.length > 0) {
      return verbalizeMalformedConstraint(constraint, factType, foreign);
    }
    const v = this.verbalizeInternalByType(constraint, factType, model);
    return constraint.modality === "deontic" ? toDeontic(v) : v;
  }

  private verbalizeInternalByType(
    constraint: InternalConstraint,
    factType: FactType,
    model: OrmModel,
  ): Verbalization {
    switch (constraint.type) {
      case "internal_uniqueness":
        return verbalizeInternalUniqueness(constraint.roleIds, factType, model);
      case "mandatory":
        return verbalizeMandatory(constraint.roleId, factType, model);
      case "value_constraint":
        return verbalizeValueConstraint(
          constraint.roleId,
          constraint.values,
          constraint.ranges,
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
    }
  }

  private verbalizeExternalByType(
    constraint: ExternalConstraint,
    id: string,
    model: OrmModel,
  ): Verbalization {
    switch (constraint.type) {
      case "external_uniqueness":
        return verbalizeExternalUniqueness(constraint.roleIds, id, model);
      case "disjunctive_mandatory":
        return verbalizeDisjunctiveMandatory(constraint.roleIds, id, model);
      case "exclusion":
        return verbalizeExclusion(constraint.roleIds, id, model);
      case "exclusive_or":
        return verbalizeExclusiveOr(constraint.roleIds, id, model);
      case "subset":
        return verbalizeSubset(constraint.subsetRoleIds, constraint.supersetRoleIds, id, model);
      case "equality":
        return verbalizeEquality(constraint.roleIds1, constraint.roleIds2, id, model);
      case "join_subset":
        return verbalizeJoinSubset(constraint.subset, constraint.superset, id, model);
      case "join_equality":
        return verbalizeJoinEquality(constraint.operands, id, model);
      case "join_exclusion":
        return verbalizeJoinExclusion(constraint.operands, id, model);
    }
  }
}
