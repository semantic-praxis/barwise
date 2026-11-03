/**
 * Storing the ids a format 4.0 file leaves to the load (iri-identity
 * decision 17). A constraint, subtype fact or objectification typed
 * without an id is given one on every load, and until the file states it
 * nothing else can refer to it. This writes each such id, with the key it
 * was minted from, into the file's own text, so the editor's "Store ids"
 * action and `barwise migrate` change nothing else in a file a person
 * wrote: the new lines are spliced in, and every other byte stays.
 * Re-printing the document from its syntax tree, which the first version
 * did, kept comments but reformatted flow collections, comment spacing and
 * line endings across the whole file (6b-3a's pr-review).
 */

import { isMap, isScalar, isSeq, type Pair, parseDocument, stringify, type YAMLMap } from "yaml";
import type { OrmModel } from "../model/OrmModel.js";
import { OrmYamlSerializer, writeDocument40 } from "./OrmYamlSerializer.js";

/** An id the file did not state, now written at `path`. */
export interface StoredId {
  readonly id: string;
  /** Where in the document the element sits: `["model", "constraints", 0]`. */
  readonly path: readonly (string | number)[];
  /** The text inserted, at `offset` in the input, to store it. */
  readonly insert: { readonly offset: number; readonly text: string; };
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
 * with its `minted_from` after it, where the 4.0 writer places them: after
 * the key the writer puts before `id` (a constraint's content), or first
 * when the writer puts `id` first (a subtype fact, an objectification), so
 * a later save by any surface does not move them. The file is read leniently, as the editor and
 * `barwise validate` read it. A file before 4.0 is returned unchanged with
 * nothing stored: it states no 4.0 id at all, and `barwise migrate`
 * rewrites it whole.
 *
 * @param loaded - The model `yaml` loads to, leniently, when the caller
 *   already holds it: the editor, which loads the file on every change
 *   and must not load it twice. A model read from other text gives wrong
 *   paths, which is why it is not taken from anywhere else.
 * @throws when the file does not load.
 */
export function storeIds(yaml: string, loaded?: OrmModel): StoreIdsResult {
  const model = loaded ?? new OrmYamlSerializer().deserialize(yaml, { lenient: true });
  const unstored = new Set(model.unstoredIds);
  if (unstored.size === 0) return { text: yaml, stored: [] };

  const doc = parseDocument(yaml);
  // The writer lists elements in the model's order, which is the file's:
  // the reader adds each list in order and drops nothing, so index i in one
  // is index i in the other. It leaves an empty list out, which the file
  // may state (`constraints: []`).
  const written = writeDocument40(model) as unknown as Record<string, unknown>;
  const stored: StoredId[] = [];
  for (const path of unnamedLists(model.factTypes.length)) {
    const seq = doc.getIn(path, true);
    if (!isSeq(seq)) continue;
    const wrote = path.reduce<unknown>(
      (at, key) => (at as Record<string | number, unknown> | undefined)?.[key],
      written,
    ) as readonly { id?: string; minted_from?: string; }[] | undefined ?? [];
    if (wrote.length !== seq.items.length) {
      throw new Error(
        `The file and its model disagree on how many elements ${path.join(".")} holds.`,
      );
    }
    seq.items.forEach((item, i) => {
      const element = wrote[i]!;
      const { id, minted_from } = element;
      if (!isMap(item) || item.has("id") || id === undefined || !unstored.has(id)) return;
      const keys = Object.keys(element);
      const before = keys[keys.indexOf("id") - 1];
      const fields: [string, string][] = [["id", id]];
      if (minted_from !== undefined) fields.push(["minted_from", minted_from]);
      stored.push({ id, path: [...path, i], insert: insertion(yaml, item, before, fields) });
    });
  }
  // Spliced from the end, so each offset still names the input's text.
  let text = yaml;
  for (const { insert } of [...stored].sort((a, b) => b.insert.offset - a.insert.offset)) {
    text = text.slice(0, insert.offset) + insert.text + text.slice(insert.offset);
  }
  return { text, stored };
}

/**
 * Where and what to insert to give `map` these fields: after the pair
 * keyed `after` when the map holds it, otherwise before its first pair. A
 * block map takes them as lines at its own indentation and line ending; a
 * flow map (`{ type: mandatory, role: X }`) takes them as entries.
 */
function insertion(
  text: string,
  map: YAMLMap,
  after: string | undefined,
  fields: readonly (readonly [string, string])[],
): { offset: number; text: string; } {
  const pairs = map.items as Pair[];
  const anchor = after === undefined
    ? undefined
    : pairs.find((p) => isScalar(p.key) && p.key.value === after);
  const first = pairs[0]!;
  const keyStart = (anchor ?? first).key as { range?: [number, number, number]; };
  const start = keyStart.range![0];

  if (map.flow) {
    const entries = fields.map(([k, v]) => `${k}: ${flowScalar(v)}`).join(", ");
    if (anchor === undefined) return { offset: start, text: `${entries}, ` };
    const end = endOf(anchor);
    return { offset: end, text: `, ${entries}` };
  }

  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const indent = " ".repeat(start - lineStart);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = fields.map(([k, v]) => `${k}: ${blockScalar(v)}`);
  if (anchor === undefined) {
    return { offset: start, text: lines.map((l) => `${l}${eol}${indent}`).join("") };
  }
  // After the anchor's value, at the end of its last line, so a comment on
  // that line stays with it.
  const valueEnd = endOf(anchor);
  if (text[valueEnd - 1] === "\n") {
    return { offset: valueEnd, text: lines.map((l) => `${indent}${l}${eol}`).join("") };
  }
  let lineEnd = text.indexOf("\n", valueEnd);
  if (lineEnd === -1) lineEnd = text.length;
  else if (text[lineEnd - 1] === "\r") lineEnd -= 1;
  return { offset: lineEnd, text: lines.map((l) => `${eol}${indent}${l}`).join("") };
}

/** Where a pair's value ends; its key's end when it has no value (`role:`). */
function endOf(pair: Pair): number {
  const node = (pair.value ?? pair.key) as { range: [number, number, number]; };
  return node.range[1];
}

/** A scalar as a block mapping value, as the `yaml` library would write it. */
function blockScalar(value: string): string {
  return stringify(value, { lineWidth: 0 }).trimEnd();
}

/** A scalar safe inside a flow mapping, where `,`, `{`, `}`, `[`, `]` end it. */
function flowScalar(value: string): string {
  const plain = blockScalar(value);
  return /[,[\]{}]/.test(plain) && !/^['"]/.test(plain) ? JSON.stringify(value) : plain;
}
