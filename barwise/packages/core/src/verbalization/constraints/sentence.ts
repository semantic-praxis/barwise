/**
 * FORML sentence parts for constraint verbalization: the subject entity
 * a multi-role constraint is about (resolveCommonPlayer), a reading's parts
 * as quantified segments (quantifiedReading, forEachReading), and the
 * clause of a ring sentence (ringReading, ringClause).
 */
import type { FactType } from "../../model/FactType.js";
import type { OrmModel } from "../../model/OrmModel.js";
import { leadOf, type ReadingPart, splitReading } from "../../model/ReadingOrder.js";
import type { Role } from "../../model/Role.js";
import { kwSeg, refSeg, textSeg, type VerbalizationSegment } from "../Verbalization.js";

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
 * A binary reading as a ring sentence's clause: the subject's lead, and the
 * reading's parts after the subject placeholder, rendered by `ringClause`
 * so text after the object stays ("{0} specializes {1} as supertype"),
 * which slicing between the placeholders dropped (barwise-7tx). Text
 * before the subject is dropped, as "No" or "If" takes its place.
 */
export interface RingReading {
  readonly subjectIndex: number;
  readonly subjectLead: string;
  readonly rest: readonly ReadingPart[];
}

/**
 * The ring reading of a binary fact type: the first reading that names the
 * subject role before the object role. When none does, the first reading
 * is taken by placeholder position, its first placeholder the subject.
 * That reads the fact backwards, which the ring sentence is unchanged by;
 * each lead stays with the name in its own slot.
 */
export function ringReading(
  factType: FactType,
  subjectIdx: number,
  objectIdx: number,
): RingReading {
  if (factType.arity !== 2) return UNKNOWN_RING_READING;
  const readings = factType.readings.map((r) => splitReading(r.template).parts);
  for (const parts of readings) {
    const s = parts.findIndex((p) => p.kind === "role" && p.index === subjectIdx);
    const o = parts.findIndex((p) => p.kind === "role" && p.index === objectIdx);
    if (s >= 0 && o > s) {
      return {
        subjectIndex: subjectIdx,
        subjectLead: leadOf(parts[s]),
        rest: parts.slice(s + 1),
      };
    }
  }
  const first = readings[0];
  const a = first?.findIndex((p) => p.kind === "role") ?? -1;
  const opener = first?.[a];
  if (opener?.kind === "role" && first!.slice(a + 1).some((p) => p.kind === "role")) {
    return { subjectIndex: opener.index, subjectLead: opener.lead, rest: first!.slice(a + 1) };
  }
  return UNKNOWN_RING_READING;
}

/** The clause of a reading barwise cannot read one from. */
const UNKNOWN_RING_READING: RingReading = {
  subjectIndex: 0,
  subjectLead: "",
  rest: [{ kind: "text", text: " ... " }, { kind: "role", index: 1, lead: "" }],
};

/**
 * "{subject} [does not] <the reading's rest>", the subject's placeholder
 * written `subject` wherever it recurs and the other `object` after
 * `determiner`. A word is spaced from a placeholder; punctuation the
 * reading put flush against one is not ("{1}'s deputy"). The reading's
 * closing whitespace and period are dropped, as the sentence ends itself.
 */
export function ringClause(
  reading: RingReading,
  subject: VerbalizationSegment,
  object: VerbalizationSegment,
  options: { readonly negated?: boolean; readonly determiner?: string; } = {},
): VerbalizationSegment[] {
  const segments: VerbalizationSegment[] = [...leadSegs(reading.subjectLead), subject];
  if (options.negated) segments.push(textSeg(" does not"));
  const endsInSpace = () => /\s$/.test(segments[segments.length - 1]?.text ?? " ");
  const last = reading.rest.length - 1;
  reading.rest.forEach((part, i) => {
    if (part.kind === "role") {
      if (!endsInSpace()) segments.push(textSeg(" "));
      const own = part.index === reading.subjectIndex;
      if (!own && options.determiner) segments.push(textSeg(options.determiner));
      segments.push(...leadSegs(part.lead), own ? subject : object);
      return;
    }
    let text = i === last ? part.text.trimEnd().replace(/\.$/, "").trimEnd() : part.text;
    // One space at most between a name and the text after it, however many
    // the reading wrote.
    if (endsInSpace()) text = text.trimStart();
    else if (/^\s/.test(text)) text = " " + text.trimStart();
    else if (/^[\p{L}\p{N}]/u.test(text)) text = " " + text;
    if (text) segments.push(textSeg(text));
  });
  return segments;
}

