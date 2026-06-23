/**
 * query_model tool: runs a deterministic symbolic query against an ORM
 * model.
 *
 * Unlike describe_domain (which returns a broad summary), query_model
 * answers a single precise question -- what fact types an entity plays
 * in, which roles are mandatory, how two entities connect, and so on --
 * with a structured, deterministic result. AI agents should prefer this
 * tool over guessing model structure from prior context.
 */

import {
  formatQueryResult,
  parseQuery,
  QUERY_COMMANDS,
  queryModel,
  QueryParseError,
} from "@barwise/core/query";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveModels, type SourceInput } from "../workspace/resolve.js";
import { sourceInputSchema } from "../workspace/sourceSchema.js";

const QUERY_DESCRIPTION = "Query DSL expression. Commands: "
  + "entities [entity|value], fact-types [arity], constraints [type], "
  + "entity <name>, fact-type <name>, fact-types-of <entity>, "
  + "related-to <entity>, constraints-of <name>, "
  + "subtypes-of <entity> [transitive], supertypes-of <entity> [transitive], "
  + "mandatory-roles [entity], path <entityA> <entityB>, stats. "
  + "Wrap names containing spaces in double quotes, "
  + 'e.g. fact-type "Customer places Order".';

export function registerQueryModelTool(server: McpServer): void {
  server.registerTool(
    "query_model",
    {
      title: "Query ORM Model",
      description: "Run a deterministic symbolic query against an ORM 2 model. "
        + "Answers precise structural questions (what entities exist, what fact "
        + "types an entity participates in, what constraints apply, how two "
        + "entities connect, model statistics) without any LLM inference. Prefer "
        + "this over re-deriving answers from a model summary. Given a "
        + ".orm-project.yaml manifest, queries every domain (or one chosen with "
        + "`domain`).",
      inputSchema: {
        source: sourceInputSchema(
          "File path to .orm.yaml, .orm-project.yaml, or inline YAML content",
        ),
        query: z.string().describe(QUERY_DESCRIPTION),
        domain: z
          .string()
          .optional()
          .describe("For a project source, query only this one domain context"),
      },
    },
    async ({ source, query, domain }) => {
      return executeQueryModel(source, query, domain);
    },
  );
}

export function executeQueryModel(
  source: SourceInput,
  query: string,
  domain?: string,
): { content: Array<{ type: "text"; text: string; }>; } {
  let parsed;
  try {
    parsed = parseQuery(query);
  } catch (error) {
    const message = error instanceof QueryParseError
      ? error.message
      : error instanceof Error
      ? error.message
      : String(error);
    return jsonContent({
      error: message,
      hint: `Valid commands: ${QUERY_COMMANDS.join(", ")}`,
    });
  }

  try {
    const { resolved, problems } = resolveModels(source, domain);
    const blocks = resolved.map(({ context, model }) => {
      const result = queryModel(model, parsed);
      const block = { result, text: formatQueryResult(result) };
      return context ? { domain: context, ...block } : block;
    });

    // Single plain model: preserve the original { query, result, text } shape.
    const payload = blocks.length === 1 ? { query, ...blocks[0] } : { query, domains: blocks };
    return jsonContent(problems.length > 0 ? { ...payload, warnings: problems } : payload);
  } catch (error) {
    return jsonContent({
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function jsonContent(
  value: unknown,
): { content: Array<{ type: "text"; text: string; }>; } {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}
