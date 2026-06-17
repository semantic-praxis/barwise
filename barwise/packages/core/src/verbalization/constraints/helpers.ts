/**
 * Shared helpers for constraint verbalization: role resolution and
 * binary-reading predicate extraction.
 */
import type { FactType } from "../../model/FactType.js";
import type { OrmModel } from "../../model/OrmModel.js";
import type { Role } from "../../model/Role.js";

export function findRole(
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
