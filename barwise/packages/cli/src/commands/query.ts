/**
 * barwise query <source> <query...>
 *
 * Run a symbolic, deterministic query against an ORM model (or, given a
 * `.orm-project.yaml`, each domain or one chosen with `--domain`). The query
 * is expressed in the query DSL (see @barwise/core query/parse). Returns
 * structured information about entities, fact types, constraints, and
 * their relationships.
 */

import {
  formatQueryResult,
  parseQuery,
  QUERY_COMMANDS,
  queryModel,
  QueryParseError,
} from "@barwise/core/query";
import type { Command } from "commander";
import { resolveDomainModels } from "../workspace/domainModels.js";

/**
 * Reassemble variadic CLI tokens into a single query string. Tokens that
 * contain whitespace are re-quoted so the query parser sees them as one
 * argument, matching what the shell already split for us.
 */
function joinQueryParts(parts: string[]): string {
  return parts
    .map((p) => (/\s/.test(p) ? `"${p}"` : p))
    .join(" ");
}

export function registerQueryCommand(program: Command): void {
  program
    .command("query")
    .description("Run a deterministic symbolic query against an ORM model")
    .argument("<source>", "Path to .orm.yaml or .orm-project.yaml file")
    .argument(
      "[query...]",
      `Query DSL expression. Commands: ${QUERY_COMMANDS.join(", ")}`,
    )
    .option("--json", "Output as JSON instead of human-readable text")
    .option("--domain <context>", "For a project, query only this one domain")
    .addHelpText(
      "after",
      "\nExamples:\n"
        + "  barwise query model.orm.yaml entities\n"
        + "  barwise query model.orm.yaml entity Customer\n"
        + '  barwise query model.orm.yaml fact-type "Customer places Order"\n'
        + "  barwise query model.orm.yaml path Customer Product\n"
        + "  barwise query model.orm.yaml stats",
    )
    .action((source: string, queryParts: string[], opts: { json?: boolean; domain?: string; }) => {
      try {
        if (queryParts.length === 0) {
          process.stderr.write(
            `Error: no query provided. Commands: ${QUERY_COMMANDS.join(", ")}\n`,
          );
          process.exitCode = 1;
          return;
        }

        const { resolved, problems } = resolveDomainModels(source, opts.domain);
        for (const p of problems) process.stderr.write(`Warning: ${p}\n`);
        const multi = resolved.length > 1;
        const query = parseQuery(joinQueryParts(queryParts));

        if (opts.json) {
          const blocks = resolved.map(({ context, model }) => {
            const result = queryModel(model, query);
            return context ? { domain: context, result } : result;
          });
          process.stdout.write(JSON.stringify(multi ? blocks : blocks[0], null, 2) + "\n");
          return;
        }

        const parts = resolved.map(({ context, model }) => {
          const body = formatQueryResult(queryModel(model, query));
          return multi && context ? `== ${context} ==\n\n${body}` : body;
        });
        process.stdout.write(parts.join("\n\n") + "\n");
      } catch (err) {
        if (err instanceof QueryParseError) {
          process.stderr.write(`Query error: ${err.message}\n`);
        } else {
          process.stderr.write(`Error: ${(err as Error).message}\n`);
        }
        process.exitCode = 1;
      }
    });
}
