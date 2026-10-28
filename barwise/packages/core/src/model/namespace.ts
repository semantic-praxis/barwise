/**
 * Where a model's element IRIs start (iri-identity WS4). Pure; core forms
 * an IRI and never dereferences one.
 */

import { localName } from "./name.js";
import type { OrmModel } from "./OrmModel.js";

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
  domain?: DomainRef,
): string | undefined {
  if (domain?.iriBase !== undefined) {
    return `${domain.iriBase}${localName(domain.context)}/`;
  }
  return model?.namespace;
}
