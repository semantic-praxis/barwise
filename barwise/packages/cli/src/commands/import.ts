/**
 * barwise import transcript <file>
 * barwise import model <source> --format <format>
 * barwise import batch <dir> --model <model> [--model <model>...]
 *
 * Processes transcripts through the LLM extraction pipeline
 * and produces .orm.yaml files.
 */

import { registerCodeFormats } from "@barwise/code-analysis";
import {
  annotateOrmYaml,
  diffModels,
  getImporter,
  mergeAndValidate,
  type ModelDiffResult,
  OrmYamlSerializer,
} from "@barwise/core";
import { registerDbtFormats } from "@barwise/dbt";
import { registerStandardFormats } from "@barwise/formats";
import { createLlmClient, processTranscript } from "@barwise/llm";
import type { CandidateFraming, ProviderName } from "@barwise/llm";
import type { Command } from "commander";
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { readFile, writeOutput } from "../helpers/io.js";

const serializer = new OrmYamlSerializer();

// Register the standard formats (DDL, OpenAPI, Avro, SQL, NORMA).
registerStandardFormats();
// Register code-analysis formats (TypeScript, etc.)
registerCodeFormats();
// Register the dbt connector format.
registerDbtFormats();

/**
 * Slugify a model name for use in output filenames.
 * Lowercase, remove dots, replace spaces/slashes with hyphens,
 * collapse consecutive hyphens.
 */
