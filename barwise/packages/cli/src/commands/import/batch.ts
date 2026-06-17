import { annotateOrmYaml } from "@barwise/core";
import { createLlmClient, processTranscript } from "@barwise/llm";
import type { ProviderName } from "@barwise/llm";
import type { Command } from "commander";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { readFile } from "../../helpers/io.js";
import { serializer, slugifyModel } from "./shared.js";

export function addBatchSubcommand(importCmd: Command): void {
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
