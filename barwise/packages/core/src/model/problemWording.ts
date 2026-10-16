/**
 * The sentence endings a load problem uses for a field, shared by the Effect
 * decoders and the loader's kept schema errors, so one rule reads one way
 * whichever of them reported it. A field is named by its path below the
 * element, dot-joined as a person reads it (`ranges.0.min`); the exact
 * location is the error's JSON Pointer.
 */

/** A path below an element, as a message names it. */
export function fieldPath(path: readonly PropertyKey[]): string {
  return path.map(String).join(".");
}

export function unknownField(path: readonly PropertyKey[]): string {
  return `has an unknown field "${fieldPath(path)}".`;
}

export function missingField(path: readonly PropertyKey[]): string {
  return `is missing "${fieldPath(path)}".`;
}

export function invalidField(path: readonly PropertyKey[], detail: string): string {
  return `has an invalid ${fieldPath(path)}: ${detail}.`;
}
