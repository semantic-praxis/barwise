/**
 * FORML sentence parts for constraint verbalization: the subject entity
 * a multi-role constraint is about (resolveCommonPlayer) and the predicate
 * phrase between two roles of a binary reading (extractPredicate).
 */
import type { FactType } from "../../model/FactType.js";
import type { OrmModel } from "../../model/OrmModel.js";
import type { Role } from "../../model/Role.js";

/**
 * The role a local-role constraint names, which `ConstraintVerbalizer`
 * has already established belongs to this fact type.
 *
 * Not a fallback. The kinds this serves are the ones
 * `requiresLocalRoles` marks -- uniqueness, mandatory, value, ring,
 * frequency, cardinality, value comparison -- and the dispatcher answers
 * a non-local role with a malformed-constraint sentence before reaching
 * them (barwise-979). So a miss is a caller that bypassed the
 * dispatcher: a programming error, not a model defect. It says so where
 * the mistake is, rather than phrasing a sentence around an id and
 * letting a reader believe it.
 *
 * The spanning kinds -- exclusion, subset, equality, exclusive-or,
 * disjunctive mandatory, external uniqueness -- must NOT use this. A
 * non-local role is correct for them, and their `?? roleId` fallbacks
 * stay for that reason.
 */
export function localRole(factType: FactType, roleId: string): Role {
  const role = factType.getRoleById(roleId);
  if (!role) {
    throw new Error(
      `verbalization: role "${roleId}" is not a role of fact type "${factType.name}". `
        + `Constraint kinds that require local roles are screened by `
        + `ConstraintVerbalizer.verbalize; this helper was reached another way.`,
    );
  }
  return role;
}

export function resolveCommonPlayer(
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

/**
 * Extract the predicate text from a reading template for a binary
 * fact type, given a subject role index and an object role index.
 */
export function extractPredicate(
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
