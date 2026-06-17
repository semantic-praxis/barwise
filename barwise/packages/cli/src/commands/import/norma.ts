import { getImporter, OrmYamlSerializer } from "@barwise/core";
import type { Command } from "commander";
import { basename, extname } from "node:path";
import { readFile, writeOutput } from "../../helpers/io.js";

export function addNormaSubcommand(importCmd: Command): void {
  // NORMA .orm XML import
  importCmd
    .command("norma")
    .description("Import ORM model from a NORMA .orm XML file")
    .argument("<file>", "Path to NORMA .orm XML file")
    .option("--output <file>", "Write .orm.yaml to file instead of stdout")
    .option("--name <name>", "Model name (defaults to filename)")
    .action(
      async (
        file: string,
        opts: {
          output?: string;
          name?: string;
        },
      ) => {
        try {
          const input = readFile(file);
          if (!input.trim()) {
            process.stderr.write("Error: Source file is empty.\n");
            process.exitCode = 1;
            return;
          }

          const format = getImporter("norma");
          if (!format) {
            process.stderr.write(
              "Error: NORMA import format not registered.\n",
            );
            process.exitCode = 1;
            return;
          }

          if (!format.parse) {
            process.stderr.write(
              "Error: NORMA format does not support text input.\n",
            );
            process.exitCode = 1;
            return;
          }

          const modelName = opts.name ?? basename(file, extname(file));

          process.stderr.write(
            `Importing ORM model from NORMA XML: ${file}\n`,
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
