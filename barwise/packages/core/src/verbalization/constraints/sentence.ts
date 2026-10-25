/**
 * FORML sentence parts for constraint verbalization: the subject entity
 * a multi-role constraint is about (resolveCommonPlayer) and the predicate
 * phrase between two roles of a binary reading (extractPredicate).
 */
import type { FactType } from "../../model/FactType.js";
import type { OrmModel } from "../../model/OrmModel.js";
import { type ReadingPart, splitReading } from "../../model/ReadingOrder.js";
import type { Role } from "../../model/Role.js";
import { textSeg, type VerbalizationSegment } from "../Verbalization.js";

/**
 * The role a local-role constraint names, which `ConstraintVerbalizer`
 * has already established belongs to this fact type.
 *
 * Not a fallback. The kinds this serves are the internal ones
 * (`isInternalConstraint`) -- uniqueness, mandatory, value, ring,
 * frequency, cardinality, value comparison -- and the dispatcher's
 * internal path answers a non-local role with a malformed-constraint
 * sentence before reaching them (barwise-979). So a miss is a caller that bypassed the
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
  model: OrmModel,
): { name: string; id: string; } {
  // Model-wide: the roles of a constraint across fact types belong to
  // several fact types, and none of them is the constraint's own
  // (orm-format-3, placement by kind).
  for (const rid of roleIds) {
    const role = model.findRole(rid);
    if (role) {
      const ot = model.getObjectType(role.playerId);
      if (ot) return { name: ot.name, id: ot.id };
      return { name: role.name, id: role.playerId };
    }
  }
  return { name: "Object", id: "" };
}

/**
 * A binary reading's predicate between a subject and an object role, and
 * the words hyphen-bound to each role's player (reading-hyphen-binding.spec.md).
 * A sentence builder places each lead immediately before its own player's
 * name, after any quantifier or determiner: "Each Listing has at most one
 * sale Currency".
 */
export interface Predicate {
  readonly text: string;
  readonly subjectLead: string;
  readonly objectLead: string;
}

/**
 * Extract the predicate of a binary fact type from the reading that names
 * the subject role before the object role. When no reading has that
 * order, the first reading's text between its first two placeholders is
 * used as written, as before, with its binding hyphens removed and no
 * leads: a lead there belongs to whichever noun the reading put after it,
 * which is not the sentence's object.
 */
export function extractPredicate(
  factType: FactType,
  subjectIdx: number,
  objectIdx: number,
): Predicate {
  for (const reading of factType.readings) {
    const roles = splitReading(reading.template).parts;
    const s = roles.findIndex((p) => p.kind === "role" && p.index === subjectIdx);
    const o = roles.findIndex((p) => p.kind === "role" && p.index === objectIdx);
    if (s >= 0 && o > s) {
      const between = roles.slice(s + 1, o).map((p) => p.kind === "text" ? p.text : "").join("");
      return {
        text: between.trim(),
        subjectLead: leadOf(roles[s]!),
        objectLead: leadOf(roles[o]!),
      };
    }
  }

  const first = factType.readings[0];
  if (first) {
    const parts = splitReading(first.template).parts;
    const placeholders = parts.flatMap((p, i) => p.kind === "role" ? [i] : []);
    if (placeholders.length >= 2) {
      const [a, b] = placeholders as [number, number];
      const text = parts.slice(a + 1, b).map((p) => p.kind === "text" ? p.text : "").join("");
      return {
        text: `${text.trim()} ${leadOf(parts[b]!)}`.trim(),
        subjectLead: "",
        objectLead: "",
      };
    }
  }

  return { text: "...", subjectLead: "", objectLead: "" };
}

function leadOf(part: ReadingPart): string {
  return part.kind === "role" ? part.lead : "";
}

/** A lead as the segment that goes before its player's name, or none. */
export function leadSegs(lead: string): VerbalizationSegment[] {
  return lead ? [textSeg(lead + " ")] : [];
}
