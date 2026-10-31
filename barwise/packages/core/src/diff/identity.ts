import type { FactType } from "../model/FactType.js";
import { isValueType, type ObjectType } from "../model/ObjectType.js";
import type { OrmModel } from "../model/OrmModel.js";
import type { RenameTarget } from "../rename/renameInModel.js";
import { constraintKey, valueConstraintKey } from "./constraintKey.js";

/**
 * Whether the two models' ids say anything about which elements are the
 * same (orm-format-3, Open decision 4 as revised 2026-10-18; model
 * invariants, decision 1 as revised 2026-10-23).
 *
 * - `"id-first"`, the default: a shared id is the same element. An object
 *   type, fact type or constraint whose id both models hold pairs by it,
 *   whatever its name or content, so a rename or an edit that keeps the id
 *   is one modification. The rest pair by name (object types, fact types)
 *   or content key (constraints), which is what keeps a transcript import
 *   working against its base: an LLM draft's ids are fresh, so nothing
 *   pairs by id and everything falls through.
 * - `"content"`: ids say nothing, so nothing pairs by id. For comparing
 *   independent LLM samples, whose ids are unrelated by construction and
 *   may coincide (positional ids such as `ot0`).
 */
export const ELEMENT_MATCHINGS = ["id-first", "content"] as const;
export type ElementMatching = (typeof ELEMENT_MATCHINGS)[number];

/**
 * How a pair of object types or fact types was found (iri-identity 6a):
 * by a shared id, by name, by content when neither held (a rename the
 * diff recognized), or by a rename the caller declared. Merge refuses the
 * last two, because a content pair can be two different elements of one
 * shape (decision 8).
 */
export type PairedBy = "id" | "name" | "recognized" | "declared";

/** One entry of a kind's pairing: both sides, or one. */
export type Paired<T> =
  | { readonly existing: T; readonly incoming: T; readonly pairedBy: PairedBy; }
  | { readonly existing: T; readonly incoming?: undefined; }
  | { readonly existing?: undefined; readonly incoming: T; };

/**
 * A rename the caller states, for an edit that renamed an element and
 * changed what it says at once, which the content pass cannot recognize
 * (decision 8(b)): the existing model's element named by `target` is the
 * incoming model's element named `to`. Roles are not named here: they
 * pair by position within their fact type, so a renamed role is already
 * a change on a paired fact type.
 */
export interface DeclaredRename {
  readonly target: Extract<RenameTarget, { readonly kind: "objectType" | "factType"; }>;
  readonly to: string;
}

/** How {@link diffIdentity} goes beyond ids and names. */
export interface RenameRecognition {
  /** Pair what id and name left by content (decision 8(a)). */
  readonly recognizeRenames: boolean;
  /** Pairs the caller states, applied before the content pass. */
  readonly renames: readonly DeclaredRename[];
}

/** Ids and names only, as every merge path needs. */
export const NO_RENAME_RECOGNITION: RenameRecognition = { recognizeRenames: false, renames: [] };

/**
 * Which object types and fact types are the same element across the two
 * models, decided once, before anything is compared.
 *
 * Every comparison that refers to an object type or fact type -- a role's
 * player, a subtype fact's ends, an objectification, a population's fact
 * type, a constraint's other fact type, a preferred identifier -- reads the
 * keys here rather than a name. Before, the top-level lists paired by name
 * and so did every reference, which was consistent; pairing by id at the
 * top while references compared names would have made one rename read as a
 * change on everything that refers to the renamed element. Names stay for
 * labels.
 */
export interface DiffIdentity {
  /** Existing order (paired or removed), then what only the incoming model has. */
  readonly objectTypes: readonly Paired<ObjectType>[];
  readonly factTypes: readonly Paired<FactType>[];
  /**
   * One string for both sides of a pair; for an unpaired element, its side
   * and id. `model` says which side the id was read in. An id that model
   * does not define is read in the other, as `playerName` reads it, so a
   * lenient fragment naming an element only the full model defines keys
   * the same as the full model (barwise-957); an id neither defines keys
   * as itself, so the same dangling id still matches.
   */
  objectTypeKey(model: OrmModel, id: string): string;
  factTypeKey(model: OrmModel, id: string): string;
  /**
   * The id an element of each side is paired by: its own, or, when both
   * models were replayed from 3.x files (`OrmModel.priorIds`), the id it
   * had in its file, so two replayed revisions of one file pair exactly
   * although each replay named its elements afresh (iri-identity WS6).
   */
  readonly existingPairId: (id: string) => string;
  readonly incomingPairId: (id: string) => string;
}

