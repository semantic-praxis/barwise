import type { FactType } from "../model/FactType.js";
import type { ObjectType } from "../model/ObjectType.js";
import type { OrmModel } from "../model/OrmModel.js";

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

/** One entry of a kind's pairing: both sides, or one. */
export type Paired<T> =
  | { readonly existing: T; readonly incoming: T; }
  | { readonly existing: T; readonly incoming?: undefined; }
  | { readonly existing?: undefined; readonly incoming: T; };

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
}

export function diffIdentity(
  existing: OrmModel,
  incoming: OrmModel,
  matching: ElementMatching,
): DiffIdentity {
  const objectTypes = pairElements(existing.objectTypes, incoming.objectTypes, matching);
  const factTypes = pairElements(existing.factTypes, incoming.factTypes, matching);
  const otKey = keyer(
    existing,
    incoming,
    objectTypes,
    (m, id) => m.getObjectType(id) !== undefined,
  );
  const ftKey = keyer(existing, incoming, factTypes, (m, id) => m.getFactType(id) !== undefined);
  return { objectTypes, factTypes, objectTypeKey: otKey, factTypeKey: ftKey };
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
): Paired<T>[] {
  const byIdIncoming = new Map(incoming.map((e) => [e.id, e]));
  const partner = new Map<T, T>();
  const takenIncoming = new Set<T>();
  if (matching === "id-first") {
    for (const e of existing) {
      const i = byIdIncoming.get(e.id);
      if (i !== undefined && !takenIncoming.has(i)) {
        partner.set(e, i);
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
    out.push(i !== undefined ? { existing: e, incoming: i } : { existing: e });
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
