/**
 * Symbolic model query API: text DSL parser.
 *
 * `parseQuery` converts a one-line query string into a formal
 * {@link ModelQuery}. The DSL is a thin, lossless front-end over the
 * struct -- a command keyword followed by arguments, with double quotes
 * around names that contain spaces.
 *
 * Examples:
 *   entities
 *   entities value
 *   fact-types 3
 *   entity Customer
 *   fact-type "Customer places Order"
 *   subtypes-of Person transitive
 *   path Customer Product
 */

import { type ModelQuery, QueryParseError } from "./types.js";

/** The set of recognized query commands, for help text and validation. */
export const QUERY_COMMANDS: readonly string[] = [
  "entities",
  "fact-types",
  "constraints",
  "entity",
  "fact-type",
  "fact-types-of",
  "related-to",
  "constraints-of",
  "subtypes-of",
  "supertypes-of",
  "mandatory-roles",
  "path",
  "stats",
];

/**
 * Split a query string into tokens, treating double-quoted spans as a
 * single token. Unbalanced quotes throw a {@link QueryParseError}.
 */
export function tokenizeQuery(text: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;
  let hasToken = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"') {
      inQuotes = !inQuotes;
      hasToken = true;
      continue;
    }
    if (!inQuotes && (ch === " " || ch === "\t" || ch === "\n" || ch === "\r")) {
      if (hasToken) {
        tokens.push(current);
        current = "";
        hasToken = false;
      }
      continue;
    }
    current += ch;
    hasToken = true;
  }

  if (inQuotes) {
    throw new QueryParseError("Unbalanced double quote in query.");
  }
  if (hasToken) {
    tokens.push(current);
  }
  return tokens;
}

/**
 * Parse a query string into a {@link ModelQuery}.
 *
 * @throws {QueryParseError} if the query is empty, uses an unknown
 *   command, is missing a required argument, or has unbalanced quotes.
 */
export function parseQuery(text: string): ModelQuery {
  const tokens = tokenizeQuery(text);
  if (tokens.length === 0) {
    throw new QueryParseError(
      `Empty query. Expected one of: ${QUERY_COMMANDS.join(", ")}.`,
    );
  }

  const command = tokens[0]!.toLowerCase();
  const args = tokens.slice(1);

  switch (command) {
    case "entities": {
      if (args.length === 0) return { kind: "list-entities" };
      const filter = args[0]!.toLowerCase();
      if (filter !== "entity" && filter !== "value") {
        throw new QueryParseError(
          `"entities" filter must be "entity" or "value", got "${args[0]}".`,
        );
      }
      return { kind: "list-entities", entityKind: filter };
    }

    case "fact-types": {
      if (args.length === 0) return { kind: "list-fact-types" };
      const arity = Number(args[0]);
      if (!Number.isInteger(arity) || arity < 1) {
        throw new QueryParseError(
          `"fact-types" arity must be a positive integer, got "${args[0]}".`,
        );
      }
      return { kind: "list-fact-types", arity };
    }

    case "constraints": {
      if (args.length === 0) return { kind: "list-constraints" };
      return { kind: "list-constraints", constraintType: args[0]! };
    }

    case "entity":
      return { kind: "entity", name: requireArg(command, args, "entity name") };

    case "fact-type":
      return { kind: "fact-type", name: requireArg(command, args, "fact type name") };

    case "fact-types-of":
      return {
        kind: "fact-types-of",
        entity: requireArg(command, args, "entity name"),
      };

    case "related-to":
      return {
        kind: "related-entities",
        entity: requireArg(command, args, "entity name"),
      };

    case "constraints-of":
      return {
        kind: "constraints-of",
        name: requireArg(command, args, "entity or fact type name"),
      };

    case "subtypes-of":
      return {
        kind: "subtypes-of",
        entity: requireArg(command, args, "entity name"),
        transitive: hasTransitiveFlag(command, args),
      };

    case "supertypes-of":
      return {
        kind: "supertypes-of",
        entity: requireArg(command, args, "entity name"),
        transitive: hasTransitiveFlag(command, args),
      };

    case "mandatory-roles":
      return args.length === 0
        ? { kind: "mandatory-roles" }
        : { kind: "mandatory-roles", entity: args[0]! };

    case "path": {
      if (args.length < 2) {
        throw new QueryParseError(
          `"path" requires two entity names: path <entityA> <entityB>.`,
        );
      }
      return { kind: "path", from: args[0]!, to: args[1]! };
    }

    case "stats":
      return { kind: "model-stats" };

    default:
      throw new QueryParseError(
        `Unknown query command "${tokens[0]}". `
          + `Expected one of: ${QUERY_COMMANDS.join(", ")}.`,
      );
  }
}

function requireArg(command: string, args: string[], label: string): string {
  if (args.length === 0 || args[0]!.length === 0) {
    throw new QueryParseError(`"${command}" requires a ${label}.`);
  }
  return args[0]!;
}

function hasTransitiveFlag(command: string, args: string[]): boolean {
  const flag = args[1];
  if (flag === undefined) return false;
  if (flag.toLowerCase() === "transitive") return true;
  throw new QueryParseError(
    `"${command}" second argument must be "transitive" if present, got "${flag}".`,
  );
}
