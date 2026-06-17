import { getImporter, OrmYamlSerializer } from "@barwise/core";
import type { Command } from "commander";
import { basename, resolve } from "node:path";
import { writeOutput } from "../../helpers/io.js";

export function addDbtSubcommand(importCmd: Command): void {
  // Directory-based import (dbt project)
  importCmd
    .command("dbt")
    .description("Import ORM model from a dbt project directory")
    .argument("<dir>", "Path to dbt project directory")
    .option("--output <file>", "Write .orm.yaml to file instead of stdout")
    .option("--name <name>", "Model name (defaults to directory name)")
    .action(
      async (
        dir: string,
        opts: {
          output?: string;
          name?: string;
        },
      ) => {
        try {
          const resolvedDir = resolve(dir);

          const format = getImporter("dbt");
          if (!format) {
            process.stderr.write(
              "Error: dbt import format not registered.\n",
            );
            process.exitCode = 1;
            return;
          }

          if (!format.parseAsync) {
            process.stderr.write(
              "Error: dbt format does not support async parsing.\n",
            );
            process.exitCode = 1;
            return;
          }

          const modelName = opts.name ?? basename(resolvedDir);

          process.stderr.write(
            `Importing ORM model from dbt project: ${resolvedDir}\n`,
          );

          // The tool layer (not core) reads the environment for dbt
          // dialect detection and passes it in explicitly.
          const result = await format.parseAsync(resolvedDir, {
            modelName,
            dbtTargetType: process.env["DBT_TARGET_TYPE"] ?? process.env["DBT_ADAPTER"],
            dbtProfilesHome: process.env["HOME"] ?? process.env["USERPROFILE"],
          });

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
