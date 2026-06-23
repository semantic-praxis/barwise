import { getImporter, OrmYamlSerializer } from "@barwise/core";
import type { Command } from "commander";
import { basename, extname } from "node:path";
import { readFile, writeOutput } from "../../workspace/io.js";

export function addModelSubcommand(importCmd: Command): void {
  // Format-based import (DDL, OpenAPI -- text-based formats)
  importCmd
    .command("model")
    .description("Import ORM model from a text-based format")
    .argument("<source>", "Path to source file")
    .requiredOption("--format <format>", "Format: ddl, openapi, norma")
    .option("--output <file>", "Write .orm.yaml to file instead of stdout")
    .option("--name <name>", "Model name (defaults to filename)")
    .action(
      async (
        source: string,
        opts: {
          format: string;
          output?: string;
          name?: string;
        },
      ) => {
        try {
          const input = readFile(source);
          if (!input.trim()) {
            process.stderr.write("Error: Source file is empty.\n");
            process.exitCode = 1;
            return;
          }

          const format = getImporter(opts.format);
          if (!format) {
            process.stderr.write(
              `Error: Unknown format "${opts.format}". Available: ddl, openapi, norma\n`,
            );
            process.exitCode = 1;
            return;
          }

          if (!format.parse) {
            process.stderr.write(
              `Error: Format "${opts.format}" does not support text input. `
                + "Use a directory-based import command instead.\n",
            );
            process.exitCode = 1;
            return;
          }

          const modelName = opts.name ?? basename(source, extname(source));

          process.stderr.write(
            `Importing ORM model from ${opts.format}...\n`,
          );

          const result = format.parse(input, { modelName });

          // Serialize to YAML
          const serializer = new OrmYamlSerializer();
          const yaml = serializer.serialize(result.model);

          writeOutput(yaml, opts.output);

          // Summary to stderr
          const ots = result.model.objectTypes.length;
          const fts = result.model.factTypes.length;
          process.stderr.write(
            `Imported ${ots} object types, ${fts} fact types.\n`,
          );
          process.stderr.write(`Confidence: ${result.confidence}\n`);

          if (result.warnings.length > 0) {
            process.stderr.write(`${result.warnings.length} warning(s):\n`);
            for (const warning of result.warnings) {
              process.stderr.write(`  - ${warning}\n`);
            }
          }
        } catch (err) {
          process.stderr.write(`Error: ${(err as Error).message}\n`);
          process.exitCode = 1;
        }
      },
    );
}