/** Each side's pairing id: its prior id when both models carry them, else its own. */
function pairIds(
  existing: OrmModel,
  incoming: OrmModel,
): { existingPairId: (id: string) => string; incomingPairId: (id: string) => string; } {
  const a = existing.priorIds;
  const b = incoming.priorIds;
  if (a === undefined || b === undefined) {
    const own = (id: string) => id;
    return { existingPairId: own, incomingPairId: own };
  }
  return { existingPairId: (id) => a.get(id) ?? id, incomingPairId: (id) => b.get(id) ?? id };
}

export function diffIdentity(
  existing: OrmModel,
  incoming: OrmModel,
  matching: ElementMatching,
  recognition: RenameRecognition = NO_RENAME_RECOGNITION,
): DiffIdentity {
  const ids = pairIds(existing, incoming);
  let objectTypes = pairElements(existing.objectTypes, incoming.objectTypes, matching, ids);
  let factTypes = pairElements(existing.factTypes, incoming.factTypes, matching, ids);
  for (const r of recognition.renames) {
    // Every kind spelled out: input from a tool call is not checked against
    // the type, and anything else read as a fact type would pair the wrong
    // kind of element.
    const kind: string = r.target.kind;
    if (kind === "objectType") objectTypes = declare(objectTypes, r, "object type");
    else if (kind === "factType") factTypes = declare(factTypes, r, "fact type");
    else {throw new Error(
        `Declared rename: kind must be objectType or factType, not ${JSON.stringify(kind)}.`,
      );}
  }
  const otKeyer = (pairs: readonly Paired<ObjectType>[]) =>
    keyer(existing, incoming, pairs, (m, id) => m.getObjectType(id) !== undefined);
  const ftKeyer = (pairs: readonly Paired<FactType>[]) =>
    keyer(existing, incoming, pairs, (m, id) => m.getFactType(id) !== undefined);
  if (recognition.recognizeRenames) {
    // Fact types first, keyed by their players as id and name paired
    // them; then object types, keyed by the fact types as that pass left
    // them. Every key below is rebuilt from the final pairs, so a
    // constraint, subtype fact, objectification or population follows a
    // recognized rename with no change of its own.
    // The fact type pass changes no object type, so one object type keyer
    // serves both passes; the fact type keyer it leaves is the final one.
    const otBefore = otKeyer(objectTypes);
    const models = { existing, incoming };
    factTypes = recognize(
      factTypes,
      models,
      (model, ft) => factTypeContentKey(model, ft, otBefore),
    );
    const ftKey = ftKeyer(factTypes);
    const plays = { existing: rolesPlayed(existing), incoming: rolesPlayed(incoming) };
    objectTypes = recognize(
      objectTypes,
      models,
      (model, ot) =>
        objectTypeContentKey(
          ot,
          (model === existing ? plays.existing : plays.incoming).get(ot.id),
          (id) => otBefore(model, id),
          (id) => ftKey(model, id),
        ),
    );
    return {
      objectTypes,
      factTypes,
      objectTypeKey: otKeyer(objectTypes),
      factTypeKey: ftKey,
      ...ids,
    };
  }
  return {
    objectTypes,
    factTypes,
    objectTypeKey: otKeyer(objectTypes),
    factTypeKey: ftKeyer(factTypes),
    ...ids,
  };
}

/**
 * Pair the element the existing model names `target.name` with the one
 * the incoming model names `to`. A name neither side holds, or an
 * element already paired with another, is the caller's mistake, and is
 * refused rather than ignored: an ignored declaration would report the
 * rename as a removal and an addition, which is what it was written to
 * prevent.
 */
function declare<T extends { readonly id: string; readonly name: string; }>(
  pairs: readonly Paired<T>[],
  r: DeclaredRename,
  kind: string,
): Paired<T>[] {
  const from = pairs.find((p) => p.existing?.name === r.target.name);
  const to = pairs.find((p) => p.incoming?.name === r.to);
  if (!from) {
    throw new Error(`Declared rename: the existing model has no ${kind} named "${r.target.name}".`);
  }
  if (!to) throw new Error(`Declared rename: the incoming model has no ${kind} named "${r.to}".`);
  if (from === to) return [...pairs];
  for (const p of [from, to]) {
    if (p.existing && p.incoming) {
      throw new Error(
        `Declared rename "${r.target.name}" -> "${r.to}": ${kind} "${p.existing.name}" is already `
          + `paired with "${p.incoming.name}".`,
      );
    }
  }
  const pair: Paired<T> = {
    existing: from.existing!,
    incoming: to.incoming!,
    pairedBy: "declared",
  };
  return pairs.filter((p) => p !== to).map((p) => (p === from ? pair : p));
}

