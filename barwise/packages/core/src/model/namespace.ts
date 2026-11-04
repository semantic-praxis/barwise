/**
 * Where a model's element IRIs start (iri-identity WS4). Pure; core forms
 * an IRI and never dereferences one.
 */

import { ABSOLUTE_IRI_PATTERN } from "./iri.js";
import { localName } from "./name.js";
import type { OrmModel } from "./OrmModel.js";
import type { OrmProject } from "./OrmProject.js";

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

/**
 * An element's IRI (iri-identity WS6): its namespace followed by its id.
 * A local id (`Customer`, `Customer_places_Order.places`) expands from the
 * model's own namespace, or, given its project, the namespace the project
 * gives the domain (`namespaceOf`). An `alias:local` id names another
 * domain's element: given the project, the alias resolves through the
 * model's `imports`, to a context the project holds (that domain's
 * namespace) or to an absolute namespace IRI. Undefined where the answer
 * is not known: no namespace (decision 11), an alias the model does not
 * import or whose context the project does not hold, and any alias id
 * without a project.
 *
 * It does not search for a project: a caller that has one passes it, and
 * the file the editor opened does not decide which project it belongs to
 * (explicit over implicit). Pure; core forms an IRI and does not check
 * the model holds the id, or dereference anything.
 */
export function iriOf(
  model: OrmModel,
  id: string,
  domain?: { readonly project: OrmProject; readonly context: string; },
): string | undefined {
  const colon = id.indexOf(":");
  const iriBase = domain?.project.iriBase;
  /** The project's place for a context, as `namespaceOf` takes it. */
  const ref = (context: string): DomainRef => ({
    ...(iriBase !== undefined ? { iriBase } : {}),
    context,
  });
  if (colon < 0) {
    const ns = namespaceOf(model, domain ? ref(domain.context) : undefined);
    return ns === undefined ? undefined : `${ns}${id}`;
  }
  if (domain === undefined) return undefined;
  const target = model.imports.get(id.slice(0, colon));
  if (target === undefined) return undefined;
  const local = id.slice(colon + 1);
  if (ABSOLUTE_IRI_PATTERN.test(target)) return `${target}${local}`;
  const owner = domain.project.getDomain(target);
  if (owner === undefined) return undefined;
  const ns = namespaceOf(owner.model, ref(owner.context));
  return ns === undefined ? undefined : `${ns}${local}`;
}

/**
 * The alias an `alias:local` id names its owner's domain by, or undefined
 * for a local id (iri-identity 6d). A shadow's id says whose element it
 * is, so this replaces the `source_context` a 3.x file stated beside it:
 * ownership is stated once.
 */
export function aliasOf(id: string): string | undefined {
  const colon = id.indexOf(":");
  return colon < 0 ? undefined : id.slice(0, colon);
}

/**
 * The domain a shadow's owner lives in: what the model's `imports` binds
 * the id's alias to, or the alias itself where the model imports nothing
 * under it (a standalone file, whose alias names the context;
 * `structural/alias-not-imported` reports it). Undefined for an element
 * the model owns. An import bound to an absolute IRI gives that IRI.
 */
export function ownerContextOf(model: OrmModel, id: string): string | undefined {
  const alias = aliasOf(id);
  return alias === undefined ? undefined : model.imports.get(alias) ?? alias;
}

/**
 * The alias a model imports `context` under (iri-identity 6b-3b, 6d): the
 * context's local name, or that with `_N` when another context already
 * holds it ("Sales Ops" and "Sales_Ops"), so no two contexts share one
 * alias and a shadow never names the wrong owner. `bound` says what an
 * alias is bound to so far; the caller binds the one returned if it is new.
 * The one rule the 3.x replay and split both name shadows by.
 */
export function aliasForContext(
  context: string,
  bound: (alias: string) => string | undefined,
): string {
  const base = localName(context);
  for (let n = 1;; n++) {
    const alias = n === 1 ? base : `${base}_${n}`;
    const target = bound(alias);
    if (target === undefined || target === context) return alias;
  }
}
