/**
 * Where a model's element IRIs start (iri-identity WS4). Pure; core forms
 * an IRI and never dereferences one.
 */

import { localName } from "./name.js";
import type { OrmModel } from "./OrmModel.js";

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

/**
 * A domain's place in a project, as values rather than a project to look
 * them up in: `iriBase` is the project's, `context` the manifest's.
 * Carrying the values is what lets {@link namespaceOf} answer for a domain
 * whose file did not load, and leaves no "not a domain of this project"
 * case to throw on.
 */
export interface DomainRef {
  readonly iriBase?: string;
  readonly context: string;
}

/**
 * A model's namespace: with a project `iriBase`, that base followed by the
 * context's local name and `/` -- the project's, which wins over anything
 * the model's own header says (`project/domain-namespace-overridden`
 * reports the conflict); otherwise the model's own `namespace`, or
 * `undefined` when it declares none (iri-identity decision 11).
 *
 * The context is the manifest's. The model's `domain_context` header plays
 * no part, as it plays none in loading a project.
 */
export function namespaceOf(
  model: OrmModel | undefined,
  domain: DomainRef & { readonly iriBase: string; },
): string;
export function namespaceOf(model: OrmModel | undefined, domain?: DomainRef): string | undefined;
export function namespaceOf(
  model: OrmModel | undefined,
  domain?: DomainRef,
): string | undefined {
  if (domain?.iriBase !== undefined) {
    return `${domain.iriBase}${localName(domain.context)}/`;
  }
  return model?.namespace;
}
