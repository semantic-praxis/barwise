import type { Constraint } from "../model/Constraint.js";
import type { FactType } from "../model/FactType.js";
import type { OrmModel } from "../model/OrmModel.js";
import type { Role } from "../model/Role.js";
import {
  buildVerbalization,
  kwSeg,
  refSeg,
  textSeg,
  valSeg,
  type Verbalization,
  type VerbalizationSegment,
} from "./Verbalization.js";

/**
 * Verbalizes ORM constraints using FORML sentence patterns.
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
        return this.verbalizeInternalUniqueness(
          constraint.roleIds,
          factType,
          model,
        );
      case "mandatory":
        return this.verbalizeMandatory(
          constraint.roleId,
          factType,
          model,
        );
      case "value_constraint":
        return this.verbalizeValueConstraint(
          constraint.roleId,
          constraint.values,
          factType,
          model,
        );
      case "external_uniqueness":
        return this.verbalizeExternalUniqueness(
          constraint.roleIds,
          factType,
          model,
        );
      case "disjunctive_mandatory":
        return this.verbalizeDisjunctiveMandatory(
          constraint.roleIds,
          factType,
          model,
        );
      case "exclusion":
        return this.verbalizeExclusion(
          constraint.roleIds,
          factType,
          model,
        );
      case "exclusive_or":
        return this.verbalizeExclusiveOr(
          constraint.roleIds,
          factType,
          model,
        );
      case "subset":
        return this.verbalizeSubset(
          constraint.subsetRoleIds,
          constraint.supersetRoleIds,
          factType,
          model,
        );
      case "equality":
        return this.verbalizeEquality(
          constraint.roleIds1,
          constraint.roleIds2,
          factType,
          model,
        );
      case "ring":
        return this.verbalizeRing(
          constraint.roleId1,
          constraint.roleId2,
          constraint.ringType,
          factType,
          model,
        );
      case "frequency":
        return this.verbalizeFrequency(
          constraint.roleId,
          constraint.min,
          constraint.max,
          factType,
          model,
        );
    }
  }

  // -------------------------------------------------------------------
  // Phase 1 constraint verbalizations
  // -------------------------------------------------------------------

  private verbalizeInternalUniqueness(
    roleIds: readonly string[],
    factType: FactType,
    model: OrmModel,
  ): Verbalization {
    if (factType.arity === 2 && roleIds.length === 1) {
      return this.verbalizeBinaryUniqueness(
        roleIds[0]!,
        factType,
        model,
      );
    }

    if (factType.arity > 2 && roleIds.length < factType.arity) {
      return this.verbalizeMultiRoleUniqueness(
        roleIds,
        factType,
        model,
      );
    }

    return this.verbalizeGenericUniqueness(roleIds, factType, model);
  }

  /**
   * "Each {Subject} {predicate} at most one {Object}."
   */
  private verbalizeBinaryUniqueness(
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
  private verbalizeMultiRoleUniqueness(
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
  private verbalizeGenericUniqueness(
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
  private verbalizeMandatory(
    roleId: string,
    factType: FactType,
    model: OrmModel,
  ): Verbalization {
    if (factType.arity === 2) {
      return this.verbalizeBinaryMandatory(roleId, factType, model);
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

  private verbalizeBinaryMandatory(
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
  private verbalizeValueConstraint(
    roleId: string | undefined,
    values: readonly string[],
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

    const valueList = values.map((v) => `'${v}'`).join(", ");

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
  private verbalizeExternalUniqueness(
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
      const role = this.findRole(roleIds[i]!, factType, model);
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

  // -------------------------------------------------------------------
  // Phase 2 constraint verbalizations
  // -------------------------------------------------------------------

  /**
   * "Each {Subject} {pred1} some {Obj1} or {pred2} some {Obj2}."
   */
  private verbalizeDisjunctiveMandatory(
    roleIds: readonly string[],
    factType: FactType,
    model: OrmModel,
  ): Verbalization {
    const segments: VerbalizationSegment[] = [kwSeg("Each ")];
    const commonPlayer = this.resolveCommonPlayer(roleIds, factType, model);
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
  private verbalizeExclusion(
    roleIds: readonly string[],
    factType: FactType,
    model: OrmModel,
  ): Verbalization {
    const segments: VerbalizationSegment[] = [kwSeg("No ")];
    const commonPlayer = this.resolveCommonPlayer(roleIds, factType, model);
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
  private verbalizeExclusiveOr(
    roleIds: readonly string[],
    factType: FactType,
    model: OrmModel,
  ): Verbalization {
    const segments: VerbalizationSegment[] = [kwSeg("Each ")];
    const commonPlayer = this.resolveCommonPlayer(roleIds, factType, model);
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
  private verbalizeSubset(
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
  private verbalizeEquality(
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
  private verbalizeRing(
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
  private verbalizeFrequency(
    roleId: string,
    min: number,
    max: number | "unbounded",
    factType: FactType,
    model: OrmModel,
  ): Verbalization {
    if (factType.arity !== 2) {
      return this.verbalizeGenericFrequency(roleId, min, max, factType, model);
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

  private verbalizeGenericFrequency(
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

  /**
   * Find a role by id model-wide: the owner fact type first, then any
   * other fact type. External uniqueness names roles across fact types,
   * so the owner-only `getRoleById` is not enough.
   */
  private findRole(
    roleId: string,
    factType: FactType,
    model: OrmModel,
  ): Role | undefined {
    const local = factType.getRoleById(roleId);
    if (local) return local;
    for (const ft of model.factTypes) {
      const role = ft.getRoleById(roleId);
      if (role) return role;
    }
    return undefined;
  }

  private resolveCommonPlayer(
    roleIds: readonly string[],
    factType: FactType,
    model: OrmModel,
  ): { name: string; id: string; } {
    for (const rid of roleIds) {
      const role = factType.getRoleById(rid);
      if (role) {
        const ot = model.getObjectType(role.playerId);
        if (ot) return { name: ot.name, id: ot.id };
        return { name: role.name, id: role.playerId };
      }
    }
    return { name: "Object", id: "" };
  }
}

/**
 * Extract the predicate text from a reading template for a binary
 * fact type, given a subject role index and an object role index.
 */
function extractPredicate(
  factType: FactType,
  subjectIdx: number,
  objectIdx: number,
): string {
  const subjectPlaceholder = `{${subjectIdx}}`;
  const objectPlaceholder = `{${objectIdx}}`;

  for (const reading of factType.readings) {
    const t = reading.template;
    const subjectPos = t.indexOf(subjectPlaceholder);
    const objectPos = t.indexOf(objectPlaceholder);
    if (
      subjectPos >= 0
      && objectPos >= 0
      && subjectPos < objectPos
    ) {
      const start = subjectPos + subjectPlaceholder.length;
      return t.slice(start, objectPos).trim();
    }
  }

  const t = factType.readings[0]?.template ?? "";
  const p0 = t.indexOf("{");
  const p1 = t.indexOf("{", p0 + 1);
  if (p0 >= 0 && p1 >= 0) {
    const end0 = t.indexOf("}", p0) + 1;
    return t.slice(end0, p1).trim();
  }

  return "...";
}
