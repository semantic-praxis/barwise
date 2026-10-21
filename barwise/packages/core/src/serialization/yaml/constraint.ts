import type {
  Constraint,
  ConstraintModality,
  RingType,
  ValueComparisonOperator,
} from "../../model/Constraint.js";
import {
  deserializeJoinOperand,
  type OrmYamlJoinOperand,
  serializeJoinOperand,
} from "./rolePath.js";
import {
  deserializeValueConstraintBody,
  type OrmYamlValueConstraintBody,
  serializeValueConstraintBody,
} from "./valueConstraint.js";

type OrmYamlConstraintBody =
  | { type: "internal_uniqueness"; roles: string[]; is_preferred?: boolean; }
  | { type: "mandatory"; role: string; }
  | { type: "external_uniqueness"; roles: string[]; }
  | ({ type: "value_constraint"; role?: string; } & OrmYamlValueConstraintBody)
  | ({ type: "disjunctive_mandatory"; } & OrmYamlRolesOrSubtypeFacts)
  | ({ type: "exclusion"; } & OrmYamlRolesOrSubtypeFacts)
  | ({ type: "exclusive_or"; } & OrmYamlRolesOrSubtypeFacts)
  | { type: "subset"; subset_roles: string[]; superset_roles: string[]; }
  | { type: "equality"; roles_1: string[]; roles_2: string[]; }
  | { type: "ring"; role_1: string; role_2: string; ring_type: RingType; }
  | { type: "frequency"; role?: string; roles?: string[]; min: number; max: number | "unbounded"; }
  | {
    type: "value_comparison";
    role_1: string;
    role_2: string;
    operator: ValueComparisonOperator;
  }
  | { type: "cardinality"; role: string; min: number; max: number | "unbounded"; }
  | { type: "join_subset"; subset: OrmYamlJoinOperand; superset: OrmYamlJoinOperand; }
  | { type: "join_equality"; operands: OrmYamlJoinOperand[]; }
  | { type: "join_exclusion"; operands: OrmYamlJoinOperand[]; };

/**
 * The operand of an exclusion, a disjunctive mandatory or an exclusive-or
 * as a file states it: roles, or a supertype's subtype facts
 * (orm-format-3, Open decision 2).
 */
type OrmYamlRolesOrSubtypeFacts =
  | { roles: string[]; subtype_facts?: never; }
  | { subtype_facts: string[]; roles?: never; };

/** A serialized constraint carries the shared optional `modality`. */
export type OrmYamlConstraint = OrmYamlConstraintBody & { modality?: ConstraintModality; };

export function serializeConstraint(c: Constraint): OrmYamlConstraint {
  let result: OrmYamlConstraint;
  switch (c.type) {
    case "internal_uniqueness": {
      result = { type: "internal_uniqueness", roles: [...c.roleIds] };
      break;
    }
    case "mandatory":
      result = { type: "mandatory", role: c.roleId };
      break;
    case "external_uniqueness":
      result = { type: "external_uniqueness", roles: [...c.roleIds] };
      break;
    case "value_constraint": {
      const vc: Extract<OrmYamlConstraint, { type: "value_constraint"; }> = {
        type: "value_constraint",
        ...serializeValueConstraintBody(c.values, c.ranges),
      };
      if (c.roleId) {
        vc.role = c.roleId;
      }
      result = vc;
      break;
    }
    case "disjunctive_mandatory":
      result = c.subtypeFactIds
        ? { type: "disjunctive_mandatory", subtype_facts: [...c.subtypeFactIds] }
        : { type: "disjunctive_mandatory", roles: [...c.roleIds] };
      break;
    case "exclusion":
      result = c.subtypeFactIds
        ? { type: "exclusion", subtype_facts: [...c.subtypeFactIds] }
        : { type: "exclusion", roles: [...c.roleIds] };
      break;
    case "exclusive_or":
      result = c.subtypeFactIds
        ? { type: "exclusive_or", subtype_facts: [...c.subtypeFactIds] }
        : { type: "exclusive_or", roles: [...c.roleIds] };
      break;
    case "subset":
      result = {
        type: "subset",
        subset_roles: [...c.subsetRoleIds],
        superset_roles: [...c.supersetRoleIds],
      };
      break;
    case "equality":
      result = { type: "equality", roles_1: [...c.roleIds1], roles_2: [...c.roleIds2] };
      break;
    case "ring":
      result = { type: "ring", role_1: c.roleId1, role_2: c.roleId2, ring_type: c.ringType };
      break;
    case "frequency":
      result = c.roleIds.length === 1
        ? { type: "frequency", role: c.roleIds[0]!, min: c.min, max: c.max }
        : { type: "frequency", roles: [...c.roleIds], min: c.min, max: c.max };
      break;
    case "value_comparison":
      result = {
        type: "value_comparison",
        role_1: c.roleId1,
        role_2: c.roleId2,
        operator: c.operator,
      };
      break;
    case "cardinality":
      result = { type: "cardinality", role: c.roleId, min: c.min, max: c.max };
      break;
    case "join_subset":
      result = {
        type: "join_subset",
        subset: serializeJoinOperand(c.subset),
        superset: serializeJoinOperand(c.superset),
      };
      break;
    case "join_equality":
      result = { type: "join_equality", operands: c.operands.map(serializeJoinOperand) };
      break;
    case "join_exclusion":
      result = { type: "join_exclusion", operands: c.operands.map(serializeJoinOperand) };
      break;
  }
  // Add constraint ID if present
  if (c.id) {
    (result as { id?: string; }).id = c.id;
  }
  // Modality round-trips only when deontic; alethic is the omitted default.
  if (c.modality === "deontic") {
    result.modality = "deontic";
  }
  return result;
}

