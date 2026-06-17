/**
 * Phase 1 constraint verbalizations: uniqueness, mandatory, value, and
 * external uniqueness.
 */
import type { FactType } from "../../model/FactType.js";
import type { ValueRange } from "../../model/ObjectType.js";
import type { OrmModel } from "../../model/OrmModel.js";
import {
  buildVerbalization,
  kwSeg,
  refSeg,
  textSeg,
  valSeg,
  type Verbalization,
  type VerbalizationSegment,
} from "../Verbalization.js";
import { extractPredicate } from "./sentence.js";

export function verbalizeInternalUniqueness(
  roleIds: readonly string[],
  factType: FactType,
  model: OrmModel,
): Verbalization {
  if (factType.arity === 2 && roleIds.length === 1) {
    return verbalizeBinaryUniqueness(
      roleIds[0]!,
      factType,
      model,
    );
  }

  if (factType.arity > 2 && roleIds.length < factType.arity) {
    return verbalizeMultiRoleUniqueness(
      roleIds,
      factType,
      model,
    );
  }

  return verbalizeGenericUniqueness(roleIds, factType, model);
}

/**
 * "Each {Subject} {predicate} at most one {Object}."
 */
export function verbalizeBinaryUniqueness(
  constrainedRoleId: string,
  factType: FactType,
  model: OrmModel,
): Verbalization {
  const constrainedIdx = factType.roles.findIndex(
    (r) => r.id === constrainedRoleId,
  );
  const otherIdx = constrainedIdx === 0 ? 1 : 0;

  const subjectRole = factType.roles[constrainedIdx]!;
  const objectRole = factType.roles[otherIdx]!;
  const subjectType = model.getObjectType(subjectRole.playerId);
  const objectType = model.getObjectType(objectRole.playerId);
  const subjectName = subjectType?.name ?? subjectRole.name;
  const objectName = objectType?.name ?? objectRole.name;

  const predicate = extractPredicate(
    factType,
    constrainedIdx,
    otherIdx,
  );

  const segments: VerbalizationSegment[] = [
    kwSeg("Each "),
    refSeg(subjectName, subjectRole.playerId),
    textSeg(" " + predicate + " "),
    kwSeg("at most one "),
    refSeg(objectName, objectRole.playerId),
    textSeg("."),
  ];

  return buildVerbalization(factType.id, "constraint", segments);
}

/**
 * Multi-role uniqueness on a ternary+ fact type.
 */
export function verbalizeMultiRoleUniqueness(
  roleIds: readonly string[],
  factType: FactType,
  model: OrmModel,
): Verbalization {
  const constrainedIndices = roleIds
    .map((rid) => factType.roles.findIndex((r) => r.id === rid))
    .filter((i) => i >= 0);
  const unconstrainedIndices = factType.roles
    .map((_, i) => i)
    .filter((i) => !constrainedIndices.includes(i));

  const segments: VerbalizationSegment[] = [kwSeg("For each ")];

  for (let i = 0; i < constrainedIndices.length; i++) {
    const role = factType.roles[constrainedIndices[i]!]!;
    const ot = model.getObjectType(role.playerId);
    if (i > 0 && i === constrainedIndices.length - 1) {
      segments.push(textSeg(" and "));
    } else if (i > 0) {
      segments.push(textSeg(", "));
    }
    segments.push(refSeg(ot?.name ?? role.name, role.playerId));
  }

  segments.push(textSeg(" combination, "));
  segments.push(kwSeg("at most one "));

  for (let i = 0; i < unconstrainedIndices.length; i++) {
    const role = factType.roles[unconstrainedIndices[i]!]!;
    const ot = model.getObjectType(role.playerId);
    if (i > 0) {
      segments.push(textSeg(" and "));
    }
    segments.push(refSeg(ot?.name ?? role.name, role.playerId));
  }

  segments.push(textSeg(" applies."));

  return buildVerbalization(factType.id, "constraint", segments);
}

/**
 * Generic fallback for unary or spanning uniqueness.
 */
export function verbalizeGenericUniqueness(
  roleIds: readonly string[],
  factType: FactType,
  model: OrmModel,
): Verbalization {
  const roleNames = roleIds.map((rid) => {
    const role = factType.getRoleById(rid);
    if (!role) return rid;
    const ot = model.getObjectType(role.playerId);
    return ot?.name ?? role.name;
  });

  const segments: VerbalizationSegment[] = [
    textSeg("Each combination of "),
  ];

  for (let i = 0; i < roleIds.length; i++) {
    const role = factType.getRoleById(roleIds[i]!);
    if (i > 0 && i === roleIds.length - 1) {
      segments.push(textSeg(" and "));
    } else if (i > 0) {
      segments.push(textSeg(", "));
    }
    segments.push(
      refSeg(
        roleNames[i]!,
        role?.playerId ?? roleIds[i]!,
      ),
    );
  }

  segments.push(textSeg(" is unique in "));
  segments.push(textSeg(factType.name));
  segments.push(textSeg("."));

  return buildVerbalization(factType.id, "constraint", segments);
}

