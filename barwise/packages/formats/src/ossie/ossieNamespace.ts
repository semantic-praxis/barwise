/**
 * The namespace a set of concept IRIs states (iri-identity 6f). One rule,
 * shared by the importer, which reads the namespace back, and the export,
 * which predicts whether it will: the two must agree, or the export leaves
 * a namespace out of its loss block that the import then drops. They agree
 * when the export gives it the ids the importer will mint, which it works
 * out by the same suffix rule; the export's read-back (`verifyOssie`)
 * reports whatever a prediction still misses.
 */

/** A concept's IRI, and the id the importer gives that concept. */
export interface ConceptIri {
  readonly iri: string;
  readonly id: string;
}

/**
 * The namespace most of these IRIs agree on, or undefined when none does,
 * or two tie. An element's identity IRI is its namespace followed by its
 * id, and a namespace ends in `/` or `#`, so only an IRI that ends in its
 * concept's id at such a boundary counts: `.../sales/LineItem` says nothing
 * of a concept whose id is `Item`. Taking the most common namespace keeps
 * one concept carrying an outside IRI (`http://schema.org/Customer`) from
 * costing every other concept theirs.
 */
export function namespaceOfIris(concepts: readonly ConceptIri[]): string | undefined {
  const counts = new Map<string, number>();
  for (const { iri, id } of concepts) {
    if (!iri.endsWith(id)) continue;
    const namespace = iri.slice(0, iri.length - id.length);
    if (!namespace.endsWith("/") && !namespace.endsWith("#")) continue;
    counts.set(namespace, (counts.get(namespace) ?? 0) + 1);
  }
  let best: string | undefined;
  let most = 0;
  let tied = false;
  for (const [namespace, count] of counts) {
    if (count > most) {
      best = namespace;
      most = count;
      tied = false;
    } else if (count === most) {
      tied = true;
    }
  }
  return tied ? undefined : best;
}
