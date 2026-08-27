import { annotateOrmYaml } from "@barwise/core/annotation";
import { diffModels, mergeAndValidate } from "@barwise/core/diff";
import {
  buildReasoningTrail,
  createLlmClient,
  MAX_SAMPLES,
  MIN_SAMPLES,
  processTranscript,
  PROVIDER_NAMES,
  sampleTranscript,
  withCallLog,
} from "@barwise/llm";
import type { ProviderName } from "@barwise/llm";
import type { Command } from "commander";
import { randomUUID } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { callLogSink } from "../../workspace/callLogSink.js";
import { readFile, writeOutput } from "../../workspace/io.js";
import { formatAlternativeFramings, serializer } from "./shared.js";

export function addTranscriptSubcommand(importCmd: Command): void {
  importCmd
    .command("transcript")
    .description("Extract an ORM model from a transcript using an LLM")
    .argument("<file>", "Path to transcript file (.md, .txt)")
    .option("--output <file>", "Write .orm.yaml to file instead of stdout")
    .option(
      "--provider <provider>",
      `LLM provider (${PROVIDER_NAMES.join(", ")}). Auto-detects from env vars if omitted.`,
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
    .option(
      "--trail",
      "Write a <model>.trail.json reasoning-trail sidecar (requires --output)",
    )
    .option(
      "--samples <n>",
      `Extract n times (${MIN_SAMPLES}-${MAX_SAMPLES}) and report run-to-run disagreement `
        + `as ambiguities; the emitted model is the sample that agrees most with the others. `
        + `Multiplies LLM cost by n.`,
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
          trail?: boolean;
          samples?: string;
        },
      ) => {
        try {
          const transcript = readFile(file);
          if (!transcript.trim()) {
            process.stderr.write("Error: Transcript file is empty.\n");
            process.exitCode = 1;
            return;
          }

          const samples = opts.samples === undefined ? 1 : Number(opts.samples);
          if (!Number.isInteger(samples) || samples < 1 || samples > MAX_SAMPLES) {
            process.stderr.write(
              `Error: --samples must be an integer between ${MIN_SAMPLES} and ${MAX_SAMPLES}.\n`,
            );
            process.exitCode = 1;
            return;
          }

          // One sink for both records, correlated by this import, so a
          // call's cost and what the pipeline did with its answer sit
          // together in the log. Undefined unless BARWISE_CALL_LOG is
          // set, in which case nothing is wrapped and nothing computed.
          const sink = callLogSink();
          const correlationId = randomUUID();

          const bare = createLlmClient({
            provider: opts.provider as ProviderName | undefined,
            apiKey: opts.apiKey,
            model: opts.model,
            baseUrl: opts.baseUrl,
          });
          const client = sink === undefined
            ? bare
            : withCallLog(bare, sink, { correlationId });

          const modelName = opts.name ?? basename(file, extname(file));

          process.stderr.write(
            samples > 1
              ? `Extracting ORM model from transcript (${samples} samples)...\n`
              : "Extracting ORM model from transcript...\n",
          );

          const processorOptions = {
            modelName,
            alternatives: opts.alternatives,
            ...(sink !== undefined ? { observer: sink, correlationId } : {}),
          };
          // --samples 1 is the plain import, byte-identical to omitting
          // the flag: one call, no agreement machinery.
          const sampled = samples > 1
            ? await sampleTranscript(transcript, client, { ...processorOptions, samples })
            : undefined;
          const result = sampled
            ?? await processTranscript(transcript, client, processorOptions);

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

          if (opts.trail) {
            if (opts.output) {
              const trailPath = opts.output.endsWith(".orm.yaml")
                ? opts.output.replace(/\.orm\.yaml$/, ".trail.json")
                : `${opts.output}.trail.json`;
              writeFileSync(
                trailPath,
                JSON.stringify(buildReasoningTrail(result), null, 2) + "\n",
                "utf-8",
              );
              process.stderr.write(`Reasoning trail written to ${trailPath}.\n`);
            } else {
              process.stderr.write(
                "Note: --trail requires --output; no trail written.\n",
              );
            }
          }

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
          if (sampled) {
            const ok = sampled.samples.filter((o) => o.status === "ok").length;
            const n = sampled.agreement.disagreements.length;
            process.stderr.write(
              `Agreement over ${ok} sample(s): ${sampled.agreement.stable} stable element(s), `
                + `${n} disagreement(s)${n > 0 ? " (reported above as ambiguities)" : ""}.\n`,
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
}
