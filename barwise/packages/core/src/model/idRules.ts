/**
 * The id each kind of element takes when none is given (iri-identity WS6):
 * the one home for these rules, which `OrmModel` applies when it names
 * what it is given and an element built outside a model applies to itself
 * (6b-4b), so the two cannot drift. A model also applies the suffix rule
 * across every id it holds; outside one, only within what is built
 * together.
 */
import { localName } from "./name.js";

/** An object type's or fact type's: its name's local name (decision 13). */
export function nameIdBase(name: string): string {
  return localName(name);
}

/** A role's: its fact type's id, a `.`, and its role name's local name. */
export function roleIdBase(factTypeId: string, roleName: string): string {
  return `${factTypeId}.${localName(roleName)}`;
}

/** A population's: its fact type's id and `.population` (decision 7). */
export function populationIdBase(factTypeId: string): string {
  return `${factTypeId}.population`;
}

/**
 * `base` when `free` says it is, else the first of `base_2`, `base_3`, ...
 * that is: the suffix rule (decision 5).
 */
export function suffixed(base: string, free: (id: string) => boolean): string {
  if (free(base)) return base;
  for (let n = 2;; n++) {
    if (free(`${base}_${n}`)) return `${base}_${n}`;
  }
}
