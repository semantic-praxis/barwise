/**
 * Phase 2 constraint verbalizations: disjunctive mandatory, exclusion,
 * exclusive-or, subset, equality, ring, and frequency.
 */
import type { FactType } from "../../model/FactType.js";
import type { OrmModel } from "../../model/OrmModel.js";
import {
  buildVerbalization,
  kwSeg,
  refSeg,
  textSeg,
  type Verbalization,
  type VerbalizationSegment,
} from "../Verbalization.js";
import { extractPredicate, resolveCommonPlayer } from "./sentence.js";

export function verbalizeDisjunctiveMandatory(
  roleIds: readonly string[],
  factType: FactType,
  model: OrmModel,
): Verbalization {
  const segments: VerbalizationSegment[] = [kwSeg("Each ")];
  const commonPlayer = resolveCommonPlayer(roleIds, factType, model);
  segments.push(refSeg(commonPlayer.name, commonPlayer.id));

  for (let i = 0; i < roleIds.length; i++) {
    const role = factType.getRoleById(roleIds[i]!);
    const ot = role ? model.getObjectType(role.playerId) : undefined;
    const roleName = role?.name ?? roleIds[i]!;
    const otName = ot?.name ?? roleName;

    if (i > 0 && i === roleIds.length - 1) {
      segments.push(textSeg(" or "));
    } else if (i > 0) {
      segments.push(textSeg(", "));
    } else {
      segments.push(textSeg(" "));
    }
    segments.push(textSeg(roleName + " some "));
    segments.push(refSeg(otName, role?.playerId ?? roleIds[i]!));
  }

  segments.push(textSeg("."));
  return buildVerbalization(factType.id, "constraint", segments);
}

/**
 * "No {Subject} both {pred1} some {Obj1} and {pred2} some {Obj2}."
 */
export function verbalizeExclusion(
  roleIds: readonly string[],
  factType: FactType,
  model: OrmModel,
): Verbalization {
  const segments: VerbalizationSegment[] = [kwSeg("No ")];
  const commonPlayer = resolveCommonPlayer(roleIds, factType, model);
  segments.push(refSeg(commonPlayer.name, commonPlayer.id));
  segments.push(textSeg(" both "));

  for (let i = 0; i < roleIds.length; i++) {
    const role = factType.getRoleById(roleIds[i]!);
    const ot = role ? model.getObjectType(role.playerId) : undefined;
    const roleName = role?.name ?? roleIds[i]!;
    const otName = ot?.name ?? roleName;

    if (i > 0 && i === roleIds.length - 1) {
      segments.push(textSeg(" and "));
    } else if (i > 0) {
      segments.push(textSeg(", "));
    }
    segments.push(textSeg(roleName + " some "));
    segments.push(refSeg(otName, role?.playerId ?? roleIds[i]!));
  }

  segments.push(textSeg("."));
  return buildVerbalization(factType.id, "constraint", segments);
}

/**
 * "Each {Subject} either {pred1} some {Obj1} or {pred2} some {Obj2} but not both."
 */
export function verbalizeExclusiveOr(
  roleIds: readonly string[],
  factType: FactType,
  model: OrmModel,
): Verbalization {
  const segments: VerbalizationSegment[] = [kwSeg("Each ")];
  const commonPlayer = resolveCommonPlayer(roleIds, factType, model);
  segments.push(refSeg(commonPlayer.name, commonPlayer.id));
  segments.push(textSeg(" either "));

  for (let i = 0; i < roleIds.length; i++) {
    const role = factType.getRoleById(roleIds[i]!);
    const ot = role ? model.getObjectType(role.playerId) : undefined;
    const roleName = role?.name ?? roleIds[i]!;
    const otName = ot?.name ?? roleName;

    if (i > 0 && i === roleIds.length - 1) {
      segments.push(textSeg(" or "));
    } else if (i > 0) {
      segments.push(textSeg(", "));
    }
    segments.push(textSeg(roleName + " some "));
    segments.push(refSeg(otName, role?.playerId ?? roleIds[i]!));
  }

  segments.push(kwSeg(" but not both"));
  segments.push(textSeg("."));
  return buildVerbalization(factType.id, "constraint", segments);
}