/**
 * Pair the unpaired elements whose content key is the same on both sides
 * and held by exactly one element of each, so a key two elements share
 * pairs nothing. `contentKey` returns undefined for an element too bare
 * to recognize.
 */
function recognize<T extends { readonly id: string; }>(
  pairs: readonly Paired<T>[],
  models: { readonly existing: OrmModel; readonly incoming: OrmModel; },
  contentKey: (model: OrmModel, element: T) => string | undefined,
): Paired<T>[] {
  const index = (side: "existing" | "incoming") => {
    const byKey = new Map<string, T[]>();
    for (const p of pairs) {
      const e = p[side];
      if (!e || (p.existing && p.incoming)) continue;
      const key = contentKey(models[side], e);
      if (key === undefined) continue;
      byKey.set(key, [...(byKey.get(key) ?? []), e]);
    }
    return byKey;
  };
  const existingByKey = index("existing");
  const incomingByKey = index("incoming");
  const partner = new Map<T, T>();
  for (const [key, es] of existingByKey) {
    const is = incomingByKey.get(key);
    if (es.length === 1 && is?.length === 1) partner.set(es[0]!, is[0]!);
  }
  if (partner.size === 0) return [...pairs];
  const taken = new Set(partner.values());
  const out: Paired<T>[] = [];
  for (const p of pairs) {
    if (p.incoming && !p.existing && taken.has(p.incoming)) continue;
    const i = p.existing && !p.incoming ? partner.get(p.existing) : undefined;
    out.push(i ? { existing: p.existing!, incoming: i, pairedBy: "recognized" } : p);
  }
  return out;
}

type Keyer = (model: OrmModel, id: string) => string;

/** What an object type takes part in: the roles it plays, the subtype facts it ends. */
interface Played {
  readonly roles: { readonly factTypeId: string; readonly position: number; }[];
  readonly ends: { readonly end: "sub" | "super"; readonly other: string; }[];
}

/**
 * Every object type's roles and subtype-fact ends, in one walk of the
 * model, so keying each unpaired object type is not a scan of the whole
 * model each (the reason `roleHolders` exists in `elementDiff.ts`).
 */
function rolesPlayed(model: OrmModel): ReadonlyMap<string, Played> {
  const out = new Map<string, Played>();
  const of = (id: string) => {
    let p = out.get(id);
    if (!p) out.set(id, p = { roles: [], ends: [] });
    return p;
  };
  for (const ft of model.factTypes) {
    ft.roles.forEach((r, position) => of(r.playerId).roles.push({ factTypeId: ft.id, position }));
  }
  for (const sf of model.subtypeFacts) {
    of(sf.subtypeId).ends.push({ end: "sub", other: sf.supertypeId });
    of(sf.supertypeId).ends.push({ end: "super", other: sf.subtypeId });
  }
  return out;
}

/**
 * What a fact type says, without its name or ids: its arity, each
 * position's player (as the pairing so far keys it) and role name, and
 * its internal constraints by position. Not its readings, which a rename
 * of the fact type usually rewrites. A player that is unpaired keys by
 * its side and id, so a fact type none of whose players is paired cannot
 * match the other side, which is the floor for fact types.
 */
function factTypeContentKey(
  model: OrmModel,
  ft: FactType,
  otKey: Keyer,
): string {
  const position = new Map(ft.roles.map((r, i) => [r.id, `h${i}`]));
  const roleKey = (id: string) => position.get(id) ?? `r${JSON.stringify(id)}`;
  return JSON.stringify([
    ft.arity,
    ft.roles.map((r) => [otKey(model, r.playerId), r.name]),
    ft.internalConstraints.map((c) => constraintKey(c, roleKey)).sort(),
  ]);
}

