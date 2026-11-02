/**
 * Storing the ids a format 4.0 file leaves to the load (iri-identity
 * decision 17). A constraint, subtype fact or objectification typed
 * without an id is given one on every load, and until the file states it
 * nothing else can refer to it. This writes each such id, with the key it
 * was minted from, into the file's own text, so the editor's "Store ids"
 * action and `barwise migrate` keep a person's comments and layout rather
 * than rewriting the file from the model.
 */

import { isMap, isSeq, parseDocument, type YAMLMap } from "yaml";
import { OrmYamlSerializer, writeDocument40 } from "./OrmYamlSerializer.js";

/** An id the file did not state, now written at `path`. */
export interface StoredId {
  readonly id: string;
  /** Where in the document the element sits: `["model", "constraints", 0]`. */
  readonly path: readonly (string | number)[];
}

export interface StoreIdsResult {
  /** The file with every unstored id written; the input when there were none. */
  readonly text: string;
  readonly stored: readonly StoredId[];
}

/** The lists whose elements a 4.0 file may give no id, by document path. */
function unnamedLists(factTypes: number): (string | number)[][] {
  return [
    ...Array.from({ length: factTypes }, (_, i) => ["model", "fact_types", i, "constraints"]),
    ["model", "constraints"],
    ["model", "subtype_facts"],
    ["model", "objectified_fact_types"],
  ];
}

/**
 * Write into a 4.0 file every id its load minted (`OrmModel.unstoredIds`),
 * each as the element's first key with its `minted_from` after it, as the
 * 4.0 writer places them. The file is read leniently, as the editor and
 * `barwise validate` read it. A file before 4.0 is returned unchanged with
 * nothing stored: it states no 4.0 id at all, and `barwise migrate`
 * rewrites it whole.
 *
 * @throws when the file does not load.
 */
export function storeIds(yaml: string): StoreIdsResult {
  const model = new OrmYamlSerializer().deserialize(yaml, { lenient: true });
  const unstored = new Set(model.unstoredIds);
  if (unstored.size === 0) return { text: yaml, stored: [] };

  const doc = parseDocument(yaml);
  // The writer lists elements in the model's order, which is the file's:
  // the reader adds each list in order and drops nothing, so index i in one
  // is index i in the other.
  const written = writeDocument40(model) as unknown as Record<string, unknown>;
  const stored: StoredId[] = [];
  for (const path of unnamedLists(model.factTypes.length)) {
    const seq = doc.getIn(path, true);
    if (!isSeq(seq)) continue;
    const wrote = path.reduce<unknown>(
      (at, key) => (at as Record<string | number, unknown> | undefined)?.[key],
      written,
    ) as readonly { id?: string; minted_from?: string; }[] | undefined;
    if (wrote?.length !== seq.items.length) {
      throw new Error(
        `The file and its model disagree on how many elements ${path.join(".")} holds.`,
      );
    }
    seq.items.forEach((item, i) => {
      const { id, minted_from } = wrote[i]!;
      if (!isMap(item) || item.has("id") || id === undefined || !unstored.has(id)) return;
      const map = item as YAMLMap;
      const pairs = [doc.createPair("id", id)];
      if (minted_from !== undefined) pairs.push(doc.createPair("minted_from", minted_from));
      map.items.unshift(...pairs);
      stored.push({ id, path: [...path, i] });
    });
  }
  // lineWidth 0: never fold a long line the person wrote on one.
  return { text: doc.toString({ lineWidth: 0 }), stored };
}
