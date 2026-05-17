/**
 * Symbolic model query API.
 *
 * Provides a small, formal query language over an `OrmModel`. Queries
 * are answered deterministically -- no I/O, no LLM -- which lets AI
 * agents ask precise structural questions instead of re-deriving
 * answers from prose, and provides the query vocabulary needed for
 * formal derivation rules.
 *
 * Three layers:
 *  - {@link ModelQuery} -- the formal, serializable query struct.
 *  - {@link parseQuery} -- a one-line text DSL front-end over the struct.
 *  - {@link queryModel} -- the deterministic evaluator.
 *
 * @example
 * ```ts
 * const result = runQuery(model, 'fact-types-of Customer');
 * console.log(formatQueryResult(result));
 * ```
 */

import type { OrmModel } from "../model/OrmModel.js";
import { queryModel } from "./evaluate.js";
import { parseQuery } from "./parse.js";
import type { QueryResult } from "./types.js";

export { queryModel } from "./evaluate.js";
export { formatQueryResult } from "./format.js";
export { parseQuery, QUERY_COMMANDS, tokenizeQuery } from "./parse.js";
export type {
  ConstraintRef,
  EntityDetail,
  EntityRef,
  FactTypeDetail,
  FactTypeRef,
  ModelQuery,
  ModelQueryKind,
  ModelStats,
  PathStep,
  QueryResult,
  RoleRef,
} from "./types.js";
export { QueryParseError } from "./types.js";

/**
 * Parse a query string and evaluate it against a model in one step.
 *
 * @param model - The ORM model to query.
 * @param text - A query in the text DSL (see {@link parseQuery}).
 * @returns The deterministic {@link QueryResult}.
 * @throws {QueryParseError} if the query string is malformed.
 */
export function runQuery(model: OrmModel, text: string): QueryResult {
  return queryModel(model, parseQuery(text));
}
