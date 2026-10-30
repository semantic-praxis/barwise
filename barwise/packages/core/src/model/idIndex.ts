/**
 * Every id a model holds, across kinds (iri-identity WS6, 6b). In format
 * 4.0 an id is a local name, unique in its model whatever it names, so
 * minting a name or deriving one has to see every id at once: an object
 * type's, a fact type's, a role's, a named constraint's, a subtype fact's,
 * an objectification's, a population's. The per-kind stores cannot answer
 * that; this does.
 *
 * It counts holders rather than keeping them. A model built in code, or
 * read from a 2.0 file, can repeat a constraint id, which validation
 * reports (`structural/duplicate-constraint-id`) rather than the store
 * refusing, and a constraint is replaced by a narrowed copy under its own
 * id when a subtype fact goes; a count stays right through both, where a
 * held reference would go stale. Which element holds an id is the stores'
 * to answer.
 *
 * A leaf module: `OrmModel` keeps one, and nothing here reads the model.
 */

/** The five kinds an `OrmModel` stores in a map keyed by id. */
export type IdKeyedKind =
  | "object type"
  | "fact type"
  | "subtype fact"
  | "objectification"
  | "population";

/** Every kind whose id the index holds. */
export type IdKind = IdKeyedKind | "role" | "constraint";

export class IdIndex {
  private readonly held = new Map<string, Map<IdKind, number>>();

  /** One more element of `kind` holds `id`; an element with no id holds none. */
  hold(id: string | undefined, kind: IdKind): void {
    if (id === undefined) return;
    const kinds = this.held.get(id) ?? new Map<IdKind, number>();
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    this.held.set(id, kinds);
  }

  /** One element of `kind` no longer holds `id`. */
  release(id: string | undefined, kind: IdKind): void {
    if (id === undefined) return;
    const kinds = this.held.get(id);
    const count = kinds?.get(kind);
    if (kinds === undefined || count === undefined) {
      throw new Error(`IdIndex: no ${kind} holds ${JSON.stringify(id)} to release.`);
    }
    if (count > 1) kinds.set(kind, count - 1);
    else kinds.delete(kind);
    if (kinds.size === 0) this.held.delete(id);
  }

  /** The kinds holding `id`, sorted; empty when nothing does. */
  kindsHolding(id: string): readonly IdKind[] {
    return [...(this.held.get(id)?.keys() ?? [])].sort();
  }

  /** Whether any element, of any kind, holds `id`. */
  holds(id: string): boolean {
    return this.held.has(id);
  }

  /** Every held id with each kind's count, for a test to compare with the stores. */
  snapshot(): ReadonlyMap<string, ReadonlyMap<IdKind, number>> {
    return new Map([...this.held].map(([id, kinds]) => [id, new Map(kinds)]));
  }
}
