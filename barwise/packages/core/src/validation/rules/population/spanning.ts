import { isEquality, isExclusion, isExclusiveOr, isSubset } from "../../../model/Constraint.js";
import type { OrmModel } from "../../../model/OrmModel.js";
import type { Diagnostic } from "../../Diagnostic.js";
import { reportAs, RULE_ID } from "../../ruleId.js";
import { constraintElementId } from "../../span.js";
import {
  compositeKeyParts,
  type ObjectUniverse,
  rolePlayerMap,
  severityForModality,
  tuplesForRoleSeq,
  valuesPlayedInRole,
} from "./shared.js";

/** A composite key as a message shows it: its parts, not its separator. */
const showTuple = (key: string): string => compositeKeyParts(key).join(", ");

/**
 * Exclusion constraints: no object may play more than one of the excluded
 * roles, across the whole population. Every exclusion is checked here,
 * whether its roles span fact types or sit in one: an object that plays
 * both roles in different fact instances violates it as surely as one
 * that plays both in a single instance, which is all a per-instance check
 * could see (owner, 2026-10-19; orm-format-3 3a-ii-b notes).
 */
export function checkExclusionViolations(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const c of model.constraints) {
    if (!isExclusion(c)) continue;

    const valuesByRole = c.roleIds.map((rid) => valuesPlayedInRole(model, rid));
    const all = new Set<string>();
    for (const set of valuesByRole) {
      for (const value of set) all.add(value);
    }
    for (const value of all) {
      const count = valuesByRole.filter((set) => set.has(value)).length;
      if (count > 1) {
        diagnostics.push(
          reportAs(
            severityForModality(c),
            RULE_ID.exclusionViolation,
            "default",
            constraintElementId(c),
            c.roleIds.join(", "),
            value,
            count,
          ),
        );
      }
    }
  }
  return diagnostics;
}

/**
 * Exclusive-or constraints: every instance of the common player type must
 * play exactly one of the roles, across the whole population. Checked here
 * for every exclusive-or, local or spanning: a per-instance reading would
 * flag every instance of a fact type that fills both roles, which is every
 * instance of a binary (owner, 2026-10-19).
 *
 * The two halves read different sets. "Plays more than one" is present
 * data, so it reads every value played, sample populations included -- a
 * sample is positive evidence. "Plays none" is absence, so it reads only
 * the universe, which leaves samples out.
 */
export function checkExclusiveOrViolations(
  model: OrmModel,
  universe: ObjectUniverse,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const rolePlayer = rolePlayerMap(model);

  for (const c of model.constraints) {
    if (!isExclusiveOr(c)) continue;

    const playerId = c.roleIds
      .map((rid) => rolePlayer.get(rid))
      .find((p) => p !== undefined);
    if (playerId === undefined) continue;
    const required = universe.get(playerId) ?? new Set<string>();

    const valuesByRole = c.roleIds.map((rid) => valuesPlayedInRole(model, rid));
    const candidates = new Set<string>(required);
    for (const set of valuesByRole) for (const value of set) candidates.add(value);
    for (const value of candidates) {
      const count = valuesByRole.filter((set) => set.has(value)).length;
      if (count > 1 || (count === 0 && required.has(value))) {
        diagnostics.push(
          reportAs(
            severityForModality(c),
            RULE_ID.exclusiveOrViolation,
            "default",
            constraintElementId(c),
            c.roleIds.join(", "),
            value,
            count,
          ),
        );
      }
    }
  }
  return diagnostics;
}

/**
 * Subset constraints: every tuple in the subset role sequence must appear in
 * the superset role sequence, across the whole population. Every subset is
 * checked here, local or spanning (owner, 2026-10-20, barwise-h2a): a
 * per-population check padded an unfilled role with an empty value and
 * reported it, and reported a tuple whose match sat in another population
 * of the same fact type -- two false violations. A tuple with an unfilled role is skipped,
 * as an incomplete instance is reported on its own.
 */
export function checkSubsetViolations(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const c of model.constraints) {
    if (!isSubset(c)) continue;

    const subsetTuples = tuplesForRoleSeq(model, c.subsetRoleIds);
    const supersetTuples = tuplesForRoleSeq(model, c.supersetRoleIds);
    for (const tuple of subsetTuples) {
      if (!supersetTuples.has(tuple)) {
        diagnostics.push(
          reportAs(
            severityForModality(c),
            RULE_ID.subsetViolation,
            "default",
            constraintElementId(c),
            showTuple(tuple),
            c.subsetRoleIds.join(", "),
            c.supersetRoleIds.join(", "),
          ),
        );
      }
    }
  }
  return diagnostics;
}

/**
 * Equality constraints: the tuple sets of both role sequences must be
 * identical, across the whole population -- local or spanning, for the
 * same reasons as subset (barwise-h2a).
 */
export function checkEqualityViolations(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const c of model.constraints) {
    if (!isEquality(c)) continue;

    const tuples1 = tuplesForRoleSeq(model, c.roleIds1);
    const tuples2 = tuplesForRoleSeq(model, c.roleIds2);
    for (const tuple of tuples1) {
      if (!tuples2.has(tuple)) {
        diagnostics.push(
          reportAs(
            severityForModality(c),
            RULE_ID.equalityViolation,
            "default",
            constraintElementId(c),
            showTuple(tuple),
            c.roleIds1.join(", "),
            c.roleIds2.join(", "),
          ),
        );
      }
    }
    for (const tuple of tuples2) {
      if (!tuples1.has(tuple)) {
        diagnostics.push(
          reportAs(
            severityForModality(c),
            RULE_ID.equalityViolation,
            "reverse",
            constraintElementId(c),
            showTuple(tuple),
            c.roleIds2.join(", "),
            c.roleIds1.join(", "),
          ),
        );
      }
    }
  }
  return diagnostics;
}