/**
 * The first reading of a fact type that opens with role `index`'s
 * placeholder -- nothing before it but whitespace, or its hyphen-bound
 * lead -- as that placeholder's lead and the parts after it. A reading
 * that opens with the role is the modeller's own phrasing of a sentence
 * about that role's player, so the sentences that need one prefer it.
 */
export function openingReading(
  factType: FactType,
  index: number,
): { readonly lead: string; readonly rest: readonly ReadingPart[]; } | undefined {
  for (const reading of factType.readings) {
    const parts = splitReading(reading.template).parts;
    const first = parts.findIndex((p) => p.kind === "role");
    const opener = parts[first];
    const clear = parts.slice(0, first).every((p) => p.kind === "text" && p.text.trim() === "");
    if (opener?.kind === "role" && opener.index === index && clear) {
      return { lead: opener.lead, rest: parts.slice(first + 1) };
    }
  }
  return undefined;
}

/**
 * "Each X <rest>" for role `own`'s player X, from the first reading whose
 * first placeholder is that role: the forward sentence of a binary
 * mandatory, uniqueness or frequency (binary-constraint-sentences.spec.md).
 * Text before the placeholder is dropped, as "Each" takes its place ("the
 * {0} has {1}" is "Each Order has ..."); everything after it stays, which
 * slicing between the placeholders did not (barwise-m1c). `rest` renders
 * the parts after the placeholder, so a frequency can render them twice.
 * Undefined when no reading names the role first.
 */
export function eachReading(
  model: OrmModel,
  factType: FactType,
  own: number,
  rest: (parts: readonly ReadingPart[]) => VerbalizationSegment[],
): VerbalizationSegment[] | undefined {
  for (const reading of factType.readings) {
    const parts = splitReading(reading.template).parts;
    const first = parts.findIndex((p) => p.kind === "role");
    const opener = parts[first];
    if (opener?.kind !== "role" || opener.index !== own) continue;
    const after = rest(parts.slice(first + 1));
    // No space before punctuation the reading put flush against the
    // placeholder ("{0}'s {1}").
    const head = after[0]?.text ?? "";
    return [
      kwSeg("Each "),
      ...leadSegs(opener.lead),
      rolePlayer(model, factType, own),
      ...(/^[\p{L}\p{N}]/u.test(head) ? [textSeg(" ")] : []),
      ...after,
      textSeg("."),
    ];
  }
  return undefined;
}

/** Role `index`'s player as a reference: its object type's name, else the role's. */
export function rolePlayer(
  model: OrmModel,
  factType: FactType,
  index: number,
): VerbalizationSegment {
  // `validateReadingTemplate` refuses a placeholder with no role, so every
  // index a reading names has one.
  const role = factType.roles[index]!;
  return refSeg(model.getObjectType(role.playerId)?.name ?? role.name, role.playerId);
}

/**
 * Reading parts as segments, with role `own`'s placeholder written "that
 * X" -- the sentence has already named X -- and every other placeholder
 * "some Y" (or `others`, as "at most one Y"), each after its hyphen-bound
 * lead: "works on some Project in some Department", "some Customer ...
 * signs that Agreement". A placeholder a reading repeats is "that Y" after
 * its first mention, since `validateReadingTemplate` accepts a repeat and
 * a second quantifier would introduce a second Y.
 *
 * `validateReadingTemplate` accepts a placeholder written flush against a
 * word ("works on{1}in") or another placeholder, so the space the reading
 * left out is supplied here rather than rendering "works onsome Projectin".
 * Whitespace at either end of the reading is dropped, since the caller
 * writes what goes before and after it.
 */
