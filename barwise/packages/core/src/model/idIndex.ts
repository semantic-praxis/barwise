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

/**
 * A model's store for one id-keyed kind, which keeps the id index as it
 * changes: `set` holds the element's id and `delete` releases it, so a
 * store and the index cannot fall out of step by a method that writes one
 * and forgets the other (review of 6b-1).
 */
export class IdKeyedStore<E extends { readonly id: string; }> {
  private readonly byId = new Map<string, E>();

  constructor(private readonly kind: IdKeyedKind, private readonly index: IdIndex) {}

  get(id: string): E | undefined {
    return this.byId.get(id);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  get size(): number {
    return this.byId.size;
  }

  values(): IterableIterator<E> {
    return this.byId.values();
  }

  /**
   * Store an element under its id. The model refuses a held id first, with a
   * message naming both elements; this refuses it too, so a caller that
   * forgot cannot overwrite an element and leave the index counting both.
   */
  set(element: E): void {
    if (this.byId.has(element.id)) {
      throw new Error(`IdKeyedStore: a ${this.kind} already holds ${JSON.stringify(element.id)}.`);
    }
    this.byId.set(element.id, element);
    this.index.hold(element.id, this.kind);
  }

  /** Drop the element under `id`, if any; whether one was there. */
  delete(id: string): boolean {
    if (!this.byId.delete(id)) return false;
    this.index.release(id, this.kind);
    return true;
  }
}
