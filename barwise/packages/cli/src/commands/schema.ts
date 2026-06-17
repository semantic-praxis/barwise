/**
 * barwise schema <file>
 *
 * Loads an .orm.yaml file, generates the relational mapping,
 * and prints DDL or JSON to stdout.
 */

import { RelationalMapper, renderDdl } from "@barwise/core/mapping";
import type { Command } from "commander";
import { loadModel } from "../helpers/io.js";
import { writeOutput } from "../helpers/io.js";

export function registerSchemaCommand(program: Command): void {
  program
    .command("schema")
    .description("Generate relational schema (DDL) from an ORM model")
    .argument("<file>", "Path to .orm.yaml file")
    .option("--format <format>", "Output format (ddl or json)", "ddl")
    .option("--output <file>", "Write output to file instead of stdout")
    .action(async (file: string, opts: { format: string; output?: string; }) => {
      // Print deprecation notice to stderr.
      process.stderr.write(
        "Note: 'barwise schema' is deprecated. Use 'barwise export --format ddl' instead.\n\n",
      );

      try {
        const model = loadModel(file);
        const mapper = new RelationalMapper();
        const schema = mapper.map(model);

        let output: string;
        if (opts.format === "json") {
          output = JSON.stringify(
            {
              tables: schema.tables.map((t) => ({
                name: t.name,
                columns: t.columns.map((c) => ({
                  name: c.name,
                  dataType: c.dataType,
                  nullable: c.nullable,
                })),
                primaryKey: t.primaryKey,
                foreignKeys: t.foreignKeys,
              })),
            },
            null,
            2,
          );
        } else {
          output = renderDdl(schema);
        }

        writeOutput(output, opts.output);
      } catch (err) {
        process.stderr.write(`Error: ${(err as Error).message}\n`);
        process.exitCode = 1;
      }
    });
}