export function deserializeConstraint(c: OrmYamlConstraint): Constraint {
  let result: Constraint;
  const id = (c as { id?: string; }).id;

  switch (c.type) {
    case "internal_uniqueness": {
      // A 2.0 file's `is_preferred` is the 2.0 reader's to place on an
      // entity (`storePreferredFlags`); the constraint does not carry it.
      result = { type: "internal_uniqueness", roleIds: c.roles };
      break;
    }
    case "mandatory":
      result = { type: "mandatory", roleId: c.role };
      break;
    case "external_uniqueness":
      result = { type: "external_uniqueness", roleIds: c.roles };
      break;
    case "value_constraint": {
      const body = deserializeValueConstraintBody(c);
      result = body.ranges
        ? { type: "value_constraint", roleId: c.role, values: body.values, ranges: body.ranges }
        : { type: "value_constraint", roleId: c.role, values: body.values };
      break;
    }
    case "disjunctive_mandatory":
      result = c.subtype_facts
        ? { type: "disjunctive_mandatory", subtypeFactIds: c.subtype_facts }
        : { type: "disjunctive_mandatory", roleIds: c.roles };
      break;
    case "exclusion":
      result = c.subtype_facts
        ? { type: "exclusion", subtypeFactIds: c.subtype_facts }
        : { type: "exclusion", roleIds: c.roles };
      break;
    case "exclusive_or":
      result = c.subtype_facts
        ? { type: "exclusive_or", subtypeFactIds: c.subtype_facts }
        : { type: "exclusive_or", roleIds: c.roles };
      break;
    case "subset":
      result = {
        type: "subset",
        subsetRoleIds: c.subset_roles,
        supersetRoleIds: c.superset_roles,
      };
      break;
    case "equality":
      result = { type: "equality", roleIds1: c.roles_1, roleIds2: c.roles_2 };
      break;
    case "ring":
      result = { type: "ring", roleId1: c.role_1, roleId2: c.role_2, ringType: c.ring_type };
      break;
    case "frequency":
      result = {
        type: "frequency",
        roleIds: c.roles ?? (c.role !== undefined ? [c.role] : []),
        min: c.min,
        max: c.max,
      };
      break;
    case "value_comparison":
      result = {
        type: "value_comparison",
        roleId1: c.role_1,
        roleId2: c.role_2,
        operator: c.operator,
      };
      break;
    case "cardinality":
      result = { type: "cardinality", roleId: c.role, min: c.min, max: c.max };
      break;
    case "join_subset":
      result = {
        type: "join_subset",
        subset: deserializeJoinOperand(c.subset),
        superset: deserializeJoinOperand(c.superset),
      };
      break;
    case "join_equality":
      result = { type: "join_equality", operands: c.operands.map(deserializeJoinOperand) };
      break;
    case "join_exclusion":
      result = { type: "join_exclusion", operands: c.operands.map(deserializeJoinOperand) };
      break;
  }

  // Preserve ID if present in serialized form
  if (id) {
    result = { ...result, id };
  }
  // Preserve deontic modality (alethic is the omitted default).
  if (c.modality === "deontic") {
    result = { ...result, modality: "deontic" };
  }

  return result;
}
