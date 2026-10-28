/**
 * The two IRI shapes a project and a model declare (iri-identity WS4), in
 * a module of their own so `OrmModel` and `OrmProject` can check a value
 * without importing `namespace.ts`, which reads `OrmModel`.
 */

/**
 * An absolute IRI: a scheme, a colon, no whitespace. The JSON Schemas
 * repeat these two patterns (`orm-project.schema.json` `iri_base`,
 * `orm-model.schema.json` `namespace`), and `namespace.test.ts` checks they
 * match, so a value core accepts is one its own files can hold.
 */
const ABSOLUTE_IRI = "^[A-Za-z][A-Za-z0-9+.-]*:\\S*";

/** A project's `iri_base`: an absolute IRI ending in `/`. */
export const IRI_BASE_PATTERN = new RegExp(`${ABSOLUTE_IRI}/$`, "u");

/** A model's `namespace`: an absolute IRI ending in `/` or `#`. */
export const NAMESPACE_PATTERN = new RegExp(`${ABSOLUTE_IRI}[/#]$`, "u");

/**
 * The value, if it is a valid `iri_base` or `namespace`; throws otherwise,
 * so a model or project in memory never holds one its file would refuse
 * (the barwise-942 class: a save that cannot be reopened).
 */
export function checkedIri(
  value: string | undefined,
  pattern: RegExp,
  field: "iri_base" | "namespace",
): string | undefined {
  if (value === undefined || pattern.test(value)) return value;
  const ending = field === "iri_base" ? '"/"' : '"/" or "#"';
  throw new Error(`${field} "${value}" is not an absolute IRI ending in ${ending}.`);
}