export function quantifiedReading(
  model: OrmModel,
  factType: FactType,
  parts: readonly ReadingPart[],
  own: number,
  others = "some ",
  player: (index: number) => VerbalizationSegment = (index) => rolePlayer(model, factType, index),
): VerbalizationSegment[] {
  const segments: VerbalizationSegment[] = [];
  const named = new Set<number>([own]);
  const last = parts.length - 1;
  parts.forEach((part, i) => {
    if (part.kind === "role") {
      if (parts[i - 1]?.kind === "role") segments.push(textSeg(" "));
      segments.push(
        kwSeg(named.has(part.index) ? "that " : others),
        ...leadSegs(part.lead),
        player(part.index),
      );
      named.add(part.index);
      return;
    }
    let text = i === 0 ? part.text.trimStart() : part.text;
    if (i === last) text = text.trimEnd();
    if (i > 0 && /^[\p{L}\p{N}]/u.test(text)) text = " " + text;
    if (i < last && text && !/\s$/.test(text)) text += " ";
    if (text) segments.push(textSeg(text));
  });
  return segments;
}

/**
 * "For each X, <the first reading, quantified>." for role `own`'s player
 * X, with `others` quantifying every other role: the sentence for a role
 * no reading opens with. A non-binary mandatory writes it
 * (nary-mandatory-verbalization.spec.md), and so does a binary constraint
 * on the role no reading names first
 * (binary-reverse-reading-verbalization.spec.md, barwise-wsl): "For each
 * Customer, some Order is placed by that Customer." -- the reading as the
 * modeller wrote it, where slicing its predicate would read it backwards
 * ("Each Customer is placed by at least one Order").
 *
 * With `counted`, the frequency sentence for such a role: "For each
 * Customer, if some Order is placed by that Customer, then that holds for
 * exactly 2 instances of Order." -- conditional, because a frequency
 * constrains only the X that play the role, and counted with "that holds
 * for", so the reading's verb need not agree with a plural (barwise-zx2).
 */
export function forEachReading(
  model: OrmModel,
  factType: FactType,
  own: number,
  others: string,
  counted?: { readonly other: number; readonly count: string; },
): VerbalizationSegment[] {
  // The constructor refuses a fact type with no reading.
  const parts = splitReading(factType.readings[0]!.template).parts;
  const lead = (index: number) => {
    const part = parts.find((p) => p.kind === "role" && p.index === index);
    return leadSegs(part?.kind === "role" ? part.lead : "");
  };
  const player = numberedPlayers(model, factType);
  const reading = quantifiedReading(model, factType, parts, own, others, player);
  return [
    kwSeg("For each "),
    ...lead(own),
    player(own),
    ...(counted
      ? [
        kwSeg(", if "),
        ...reading,
        kwSeg(", then that holds for " + counted.count),
        ...lead(counted.other),
        player(counted.other),
      ]
      : [textSeg(", "), ...reading]),
    textSeg("."),
  ];
}

/**
 * Each role's player as a reference, numbered by role position when
 * another role of the fact type has the same player ("Person1",
 * "Person2", as the ring sentence writes them): without the numbers,
 * "For each Person, at most one Person reports to that Person" reads as
 * one person reporting to themself.
 */
function numberedPlayers(
  model: OrmModel,
  factType: FactType,
): (index: number) => VerbalizationSegment {
  return (index) => {
    const role = factType.roles[index]!;
    const shared = factType.roles.some((r, i) => i !== index && r.playerId === role.playerId);
    if (!shared) return rolePlayer(model, factType, index);
    const name = model.getObjectType(role.playerId)?.name ?? role.name;
    return refSeg(`${name}${index + 1}`, role.playerId);
  };
}

/** A lead as the segment that goes before its player's name, or none. */
export function leadSegs(lead: string): VerbalizationSegment[] {
  return lead ? [textSeg(lead + " ")] : [];
}
