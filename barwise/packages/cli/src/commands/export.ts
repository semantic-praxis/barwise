/**
 * barwise export <source> --format <format>
 *
 * Export an ORM model using the format registry. Dispatches to registered
 * export formats (DDL, OpenAPI, etc.) by name.
 */

import {
  getExporter,
  hashModel,
  listExporters,
  updateManifest,
} from "@barwise/core";
import type { ManifestExport } from "@barwise/core";
import { registerDbtFormats } from "@barwise/dbt";
import { registerStandardFormats } from "@barwise/formats";
import type { Command } from "commander";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { loadModel } from "../helpers/io.js";
import { readManifest, writeManifest } from "../helpers/lineageIo.js";

// Register the standard formats (DDL, OpenAPI, Avro, SQL, NORMA).
registerStandardFormats();
// Register the dbt connector format.
registerDbtFormats();

export function registerExportCommand(program: Command): void {
  program
    .command("export")
    .description("Export ORM model in any registered format")
    .argument("<source>", "Path to .orm.yaml file")
    .requiredOption("--format <name>", "Export format (ddl, openapi, etc.)")
    .option("--output <path>", "Write to file instead of stdout")
    .option("--no-annotate", "Exclude TODO/NOTE annotations")
    .option("--strict", "Fail on validation errors")
    .option("--no-examples", "Exclude population examples")
    .action(
      async (
        source: string,
        opts: {
          format: string;
          output?: string;
          annotate: boolean;
          strict: boolean;
          examples: boolean;
        },
      ) => {
        try {
          const model = loadModel(source);

          // Look up the exporter in the unified registry.
          const exporter = getExporter(opts.format);
          if (!exporter) {
            const available = listExporters()
              .map((f) => f.name)
              .join(", ");
            throw new Error(
              `Unknown export format: "${opts.format}". Available formats: ${available}`,
            );
          }

          // Call the exporter's export method.
          const result = exporter.export(model, {
            annotate: opts.annotate,
            strict: opts.strict,
            includeExamples: opts.examples,
          });

          // If --output is specified, write files.
          if (opts.output) {
            if (result.files && result.files.length > 0) {
              // Multi-file format: write all files to output directory.
              mkdirSync(opts.output, { recursive: true });
              for (const file of result.files) {
                const filePath = join(opts.output, file.name);
                const fileDir = dirname(filePath);
                mkdirSync(fileDir, { recursive: true });
                writeFileSync(filePath, file.content, "utf-8");
              }
              process.stdout.write(
                `Wrote ${result.files.length} file(s) to ${opts.output}\n`,
              );
            } else {
              // Single-file format: write text to output path.
              const fileDir = dirname(opts.output);
              mkdirSync(fileDir, { recursive: true });
              writeFileSync(opts.output, result.text, "utf-8");
              process.stdout.write(`Wrote ${opts.output}\n`);
            }

            // Persist lineage manifest adjacent to the source model.
            const modelDir = dirname(resolve(source));
            const modelHash = hashModel(model);
            const artifact = resolve(opts.output);
            const entry: ManifestExport = {
              artifact,
              format: opts.format,
              exportedAt: new Date().toISOString(),
              modelHash,
              sources: result.lineage?.flatMap((l) => l.sources) ?? [],
            };
            writeManifest(modelDir, updateManifest(entry, readManifest(modelDir)));
          } else {
            // No --output: print to stdout.
            process.stdout.write(result.text);
            if (!result.text.endsWith("\n")) {
              process.stdout.write("\n");
            }
          }
        } catch (err) {
          process.stderr.write(`Error: ${(err as Error).message}\n`);
          process.exitCode = 1;
        }
      },
    );
}
