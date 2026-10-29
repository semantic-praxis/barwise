/**
 * The ConstraintSpec payload for a constraint an export format cannot
 * express: its verbalization, a per-kind pseudocode predicate, and a
 * counterexample. Shared by every format that spills constraints (the
 * constraint router, the Ossie writer), so the pseudocode is written once.
 *
 * A constraint over subtypes names its supertype and subtypes instead of
 * roles (schema-export-subtype-constraints.spec.md, barwise-lwy). A value type's own value
 * constraint is not a `Constraint` in the model, but the router builds one
 * for each role it constrains and passes that, so each column's spec names
 * its own role.
 */
import { generateCounterexampleInView } from "../counterexample/index.js";
import type { ConstraintSpec } from "../export/types.js";
import {
  type Constraint,
  isOverSubtypes,
  roleIdsOf,
  type SubtypeConstraint,
} from "../model/Constraint.js";
import type { FactType } from "../model/FactType.js";
import type { ConstraintInView, OrmModel } from "../model/OrmModel.js";
import { findRole } from "../model/roleLookup.js";
import { subtypeOperands } from "../model/subtypeOperands.js";
import { SUBTYPE_QUANTITY } from "../verbalization/constraints/phase2.js";
import type { ConstraintVerbalizer } from "../verbalization/index.js";

export function buildConstraintSpec(
  inView: ConstraintInView,
  model: OrmModel,
  verbalizer: ConstraintVerbalizer,
): ConstraintSpec {
  const [c, ft] = inView;
  let verbalization: string;
  try {
    verbalization = verbalizer.reportInView(inView, model).verbalization;
  } catch {
    // The fact type it lives in, or the ones it spans: never a 2.0 host.
    const names = model.factTypesNaming(inView).map((f) => `"${f.name}"`);
    const named = names.length > 0 ? names.join(", ") : "no fact type (its roles do not resolve)";
    verbalization = `${c.type} constraint on ${named}`;
  }

  let example: string;
  try {
    const ce = generateCounterexampleInView(inView, model);
    const instance = isOverSubtypes(c) ? subtypeInstance(c, model) : undefined;
    example = ce
      ? `Forbidden: ${ce.text}`
      : instance
      ? `Forbidden: ${instance}`
      : "No concrete example available; see the verbalization.";
  } catch {
    example = "No concrete example available; see the verbalization.";
  }

  return {
    verbalization,
    pseudocode: constraintPseudocode(c, ft, model),
    example,
  };
}

/**
 * A constraint over subtypes as membership of the supertype's instances
 * in the subtypes: each subtype is a table whose key references the
 * supertype's, so this is the rule a reader checks across those tables.
 */
function subtypePseudocode(c: SubtypeConstraint, model: OrmModel): string {
  const factIds = c.subtypeFactIds;
  const { supertypeId, subtypeIds } = subtypeOperands(factIds, model);
  const nameOf = (id: string | undefined) =>
    id === undefined ? undefined : model.getObjectType(id)?.name;
  const supertype = nameOf(supertypeId) ?? "the supertype";
  const subtypes = subtypeIds.map((id, i) => nameOf(id) ?? factIds[i]!);
  // As the verbalizer says it: "Each Staff is a Assistant."
  if (c.type === "disjunctive_mandatory" && subtypes.length === 1) {
    return `every instance of ${supertype} is an instance of ${subtypes[0]}`;
  }
  const quantity = SUBTYPE_QUANTITY[c.type];
  return `every instance of ${supertype} is an instance of ${quantity} of: ${subtypes.join(", ")}`;
}

/**
 * A per-type pseudocode predicate: enough for a human or agent to
 * implement the constraint in query logic, a dbt test, or application
 * code.
 */