/**
 * "If {roles...} then {roles...}."
 */
export function verbalizeSubset(
  subsetRoleIds: readonly string[],
  supersetRoleIds: readonly string[],
  factType: FactType,
  model: OrmModel,
): Verbalization {
  const segments: VerbalizationSegment[] = [kwSeg("If ")];

  for (let i = 0; i < subsetRoleIds.length; i++) {
    const role = factType.getRoleById(subsetRoleIds[i]!);
    const ot = role ? model.getObjectType(role.playerId) : undefined;
    const name = ot?.name ?? role?.name ?? subsetRoleIds[i]!;
    if (i > 0) segments.push(textSeg(" "));
    segments.push(refSeg(name, role?.playerId ?? subsetRoleIds[i]!));
  }

  segments.push(kwSeg(" then "));

  for (let i = 0; i < supersetRoleIds.length; i++) {
    const role = factType.getRoleById(supersetRoleIds[i]!);
    const ot = role ? model.getObjectType(role.playerId) : undefined;
    const name = ot?.name ?? role?.name ?? supersetRoleIds[i]!;
    if (i > 0) segments.push(textSeg(" "));
    segments.push(refSeg(name, role?.playerId ?? supersetRoleIds[i]!));
  }

  segments.push(textSeg("."));
  return buildVerbalization(factType.id, "constraint", segments);
}

/**
 * "{roles...} if and only if {roles...}."
 */
export function verbalizeEquality(
  roleIds1: readonly string[],
  roleIds2: readonly string[],
  factType: FactType,
  model: OrmModel,
): Verbalization {
  const segments: VerbalizationSegment[] = [];

  for (let i = 0; i < roleIds1.length; i++) {
    const role = factType.getRoleById(roleIds1[i]!);
    const ot = role ? model.getObjectType(role.playerId) : undefined;
    const name = ot?.name ?? role?.name ?? roleIds1[i]!;
    if (i > 0) segments.push(textSeg(" "));
    segments.push(refSeg(name, role?.playerId ?? roleIds1[i]!));
  }

  segments.push(kwSeg(" if and only if "));

  for (let i = 0; i < roleIds2.length; i++) {
    const role = factType.getRoleById(roleIds2[i]!);
    const ot = role ? model.getObjectType(role.playerId) : undefined;
    const name = ot?.name ?? role?.name ?? roleIds2[i]!;
    if (i > 0) segments.push(textSeg(" "));
    segments.push(refSeg(name, role?.playerId ?? roleIds2[i]!));
  }

  segments.push(textSeg("."));
  return buildVerbalization(factType.id, "constraint", segments);
}

/**
 * Ring constraint verbalization, varies by ring type.
 */
export function verbalizeRing(
  roleId1: string,
  roleId2: string,
  ringType: string,
  factType: FactType,
  model: OrmModel,
): Verbalization {
  const role1 = factType.getRoleById(roleId1);
  const ot = role1 ? model.getObjectType(role1.playerId) : undefined;
  const typeName = ot?.name ?? role1?.name ?? roleId1;
  const typeId = role1?.playerId ?? roleId1;

  const predicate = factType.arity === 2
    ? extractPredicate(factType, 0, 1)
    : "...";

  const ringLabel = ringType.replace(/_/g, " ");

  switch (ringType) {
    case "irreflexive": {
      const segments: VerbalizationSegment[] = [
        kwSeg("No "),
        refSeg(typeName, typeId),
        textSeg(" " + predicate + " that same "),
        refSeg(typeName, typeId),
        textSeg("."),
      ];
      return buildVerbalization(factType.id, "constraint", segments);
    }
    case "asymmetric": {
      const segments: VerbalizationSegment[] = [
        kwSeg("If "),
        refSeg(typeName + "1", typeId),
        textSeg(" " + predicate + " "),
        refSeg(typeName + "2", typeId),
        kwSeg(" then "),
        refSeg(typeName + "2", typeId),
        textSeg(" does not " + predicate + " "),
        refSeg(typeName + "1", typeId),
        textSeg("."),
      ];
      return buildVerbalization(factType.id, "constraint", segments);
    }
    default: {
      const segments: VerbalizationSegment[] = [
        textSeg(ringLabel.charAt(0).toUpperCase() + ringLabel.slice(1) + ": "),
        refSeg(typeName, typeId),
        textSeg(" " + predicate + " "),
        refSeg(typeName, typeId),
        textSeg("."),
      ];
      return buildVerbalization(factType.id, "constraint", segments);
    }
  }
}

