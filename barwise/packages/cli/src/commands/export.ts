/**
 * barwise export <source> --format <format>
 *
 * Export an ORM model using the format registry, or -- given a
 * `.orm-project.yaml` -- each domain (or one chosen with `--domain`).
 * Dispatches to registered export formats (DDL, OpenAPI, etc.) by name.
 */

import type { ExportFormatAdapter } from "@barwise/core";
import { getExporter, listExporters } from "@barwise/core";
import { hashModel, type ManifestExport, updateManifest } from "@barwise/core/lineage";
import { registerDbtFormats } from "@barwise/dbt";
import { registerStandardFormats } from "@barwise/formats";
import type { Command } from "commander";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { resolveDomainModels } from "../workspace/domainModels.js";
import { isProjectFile, loadModel } from "../workspace/io.js";
import { readManifest, writeManifest } from "../workspace/lineageIo.js";

// Register the standard formats (DDL, OpenAPI, Avro, SQL, NORMA).
registerStandardFormats();
// Register the dbt connector format.
registerDbtFormats();

interface ExportOptions {
  format: string;
  output?: string;
  annotate: boolean;
  strict: boolean;
  examples: boolean;
  domain?: string;
}

export function registerExportCommand(program: Command): void {
  program
    .command("export")
    .description("Export ORM model in any registered format")
    .argument("<source>", "Path to .orm.yaml or .orm-project.yaml file")
    .requiredOption("--format <name>", "Export format (ddl, openapi, etc.)")
    .option("--output <path>", "Write to file (model) or directory (project)")
    .option("--no-annotate", "Exclude TODO/NOTE annotations")
    .option("--strict", "Fail on validation errors")
    .option("--no-examples", "Exclude population examples")
    .option("--domain <context>", "For a project, export only this one domain")
    .action(async (source: string, opts: ExportOptions) => {
      try {
        const exporter = getExporter(opts.format);
        if (!exporter) {
          const available = listExporters().map((f) => f.name).join(", ");
          throw new Error(
            `Unknown export format: "${opts.format}". Available formats: ${available}`,
          );
        }

        if (isProjectFile(source)) {
          exportProject(source, exporter, opts);
          return;
        }

        const model = loadModel(source);
        const result = exporter.export(model, exportOpts(opts));

        if (opts.output) {
          writeExportResult(result, opts.output);

          // Persist lineage manifest adjacent to the source model.
          const modelDir = dirname(resolve(source));
          const entry: ManifestExport = {
            artifact: resolve(opts.output),
            format: opts.format,
            exportedAt: new Date().toISOString(),
            modelHash: hashModel(model),
            sources: result.lineage?.flatMap((l) => l.sources) ?? [],
          };
          writeManifest(modelDir, updateManifest(entry, readManifest(modelDir)));
        } else {
          process.stdout.write(result.text);
          if (!result.text.endsWith("\n")) process.stdout.write("\n");
        }
      } catch (err) {
        process.stderr.write(`Error: ${(err as Error).message}\n`);
        process.exitCode = 1;
      }
    });
}

function exportOpts(opts: ExportOptions) {
  return { annotate: opts.annotate, strict: opts.strict, includeExamples: opts.examples };
}

/** Write a single export result to a file or directory (no lineage manifest). */
function writeExportResult(
  result: ReturnType<ExportFormatAdapter["export"]>,
  output: string,
): void {
  if (result.files && result.files.length > 0) {
    mkdirSync(output, { recursive: true });
    for (const file of result.files) {
      const filePath = join(output, file.name);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, file.content, "utf-8");
    }
    process.stdout.write(`Wrote ${result.files.length} file(s) to ${output}\n`);
  } else {
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, result.text, "utf-8");
    process.stdout.write(`Wrote ${output}\n`);
  }
}

/**
 * Export a project: one domain to `--output`/stdout with `--domain`, else
 * one artifact per domain into the `--output` directory. A single-text
 * format writes `<dir>/<context>.<format>`; a multi-file format writes its
 * files under `<dir>/<context>/`. (Project export does not write a lineage
 * manifest -- lineage is keyed to a single source model.)
 */
function exportProject(source: string, exporter: ExportFormatAdapter, opts: ExportOptions): void {
  const { resolved, problems } = resolveDomainModels(source, opts.domain);
  for (const p of problems) process.stderr.write(`Warning: ${p}\n`);

  if (opts.domain) {
    const { model } = resolved[0]!;
    const result = exporter.export(model, exportOpts(opts));
    if (opts.output) {
      writeExportResult(result, opts.output);
    } else {
      process.stdout.write(result.text);
      if (!result.text.endsWith("\n")) process.stdout.write("\n");
    }
    return;
  }

  if (!opts.output) {
    process.stderr.write("Error: exporting a project requires --output <dir>.\n");
    process.exitCode = 1;
    return;
  }

  mkdirSync(opts.output, { recursive: true });
  const written: string[] = [];
  for (const { context, model } of resolved) {
    const result = exporter.export(model, exportOpts(opts));
    if (result.files && result.files.length > 0) {
      for (const file of result.files) {
        const p = join(opts.output, context ?? "domain", file.name);
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, file.content, "utf-8");
        written.push(p);
      }
    } else {
      const p = join(opts.output, `${context ?? "domain"}.${opts.format}`);
      writeFileSync(p, result.text, "utf-8");
      written.push(p);
    }
  }

  if (written.length === 0) {
    process.stderr.write("Error: no domain models could be exported.\n");
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`Wrote ${written.length} file(s) to ${opts.output}\n`);
}
