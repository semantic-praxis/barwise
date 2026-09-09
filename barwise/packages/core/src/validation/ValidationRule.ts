import type { ModelGraph } from "../model/graph.js";
import type { OrmModel } from "../model/OrmModel.js";
import type { Diagnostic } from "./Diagnostic.js";

/**
 * A validation rule is a pure function that inspects an OrmModel and
 * returns zero or more diagnostics.
 */
export type ValidationRule = (model: OrmModel) => Diagnostic[];

/**
 * A rule that needs references resolved: it reads players, fact types
 * and hierarchies from a built `ModelGraph` instead of looking ids up
 * and guarding the result.
 *
 * The two types are separate rather than one signature with an optional
 * graph because the difference decides whether a rule can run at all. A
 * model with a dangling reference has no graph, so these rules do not
 * run on it -- `ValidationEngine.validate` reports the unresolvable
 * references instead and still runs the reference-free rules. Which
 * list a rule is registered in is therefore a claim about what it
 * needs. The type catches the dangerous half of a wrong claim: a rule
 * that takes the graph will not compile in the reference-free list. The
 * harmless half -- a rule that ignores the graph sitting in the
 * graph-taking list -- compiles, and costs only that it is skipped on a
 * model it could have run on.
 */
export type GraphValidationRule = (model: OrmModel, graph: ModelGraph) => Diagnostic[];
