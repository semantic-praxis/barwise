/**
 * barwise query <source> <query...>
 *
 * Run a symbolic, deterministic query against an ORM model. The query
 * is expressed in the query DSL (see @barwise/core query/parse). Returns
 * structured information about entities, fact types, constraints, and
 * their relationships.
 */

import { formatQueryResult, parseQuery, QUERY_COMMANDS, queryModel } from "@barwise/core";
import { QueryParseError } from "@barwise/core";
import type { Command } from "commander";
import { loadModel } from "../helpers/io.js";

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
    .argument("<source>", "Path to .orm.yaml file")
    .argument(
      "[query...]",
      `Query DSL expression. Commands: ${QUERY_COMMANDS.join(", ")}`,
    )
    .option("--json", "Output as JSON instead of human-readable text")
    .addHelpText(
      "after",
      "\nExamples:\n"
        + "  barwise query model.orm.yaml entities\n"
        + "  barwise query model.orm.yaml entity Customer\n"
        + '  barwise query model.orm.yaml fact-type "Customer places Order"\n'
        + "  barwise query model.orm.yaml path Customer Product\n"
        + "  barwise query model.orm.yaml stats",
    )
    .action((source: string, queryParts: string[], opts: { json?: boolean; }) => {
      try {
        if (queryParts.length === 0) {
          process.stderr.write(
            `Error: no query provided. Commands: ${QUERY_COMMANDS.join(", ")}\n`,
          );
          process.exitCode = 1;
          return;
        }

        const model = loadModel(source);
        const query = parseQuery(joinQueryParts(queryParts));
        const result = queryModel(model, query);

        if (opts.json) {
          process.stdout.write(JSON.stringify(result, null, 2) + "\n");
        } else {
          process.stdout.write(formatQueryResult(result) + "\n");
        }
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
