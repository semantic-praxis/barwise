import { getImporter, OrmYamlSerializer } from "@barwise/core";
import { SQL_DIALECTS } from "@barwise/core/sql";
import type { Command } from "commander";
import { statSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { readFile, writeOutput } from "../../workspace/io.js";

export function addSqlSubcommand(importCmd: Command): void {
  // SQL file/directory import
  importCmd
    .command("sql")
    .description("Import ORM model from raw SQL files")
    .argument("<source>", "Path to SQL file or directory of SQL files")
    .option("--output <file>", "Write .orm.yaml to file instead of stdout")
    .option("--name <name>", "Model name (defaults to filename/dirname)")
    .option(
      "--dialect <dialect>",
      `SQL dialect (${SQL_DIALECTS.join(", ")})`,
    )
    .option(
      "--infer-references",
      "Read a column named after another table's key, with its type, as a reference to it (each one is reported)",
    )
    .action(
      async (
        source: string,
        opts: {
          output?: string;
          name?: string;
          dialect?: string;
          inferReferences?: boolean;
        },
      ) => {
        try {
          const resolvedSource = resolve(source);

          const format = getImporter("sql");
          if (!format) {
            process.stderr.write(
              "Error: sql import format not registered.\n",
            );
            process.exitCode = 1;
            return;
          }

          const modelName = opts.name ?? basename(resolvedSource, extname(resolvedSource));
          const importOpts: Record<string, unknown> = { modelName };
          if (opts.dialect) {
            importOpts["dialect"] = opts.dialect;
          }
          if (opts.inferReferences) importOpts["inferReferences"] = true;

          process.stderr.write(
            `Importing ORM model from SQL: ${resolvedSource}\n`,
          );

          // Detect if source is a file or directory. Only the stat is
          // guarded here: a parse error, such as an unsupported dialect, is
          // reported as itself by the outer handler, not as "Cannot access".
          let sourceStat;
          try {
            sourceStat = statSync(resolvedSource);
          } catch (statErr) {
            process.stderr.write(
              `Error: Cannot access "${resolvedSource}": ${(statErr as Error).message}\n`,
            );
            process.exitCode = 1;
            return;
          }
          let result;
          if (sourceStat.isDirectory()) {
            if (!format.parseAsync) {
              process.stderr.write(
                "Error: sql format does not support directory parsing.\n",
              );
              process.exitCode = 1;
              return;
            }
            result = await format.parseAsync(resolvedSource, importOpts);
          } else {
            if (!format.parse) {
              process.stderr.write(
                "Error: sql format does not support text parsing.\n",
              );
              process.exitCode = 1;
              return;
            }
            const input = readFile(resolvedSource);
            result = format.parse(input, importOpts);
          }

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