export function slugifyModel(model: string): string {
  return model
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/[\s/]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

export function registerImportCommand(program: Command): void {
  const importCmd = program
    .command("import")
    .description("Import data into ORM models");

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

  // SQL file/directory import
  importCmd
    .command("sql")
    .description("Import ORM model from raw SQL files")
    .argument("<source>", "Path to SQL file or directory of SQL files")
    .option("--output <file>", "Write .orm.yaml to file instead of stdout")
    .option("--name <name>", "Model name (defaults to filename/dirname)")
    .option(
      "--dialect <dialect>",
      "SQL dialect (ansi, snowflake, bigquery, postgres, mysql, redshift, databricks)",
    )
    .action(
      async (
        source: string,
        opts: {
          output?: string;
          name?: string;
          dialect?: string;
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

          process.stderr.write(
            `Importing ORM model from SQL: ${resolvedSource}\n`,
          );

          // Detect if source is a file or directory
          let result;
          try {
            const sourceStat = statSync(resolvedSource);
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
          } catch (statErr) {
            process.stderr.write(
              `Error: Cannot access "${resolvedSource}": ${(statErr as Error).message}\n`,
            );
            process.exitCode = 1;
            return;
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

  importCmd
    .command("transcript")
    .description("Extract an ORM model from a transcript using an LLM")
    .argument("<file>", "Path to transcript file (.md, .txt)")
    .option("--output <file>", "Write .orm.yaml to file instead of stdout")
    .option(
      "--provider <provider>",
      "LLM provider (anthropic, openai, ollama). Auto-detects from env vars if omitted.",
    )
    .option("--model <model>", "Model override for the LLM provider")
    .option("--api-key <key>", "API key (falls back to env vars)")
    .option(
      "--base-url <url>",
      "Ollama server URL (only for ollama provider)",
    )
    .option("--name <name>", "Model name (defaults to filename)")
    .option("--no-annotate", "Skip TODO/NOTE annotations in output")
    .option(
      "--alternatives",
      "Also report one alternative framing at the top structural fork",
    )
    .action(
      async (
        file: string,
        opts: {
          output?: string;
          provider?: string;
          model?: string;
          apiKey?: string;
          baseUrl?: string;
          name?: string;
          annotate: boolean;
          alternatives?: boolean;
        },
      ) => {
        try {
          const transcript = readFile(file);
          if (!transcript.trim()) {
            process.stderr.write("Error: Transcript file is empty.\n");
            process.exitCode = 1;
            return;
          }

          const client = createLlmClient({
            provider: opts.provider as ProviderName | undefined,
            apiKey: opts.apiKey,
            model: opts.model,
            baseUrl: opts.baseUrl,
          });

          const modelName = opts.name ?? basename(file, extname(file));

          process.stderr.write("Extracting ORM model from transcript...\n");

          const result = await processTranscript(transcript, client, {
            modelName,
            alternatives: opts.alternatives,
          });

          // If --output targets an existing file, do a non-interactive merge.
          let finalModel = result.model;
          if (opts.output && existsSync(opts.output)) {
            try {
              const existingYaml = readFile(opts.output);
              const existingModel = serializer.deserialize(existingYaml);
              const diff = diffModels(existingModel, result.model);

              if (diff.hasChanges) {
                // Accept additions and modifications, reject removals.
                const accepted = new Set<number>();
                for (let i = 0; i < diff.deltas.length; i++) {
                  const d = diff.deltas[i]!;
                  if (d.kind === "added" || d.kind === "modified") {
                    accepted.add(i);
                  }
                }

                const mergeResult = mergeAndValidate(
                  existingModel,
                  result.model,
                  diff.deltas,
                  accepted,
                );

                if (mergeResult.model) {
                  finalModel = mergeResult.model;
                  if (!mergeResult.isValid) {
                    process.stderr.write(
                      `Warning: Merged model has ${mergeResult.diagnostics.length} validation issue(s).\n`,
                    );
                  }
                } else {
                  process.stderr.write(
                    "Warning: Merge failed, using extracted model directly.\n",
                  );
                }
              } else {
                process.stderr.write(
                  "No changes detected -- existing model is up to date.\n",
                );
                return;
              }
            } catch {
              // Existing file is not a valid model -- overwrite.
            }
          }

          // Serialize.
          const rawYaml = serializer.serialize(finalModel);
          let output: string;
          if (opts.annotate) {
            const annotated = annotateOrmYaml(rawYaml, result);
            output = annotated.yaml;
          } else {
            output = rawYaml;
          }

          writeOutput(output, opts.output);

          // Summary to stderr (so stdout stays clean for piping).
          const ots = result.model.objectTypes.length;
          const fts = result.model.factTypes.length;
          const applied = result.constraintProvenance.filter(
            (c) => c.applied,
          ).length;
          const modelNote = result.modelUsed ? ` (model: ${result.modelUsed})` : "";
          process.stderr.write(
            `Extracted ${ots} object types, ${fts} fact types, ${applied} constraints${modelNote}.\n`,
          );

          if (result.warnings.length > 0) {
            process.stderr.write(`${result.warnings.length} warning(s).\n`);
          }
          if (result.ambiguities.length > 0) {
            process.stderr.write(
              `${result.ambiguities.length} ambiguity(ies) detected.\n`,
            );
          }
          const altSection = formatAlternativeFramings(result.alternatives);
          if (altSection) {
            process.stderr.write(altSection + "\n");
          }
        } catch (err) {
          process.stderr.write(`Error: ${(err as Error).message}\n`);
          process.exitCode = 1;
        }
      },
    );

  importCmd
    .command("batch")
    .description(
      "Run all transcripts in a directory through one or more LLM models",
    )
    .argument("<dir>", "Directory containing .md transcript files")
    .requiredOption(
      "--model <models...>",
      "LLM model names to use (repeatable)",
    )
    .option(
      "--provider <provider>",
      "LLM provider (anthropic, openai, ollama). Auto-detects from env vars if omitted.",
    )
    .option("--api-key <key>", "API key (falls back to env vars)")
    .option(
      "--base-url <url>",
      "Ollama server URL (only for ollama provider)",
    )
    .option("--no-annotate", "Skip TODO/NOTE annotations in output")
    .option(
      "--output-dir <dir>",
      "Write outputs to a different directory (defaults to input directory)",
    )
    .action(
      async (
        dir: string,
        opts: {
          model: string[];
          provider?: string;
          apiKey?: string;
          baseUrl?: string;
          annotate: boolean;
          outputDir?: string;
        },
      ) => {
        const inputDir = resolve(dir);
        if (!existsSync(inputDir)) {
          process.stderr.write(`Error: Directory not found: ${inputDir}\n`);
          process.exitCode = 1;
          return;
        }

        const outputDir = opts.outputDir
          ? resolve(opts.outputDir)
          : inputDir;

        // Discover .md transcripts.
        const transcripts = readdirSync(inputDir)
          .filter((f) => extname(f) === ".md")
          .sort();

        if (transcripts.length === 0) {
          process.stderr.write(
            `Error: No .md transcript files found in ${inputDir}\n`,
          );
          process.exitCode = 1;
          return;
        }

        process.stderr.write(
          `Found ${transcripts.length} transcript(s), ${opts.model.length} model(s) `
            + `-- ${transcripts.length * opts.model.length} combination(s).\n\n`,
        );

        // Results for the summary table.
        interface BatchResult {
          transcript: string;
          model: string;
          objectTypes?: number;
          factTypes?: number;
          constraints?: number;
          error?: string;
        }
        const results: BatchResult[] = [];
        let failures = 0;

        for (const file of transcripts) {
          const transcriptPath = join(inputDir, file);
          const transcriptText = readFile(transcriptPath);
          const transcriptName = basename(file, extname(file));

          if (!transcriptText.trim()) {
            process.stderr.write(`Skipping empty transcript: ${file}\n`);
            for (const model of opts.model) {
              results.push({
                transcript: file,
                model,
                error: "Empty transcript",
              });
              failures++;
            }
            continue;
          }

          for (const model of opts.model) {
            const slug = slugifyModel(model);
            const outputFile = join(
              outputDir,
              `${transcriptName}-${slug}.orm.yaml`,
            );

            process.stderr.write(
              `[${results.length + 1}/${transcripts.length * opts.model.length}] `
                + `${file} x ${model} ... `,
            );

            try {
              const client = createLlmClient({
                provider: opts.provider as ProviderName | undefined,
                apiKey: opts.apiKey,
                model,
                baseUrl: opts.baseUrl,
              });

              const result = await processTranscript(transcriptText, client, {
                modelName: transcriptName,
              });

              // Serialize.
              const rawYaml = serializer.serialize(result.model);
              let output: string;
              if (opts.annotate) {
                const annotated = annotateOrmYaml(rawYaml, result);
                output = annotated.yaml;
              } else {
                output = rawYaml;
              }

              writeFileSync(outputFile, output, "utf-8");

              const applied = result.constraintProvenance.filter(
                (c) => c.applied,
              ).length;

              results.push({
                transcript: file,
                model,
                objectTypes: result.model.objectTypes.length,
                factTypes: result.model.factTypes.length,
                constraints: applied,
              });

              process.stderr.write("ok\n");
            } catch (err) {
              const msg = (err as Error).message;
              results.push({
                transcript: file,
                model,
                error: msg,
              });
              failures++;
              process.stderr.write(`FAILED: ${msg}\n`);
            }
          }
        }

        // Summary table.
        process.stderr.write("\n--- Summary ---\n");
        const colWidths = {
          transcript: Math.max(
            "Transcript".length,
            ...results.map((r) => r.transcript.length),
          ),
          model: Math.max(
            "Model".length,
            ...results.map((r) => r.model.length),
          ),
        };

        const header = "Transcript".padEnd(colWidths.transcript)
          + "  "
          + "Model".padEnd(colWidths.model)
          + "  OT  FT  C   Result";
        process.stderr.write(header + "\n");
        process.stderr.write("-".repeat(header.length) + "\n");

        for (const r of results) {
          const line = r.transcript.padEnd(colWidths.transcript)
            + "  "
            + r.model.padEnd(colWidths.model)
            + "  "
            + (r.error
              ? `ERROR: ${r.error}`
              : `${String(r.objectTypes ?? 0).padStart(2)}  ${
                String(r.factTypes ?? 0).padStart(2)
              }  ${String(r.constraints ?? 0).padStart(2)}  ok`);
          process.stderr.write(line + "\n");
        }

        process.stderr.write("\n");
        if (failures > 0) {
          process.stderr.write(
            `${failures} of ${results.length} combination(s) failed.\n`,
          );
          process.exitCode = 1;
        } else {
          process.stderr.write(
            `All ${results.length} combination(s) succeeded.\n`,
          );
        }
      },
    );
}

/**
 * Render the alternative framings as a text section, or an empty string
 * when there are none.
 */
export function formatAlternativeFramings(
  alternatives: readonly CandidateFraming[] | undefined,
): string {
  if (!alternatives || alternatives.length === 0) return "";

  const lines = ["Alternative framings:"];
  for (const alt of alternatives) {
    lines.push(`- ${alt.rationale}`);
    lines.push(`  Resolves: ${alt.ambiguityDescription}`);
    lines.push(`  ${summarizeDiff(alt.diff)}`);
  }
  return lines.join("\n");
}

/** A one-line summary of a diff: counts plus the changed element names. */
function summarizeDiff(diff: ModelDiffResult): string {
  let added = 0;
  let removed = 0;
  let modified = 0;
  const changed: string[] = [];
  for (const d of diff.deltas) {
    const label = "name" in d ? d.name : d.term;
    if (d.kind === "added") {
      added += 1;
      changed.push(label);
    } else if (d.kind === "removed") {
      removed += 1;
    } else if (d.kind === "modified") {
      modified += 1;
      changed.push(label);
    }
  }
  let names = "";
  if (changed.length > 0) {
    const shown = changed.slice(0, 6).join(", ");
    names = ` (${shown}${changed.length > 6 ? ", ..." : ""})`;
  }
  return `Diff vs primary: ${added} added, ${modified} modified, ${removed} removed${names}`;
}