function constraintPseudocode(c: Constraint, ft: FactType | undefined, model: OrmModel): string {
  if (isOverSubtypes(c)) return subtypePseudocode(c, model);
  // Every kind that reads it is internal, so has a fact type.
  const fact = ft?.name ?? "";
  switch (c.type) {
    case "ring": {
      const templates: Record<string, string> = {
        irreflexive: `for all x: not ${fact}(x, x)`,
        asymmetric: `for all x, y: ${fact}(x, y) implies not ${fact}(y, x)`,
        antisymmetric: `for all x, y where x != y: ${fact}(x, y) implies not ${fact}(y, x)`,
        intransitive: `for all x, y, z: ${fact}(x, y) and ${fact}(y, z) implies not ${fact}(x, z)`,
        acyclic: `no cycle in the directed graph of ${fact}`,
        symmetric: `for all x, y: ${fact}(x, y) implies ${fact}(y, x)`,
        transitive: `for all x, y, z: ${fact}(x, y) and ${fact}(y, z) implies ${fact}(x, z)`,
        purely_reflexive: `for all x, y: ${fact}(x, y) implies x = y`,
      };
      return templates[c.ringType] ?? `ring(${c.ringType}) holds over ${fact}`;
    }
    case "frequency": {
      const max = c.max === "unbounded" ? "unbounded" : String(c.max);
      return `for each value combination of (${roleLabels(c.roleIds, ft, model)}): `
        + `count of occurrences in ${fact} is between ${c.min} and ${max}`;
    }
    case "cardinality": {
      const max = c.max === undefined ? "unbounded" : String(c.max);
      return `count of instances playing ${roleLabels([c.roleId], ft, model)} `
        + `is between ${c.min ?? 0} and ${max}`;
    }
    case "exclusion":
      return `no instance plays more than one of: ${roleLabels(roleIdsOf(c), ft, model)}`;
    case "exclusive_or":
      return `each instance plays exactly one of: ${roleLabels(roleIdsOf(c), ft, model)}`;
    case "disjunctive_mandatory":
      return `each instance plays at least one of: ${roleLabels(roleIdsOf(c), ft, model)}`;
    case "subset":
      return `population(${roleLabels(c.subsetRoleIds, ft, model)}) is a subset of `
        + `population(${roleLabels(c.supersetRoleIds, ft, model)})`;
    case "equality":
      return `population(${roleLabels(c.roleIds1, ft, model)}) equals `
        + `population(${roleLabels(c.roleIds2, ft, model)})`;
    case "external_uniqueness":
      return `the combination (${
        roleLabels(c.roleIds, ft, model)
      }) is unique across the population`;
    case "internal_uniqueness":
      return `the combination (${roleLabels(c.roleIds, ft, model)}) is unique within ${fact}`;
    case "value_constraint": {
      const values = c.values.length > 0 ? `one of {${c.values.join(", ")}}` : "";
      const ranges = (c.ranges ?? [])
        .map((r) => rangeText(r.min, r.max, r.minInclusive, r.maxInclusive))
        .join(" or ");
      const alternatives = [values, ranges].filter((s) => s.length > 0).join(" or ");
      return `value of ${
        roleLabels(c.roleId ? [c.roleId] : [], ft, model) || fact
      } is ${alternatives}`;
    }
    case "value_comparison":
      return `value(${roleLabels([c.roleId1], ft, model)}) ${c.operator} `
        + `value(${roleLabels([c.roleId2], ft, model)})`;
    case "mandatory":
      return `every instance of ${roleLabels([c.roleId], ft, model)} plays the role in ${fact}`;
    case "join_subset":
      return `projected tuples of the subset join path are contained in the superset join path`;
    case "join_equality":
      return `projected tuples of all join-path operands are identical`;
    case "join_exclusion":
      return `no tuple appears in the projection of more than one join-path operand`;
    case "join_ring":
      return `the pairs the join path projects are ${c.ringType.replace("_", " ")}`;
    default:
      return `${(c as Constraint).type} holds over ${fact}`;
  }
}

function rangeText(
  min: string | undefined,
  max: string | undefined,
  minInclusive: boolean | undefined,
  maxInclusive: boolean | undefined,
): string {
  const lower = min !== undefined ? `>${minInclusive === false ? "" : "="} ${min}` : "";
  const upper = max !== undefined ? `<${maxInclusive === false ? "" : "="} ${max}` : "";
  return [lower, upper].filter((s) => s.length > 0).join(" and ");
}

/** Human-readable labels for a role sequence: "Player.roleName" each. */
function roleLabels(
  roleIds: readonly string[],
  ft: FactType | undefined,
  model: OrmModel,
): string {
  return roleIds
    .map((roleId) => {
      const { role } = findRole(roleId, ft, model) ?? {};
      if (!role) return roleId;
      const player = model.getObjectType(role.playerId);
      return player ? `${player.name}.${role.name}` : role.name;
    })
    .join(", ");
}

/**
 * The instance a constraint over subtypes forbids, in words: one supertype
 * instance in two of the subtypes, or in none (barwise-j7j). Not a
 * `Counterexample`, whose populations must trip population validation:
 * subtype membership is not populated in a model, so there is nothing to
 * mint, but the instance needs no population to be stated. Undefined when
 * a subtype does not resolve to a name, or an exclusion or exclusive-or
 * names fewer than two.
 */
function subtypeInstance(c: SubtypeConstraint, model: OrmModel): string | undefined {
  const { supertypeId, subtypeIds } = subtypeOperands(c.subtypeFactIds, model);
  const name = (id: string | undefined) => (id && model.getObjectType(id)?.name) || undefined;
  const supertype = name(supertypeId);
  const subtypes = subtypeIds.map(name);
  // A list with one left out would forbid an allowed instance, and one
  // naming a subtype twice, or one under another supertype, states an
  // instance the rule says nothing about. Validation reports both shapes;
  // an export can still run on them.
  const sameSupertype = c.subtypeFactIds.every((id) =>
    model.getSubtypeFact(id)?.supertypeId === supertypeId
  );
  if (
    !supertype || subtypes.length === 0 || subtypes.includes(undefined)
    || new Set(subtypes).size !== subtypes.length || !sameSupertype
  ) {
    return undefined;
  }
  const neither = `one ${supertype} in none of: ${subtypes.join(", ")}`;
  // The "both" form needs two subtypes; over one, only "none of" forbids.
  const both = subtypes.length >= 2
    ? `one ${supertype} in both ${subtypes[0]} and ${subtypes[1]}`
    : undefined;
  switch (c.type) {
    case "exclusion":
      return both;
    case "disjunctive_mandatory":
      return neither;
    case "exclusive_or":
      return both ? `${both}, or ${neither}` : neither;
  }
}