/**
 * What an object type says, without its name or id: its kind, every role
 * it plays (by its fact type's key and position), the subtype facts it is
 * an end of (by the other end's key), and a value type's value constraint
 * and data type. Not its reference mode, which follows the name. An
 * object type that plays no role and ends no subtype fact has nothing
 * that tells it apart from any other of its kind, so it is never paired
 * by content: the floor for object types.
 */
function objectTypeContentKey(
  ot: ObjectType,
  played: Played | undefined,
  otKey: (id: string) => string,
  ftKey: (id: string) => string,
): string | undefined {
  const roles = (played?.roles ?? []).map(({ factTypeId, position }) =>
    JSON.stringify([ftKey(factTypeId), position])
  );
  const subtypes = (played?.ends ?? []).map(({ end, other }) => `${end}${otKey(other)}`);
  if (roles.length === 0 && subtypes.length === 0) return undefined;
  return JSON.stringify([
    ot.kind,
    roles.sort(),
    subtypes.sort(),
    isValueType(ot)
      ? [valueConstraintKey(ot.valueConstraint), JSON.stringify(ot.dataType ?? null)]
      : [],
  ]);
}

/**
 * Pair by id where both sides hold it (under id-first), then by name among
 * the rest. Within one model a repeated name keeps its last holder, as the
 * name maps this replaces did, so the name pass reads what it read before.
 */
function pairElements<T extends { readonly id: string; readonly name: string; }>(
  existing: readonly T[],
  incoming: readonly T[],
  matching: ElementMatching,
  ids: Pick<DiffIdentity, "existingPairId" | "incomingPairId">,
): Paired<T>[] {
  const byIdIncoming = new Map(incoming.map((e) => [ids.incomingPairId(e.id), e]));
  const partner = new Map<T, T>();
  const byId = new Set<T>();
  const takenIncoming = new Set<T>();
  if (matching === "id-first") {
    for (const e of existing) {
      const i = byIdIncoming.get(ids.existingPairId(e.id));
      if (i !== undefined && !takenIncoming.has(i)) {
        partner.set(e, i);
        byId.add(e);
        takenIncoming.add(i);
      }
    }
  }
  const lastByName = <U extends T>(items: readonly U[]) => new Map(items.map((e) => [e.name, e]));
  const restExisting = lastByName(existing.filter((e) => !partner.has(e)));
  const restIncoming = lastByName(incoming.filter((e) => !takenIncoming.has(e)));
  for (const [name, e] of restExisting) {
    const i = restIncoming.get(name);
    if (i !== undefined) {
      partner.set(e, i);
      takenIncoming.add(i);
    }
  }
  // An element a repeated name shadowed in the name pass appears nowhere,
  // as it did when both lists were name maps.
  const listedExisting = new Set([...partner.keys(), ...restExisting.values()]);
  const listedIncoming = new Set([...takenIncoming, ...restIncoming.values()]);
  const out: Paired<T>[] = [];
  for (const e of existing) {
    if (!listedExisting.has(e)) continue;
    const i = partner.get(e);
    out.push(
      i !== undefined
        ? { existing: e, incoming: i, pairedBy: byId.has(e) ? "id" : "name" }
        : { existing: e },
    );
  }
  for (const i of incoming) {
    if (listedIncoming.has(i) && !takenIncoming.has(i)) out.push({ incoming: i });
  }
  return out;
}

function keyer<T extends { readonly id: string; }>(
  existing: OrmModel,
  incoming: OrmModel,
  pairs: readonly Paired<T>[],
  defines: (model: OrmModel, id: string) => boolean,
): (model: OrmModel, id: string) => string {
  const pairKeyOfExisting = new Map<string, string>();
  const pairKeyOfIncoming = new Map<string, string>();
  for (const p of pairs) {
    if (p.existing && p.incoming) {
      const key = `p${JSON.stringify(p.existing.id)}`;
      pairKeyOfExisting.set(p.existing.id, key);
      pairKeyOfIncoming.set(p.incoming.id, key);
    }
  }
  const read = (side: "e" | "i", id: string): string | undefined => {
    const model = side === "e" ? existing : incoming;
    if (!defines(model, id)) return undefined;
    const paired = (side === "e" ? pairKeyOfExisting : pairKeyOfIncoming).get(id);
    return paired ?? `${side}${JSON.stringify(id)}`;
  };
  return (model, id) => {
    const side = model === incoming && model !== existing ? "i" : "e";
    return read(side, id) ?? read(side === "e" ? "i" : "e", id) ?? `x${JSON.stringify(id)}`;
  };
}
