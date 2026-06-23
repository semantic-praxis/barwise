import { getImporter, OrmYamlSerializer } from "@barwise/core";
import type { Command } from "commander";
import { basename, resolve } from "node:path";
import { writeOutput } from "../../workspace/io.js";

export function addCodeSubcommands(importCmd: Command): void {
  // Directory-based code imports (TypeScript, Java, Kotlin)
  for (const lang of ["typescript", "java", "kotlin"] as const) {
    const displayName = lang.charAt(0).toUpperCase() + lang.slice(1);

    importCmd
      .command(lang)
      .description(`Import ORM model from a ${displayName} project directory`)
      .argument("<dir>", `Path to ${displayName} project directory`)
      .option("--output <file>", "Write .orm.yaml to file instead of stdout")
      .option("--name <name>", "Model name (defaults to directory name)")
      .option(
        "--lsp-command <cmd>",
        `Custom LSP command (e.g. '${
          lang === "typescript"
            ? "typescript-language-server --stdio"
            : lang === "java"
            ? "jdtls"
            : "kotlin-language-server"
        }')`,
      )
      .action(
        async (
          dir: string,
          opts: {
            output?: string;
            name?: string;
            lspCommand?: string;
          },
        ) => {
          try {
            const resolvedDir = resolve(dir);

            const format = getImporter(lang);
            if (!format) {
              process.stderr.write(
                `Error: ${displayName} import format not registered.\n`,
              );
              process.exitCode = 1;
              return;
            }

            if (!format.parseAsync) {
              process.stderr.write(
                `Error: ${displayName} format does not support async parsing.\n`,
              );
              process.exitCode = 1;
              return;
            }

            const modelName = opts.name ?? basename(resolvedDir);

            process.stderr.write(
              `Importing ORM model from ${displayName} project: ${resolvedDir}\n`,
            );

            const importOpts: Record<string, unknown> = { modelName };
            if (opts.lspCommand) {
              importOpts["lspCommand"] = opts.lspCommand;
            }

            const result = await format.parseAsync(resolvedDir, importOpts);

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
}
