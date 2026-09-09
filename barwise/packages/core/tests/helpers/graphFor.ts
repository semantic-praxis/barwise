import { graphOf, type ModelGraph } from "../../src/model/graph.js";
import type { OrmModel } from "../../src/model/OrmModel.js";
import type { Diagnostic } from "../../src/validation/Diagnostic.js";
import { referenceDiagnostics } from "../../src/validation/referenceDiagnostics.js";

/**
 * The graph for a model a test believes resolves.
 *
 * Graph-taking rules cannot be called without one, and a test that
 * silently got `undefined` here would fail somewhere unrelated with
 * "cannot read properties of undefined". So this throws at the point of
 * the mistake and names the references that did not resolve.
 */
export function graphFor(model: OrmModel): ModelGraph {
  const result = graphOf(model);
  if (!result.ok) {
    throw new Error(
      `graphFor: model has ${result.unresolved.length} unresolvable reference(s): `
        + result.unresolved.map((u) => `${u.from.kind}.${u.field} -> "${u.missing}"`).join(", "),
    );
  }
  return result.graph;
}

/**
 * The diagnostics for a model a test believes does NOT resolve.
 *
 * The mirror of `graphFor`: the dangling-reference checks moved out of
 * the rules and into `graphOf`, so a test that used to call a rule and
 * filter for `structural/dangling-role-reference` calls this instead
 * and filters for the same id.
 */
export function unresolvedDiagnostics(model: OrmModel): Diagnostic[] {
  const result = graphOf(model);
  if (result.ok) throw new Error("unresolvedDiagnostics: every reference resolved");
  return referenceDiagnostics(result.unresolved);
}