/**
 * "Each {Subject} {predicate} at least one {Object}."
 */
export function verbalizeMandatory(
  roleId: string,
  factType: FactType,
  model: OrmModel,
): Verbalization {
  if (factType.arity === 2) {
    return verbalizeBinaryMandatory(roleId, factType, model);
  }

  const role = factType.getRoleById(roleId);
  const ot = role ? model.getObjectType(role.playerId) : undefined;
  const name = ot?.name ?? role?.name ?? roleId;
  const reading = factType.readings[0]?.template ?? "";
  const expanded = reading.replace(/\{\d+\}/g, name);

  return buildVerbalization(factType.id, "constraint", [
    kwSeg("Each "),
    refSeg(name, role?.playerId ?? roleId),
    textSeg(" must: "),
    textSeg(expanded),
    textSeg("."),
  ]);
}

export function verbalizeBinaryMandatory(
  roleId: string,
  factType: FactType,
  model: OrmModel,
): Verbalization {
  const mandatoryIdx = factType.roles.findIndex(
    (r) => r.id === roleId,
  );
  const otherIdx = mandatoryIdx === 0 ? 1 : 0;

  const subjectRole = factType.roles[mandatoryIdx]!;
  const objectRole = factType.roles[otherIdx]!;
  const subjectType = model.getObjectType(subjectRole.playerId);
  const objectType = model.getObjectType(objectRole.playerId);
  const subjectName = subjectType?.name ?? subjectRole.name;
  const objectName = objectType?.name ?? objectRole.name;

  const predicate = extractPredicate(
    factType,
    mandatoryIdx,
    otherIdx,
  );

  const segments: VerbalizationSegment[] = [
    kwSeg("Each "),
    refSeg(subjectName, subjectRole.playerId),
    textSeg(" " + predicate + " "),
    kwSeg("at least one "),
    refSeg(objectName, objectRole.playerId),
    textSeg("."),
  ];

  return buildVerbalization(factType.id, "constraint", segments);
}

/**
 * "The possible values of {TypeName} are: {'v1', 'v2', ...}."
 */
/**
 * Render a value range as a natural-language phrase, e.g. "between 1 and 10",
 * "at least 18", or "less than 100".
 */
function describeValueRange(r: ValueRange): string {
  const minIncl = r.minInclusive !== false;
  const maxIncl = r.maxInclusive !== false;
  const lower = minIncl ? `at least ${r.min}` : `greater than ${r.min}`;
  const upper = maxIncl ? `at most ${r.max}` : `less than ${r.max}`;

  if (r.min !== undefined && r.max !== undefined) {
    return minIncl && maxIncl
      ? `between ${r.min} and ${r.max}`
      : `${lower} and ${upper}`;
  }
  if (r.min !== undefined) return lower;
  if (r.max !== undefined) return upper;
  return "any value";
}

export function verbalizeValueConstraint(
  roleId: string | undefined,
  values: readonly string[],
  ranges: readonly ValueRange[] | undefined,
  factType: FactType,
  model: OrmModel,
): Verbalization {
  let targetName: string;
  let targetId: string;

  if (roleId) {
    const role = factType.getRoleById(roleId);
    const ot = role ? model.getObjectType(role.playerId) : undefined;
    targetName = ot?.name ?? role?.name ?? roleId;
    targetId = role?.playerId ?? roleId;
  } else {
    targetName = factType.name;
    targetId = factType.id;
  }

  const valueList = [
    ...values.map((v) => `'${v}'`),
    ...(ranges ?? []).map((r) => describeValueRange(r)),
  ].join(", ");

  const segments: VerbalizationSegment[] = [
    textSeg("The possible values of "),
    refSeg(targetName, targetId),
    textSeg(" are: {"),
    valSeg(valueList),
    textSeg("}."),
  ];

  return buildVerbalization(factType.id, "constraint", segments);
}

/**
 * "The combination of {roles...} is unique across fact types."
 */
export function verbalizeExternalUniqueness(
  roleIds: readonly string[],
  factType: FactType,
  model: OrmModel,
): Verbalization {
  const segments: VerbalizationSegment[] = [
    textSeg("The combination of "),
  ];

  for (let i = 0; i < roleIds.length; i++) {
    // External uniqueness spans fact types, so resolve each role
    // model-wide rather than against the owner fact type alone.
    const role = model.findRole(roleIds[i]!);
    const ot = role ? model.getObjectType(role.playerId) : undefined;
    const name = ot?.name ?? role?.name ?? roleIds[i]!;

    if (i > 0 && i === roleIds.length - 1) {
      segments.push(textSeg(" and "));
    } else if (i > 0) {
      segments.push(textSeg(", "));
    }
    segments.push(refSeg(name, role?.playerId ?? roleIds[i]!));
  }

  segments.push(textSeg(" is unique across fact types."));

  return buildVerbalization(factType.id, "constraint", segments);
}