/**
 * "Each {Subject} {pred} at least {min} and at most {max} {Object}."
 */
export function verbalizeFrequency(
  roleId: string,
  min: number,
  max: number | "unbounded",
  factType: FactType,
  model: OrmModel,
): Verbalization {
  if (factType.arity !== 2) {
    return verbalizeGenericFrequency(roleId, min, max, factType, model);
  }

  const roleIdx = factType.roles.findIndex((r) => r.id === roleId);
  const otherIdx = roleIdx === 0 ? 1 : 0;

  const subjectRole = factType.roles[roleIdx]!;
  const objectRole = factType.roles[otherIdx]!;
  const subjectType = model.getObjectType(subjectRole.playerId);
  const objectType = model.getObjectType(objectRole.playerId);
  const subjectName = subjectType?.name ?? subjectRole.name;
  const objectName = objectType?.name ?? objectRole.name;

  const predicate = extractPredicate(factType, roleIdx, otherIdx);

  const segments: VerbalizationSegment[] = [
    kwSeg("Each "),
    refSeg(subjectName, subjectRole.playerId),
    textSeg(" " + predicate + " "),
  ];

  if (max === "unbounded") {
    segments.push(kwSeg(`at least ${min} `));
  } else if (min === max) {
    segments.push(kwSeg(`exactly ${min} `));
  } else {
    segments.push(kwSeg(`at least ${min} and at most ${max} `));
  }

  segments.push(refSeg(objectName, objectRole.playerId));
  segments.push(textSeg("."));

  return buildVerbalization(factType.id, "constraint", segments);
}

export function verbalizeGenericFrequency(
  roleId: string,
  min: number,
  max: number | "unbounded",
  factType: FactType,
  model: OrmModel,
): Verbalization {
  const role = factType.getRoleById(roleId);
  const ot = role ? model.getObjectType(role.playerId) : undefined;
  const name = ot?.name ?? role?.name ?? roleId;

  let quantifier: string;
  if (max === "unbounded") {
    quantifier = `at least ${min} times`;
  } else if (min === max) {
    quantifier = `exactly ${min} times`;
  } else {
    quantifier = `at least ${min} and at most ${max} times`;
  }

  return buildVerbalization(factType.id, "constraint", [
    kwSeg("Each "),
    refSeg(name, role?.playerId ?? roleId),
    textSeg(` participates ${quantifier} in `),
    textSeg(factType.name),
    textSeg("."),
  ]);
}

const VALUE_COMPARISON_PHRASES: Record<string, string> = {
  "<": "less than",
  "<=": "less than or equal to",
  "=": "equal to",
  "<>": "not equal to",
  ">=": "greater than or equal to",
  ">": "greater than",
};

export function verbalizeValueComparison(
  roleId1: string,
  roleId2: string,
  operator: string,
  factType: FactType,
  model: OrmModel,
): Verbalization {
  const role1 = factType.getRoleById(roleId1);
  const role2 = factType.getRoleById(roleId2);
  const ot1 = role1 ? model.getObjectType(role1.playerId) : undefined;
  const ot2 = role2 ? model.getObjectType(role2.playerId) : undefined;
  const name1 = ot1?.name ?? role1?.name ?? roleId1;
  const name2 = ot2?.name ?? role2?.name ?? roleId2;
  const phrase = VALUE_COMPARISON_PHRASES[operator] ?? operator;

  return buildVerbalization(factType.id, "constraint", [
    refSeg(name1, role1?.playerId ?? roleId1),
    textSeg(` must be ${phrase} `),
    refSeg(name2, role2?.playerId ?? roleId2),
    textSeg("."),
  ]);
}

/**
 * Find a role by id model-wide: the owner fact type first, then any
 * other fact type. External uniqueness names roles across fact types,
 * so the owner-only `getRoleById` is not enough.
 */
