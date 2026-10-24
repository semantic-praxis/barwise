/**
 * barwise schema <file>
 *
 * Loads an .orm.yaml file, generates the relational mapping,
 * and prints DDL or JSON to stdout.
 */

import { getExporter } from "@barwise/core";
import { RelationalMapper } from "@barwise/core/mapping";
import { registerStandardFormats } from "@barwise/formats";
import type { Command } from "commander";
import { loadModel } from "../workspace/io.js";
import { writeOutput } from "../workspace/io.js";
import { reportConstraintSpecs } from "./export.js";

registerStandardFormats();

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

        let output: string;
        let report: (() => void) | undefined;
        if (opts.format === "json") {
          const schema = new RelationalMapper().map(model);
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
          // The DDL `export --format ddl --no-annotate --no-examples`
          // writes, so the two commands give one answer for one model, and
          // what the format could not express is reported, not dropped
          // (schema-ddl-routing.spec.md).
          const result = getExporter("ddl")!.export(model, {
            annotate: false,
            includeExamples: false,
          });
          output = result.text;
          report = () => reportConstraintSpecs(result, "ddl");
        }

        writeOutput(output, opts.output);
        report?.();
      } catch (err) {
        process.stderr.write(`Error: ${(err as Error).message}\n`);
        process.exitCode = 1;
      }
    });
}
