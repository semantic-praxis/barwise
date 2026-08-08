/**
 * barwise prompt eval|score|schema|history
 *
 * Prompt evaluation for the LLM surfaces
 * (docs/specs/prompt-optimization-harness.spec.md). `eval` sweeps the
 * eval suite against a live provider and appends a history row;
 * `score` grades one saved extraction payload (the DSPy metric's entry
 * point); `schema` prints the structured-output JSON Schema the Python
 * lane must reuse; `history` shows the checked-in score record.
 */
import type { PromptArtifact, ProviderName } from "@barwise/llm";
import {
  buildResponseSchema,
  createLlmClient,
  loadArtifactsFromDir,
  resolveArtifact,
} from "@barwise/llm";
import type { SuiteReport } from "@barwise/promptlab";
import {
  appendHistory,
  defaultSuitePath,
  historyPathFor,
  loadSuite,
  readHistory,
  runSuite,
  scoreExtraction,
  toHistoryEntry,
} from "@barwise/promptlab";
import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface ProviderOpts {
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

export function registerPromptCommand(program: Command): void {
  const promptCmd = program
    .command("prompt")
    .description("Evaluate and manage the LLM prompt artifacts");

  registerEval(promptCmd);
  registerScore(promptCmd);
  registerSchema(promptCmd);
  registerHistory(promptCmd);
}

function suitePath(opts: { suite?: string; }): string {
  return opts.suite ? resolve(opts.suite) : defaultSuitePath();
}

/** `barwise prompt eval` */
function registerEval(promptCmd: Command): void {
  promptCmd
    .command("eval")
    .description("Run the eval suite against a provider and record the scores")
    .option("--suite <manifest>", "Suite manifest (defaults to the packaged suite)")
    .option(
      "--provider <provider>",
      "LLM provider (anthropic, openai, ollama). Auto-detects from env vars if omitted.",
    )
    .option("--model <model>", "Model override for the LLM provider")
    .option("--api-key <key>", "API key (falls back to env vars)")
    .option("--base-url <url>", "Ollama server URL (only for ollama provider)")
    .option("--artifacts <dir>", "Load .prompt.yaml variants from this directory")
    .option("--repeat <n>", "Samples per case", "1")
    .option("--format <format>", "Output format (text or json)", "text")
    .option("--no-history", "Do not append this run to the suite's history file")
    .action(
      async (
        opts: ProviderOpts & {
          suite?: string;
          artifacts?: string;
          repeat: string;
          format: string;
          history: boolean;
        },
      ) => {
        try {
          const suite = loadSuite(suitePath(opts));

          let artifact: PromptArtifact | undefined;
          if (opts.artifacts) {
            const artifacts = loadArtifactsFromDir(resolve(opts.artifacts));
            artifact = resolveArtifact(artifacts, {
              surface: "extraction",
              ...(opts.provider !== undefined ? { provider: opts.provider } : {}),
              ...(opts.model !== undefined ? { model: opts.model } : {}),
            });
          }
          process.stderr.write(
            artifact
              ? `Using artifact version ${artifact.version}.\n`
              : "Using the default prompt artifact.\n",
          );

          const client = createLlmClient({
            provider: opts.provider as ProviderName | undefined,
            apiKey: opts.apiKey,
            model: opts.model,
            baseUrl: opts.baseUrl,
          });

          const report = await runSuite(suite, client, {
            ...(artifact !== undefined ? { artifact } : {}),
            repeat: Number(opts.repeat),
          });

          if (opts.history) {
            const entry = toHistoryEntry(report, new Date().toISOString(), {
              ...(opts.provider !== undefined ? { provider: opts.provider } : {}),
              ...(opts.model !== undefined ? { model: opts.model } : {}),
            });
            appendHistory(historyPathFor(suite.manifestPath), entry);
          }

          if (opts.format === "json") {
            process.stdout.write(JSON.stringify(report, null, 2) + "\n");
            return;
          }
          process.stdout.write(renderReport(report));
        } catch (err) {
          fail(err);
        }
      },
    );
}

/** `barwise prompt score` */
function registerScore(promptCmd: Command): void {
  promptCmd
    .command("score")
    .description("Score one saved extraction payload against an eval case")
    .requiredOption("--case <id>", "Eval case id (see the suite manifest)")
    .requiredOption("--extraction <file>", "File holding the raw extraction JSON payload")
    .option("--suite <manifest>", "Suite manifest (defaults to the packaged suite)")
    .action((opts: { case: string; extraction: string; suite?: string; }) => {
      try {
        const suite = loadSuite(suitePath(opts));
        const loadedCase = suite.cases.find((c) => c.evalCase.id === opts.case);
        if (!loadedCase) {
          const ids = suite.cases.map((c) => c.evalCase.id).join(", ");
          throw new Error(`Unknown case "${opts.case}". Available: ${ids}.`);
        }
        const payload = readFileSync(resolve(opts.extraction), "utf8");
        const score = scoreExtraction(payload, loadedCase, suite.weights);
        process.stdout.write(JSON.stringify(score, null, 2) + "\n");
      } catch (err) {
        fail(err);
      }
    });
}

/** `barwise prompt schema` */
function registerSchema(promptCmd: Command): void {
  promptCmd
    .command("schema")
    .description("Print the structured-output JSON Schema for a surface")
    .option("--surface <surface>", "Prompt surface (extraction)", "extraction")
    .action((opts: { surface: string; }) => {
      try {
        if (opts.surface !== "extraction") {
          throw new Error(
            `Surface "${opts.surface}" has no schema export yet (extraction only).`,
          );
        }
        process.stdout.write(JSON.stringify(buildResponseSchema(false), null, 2) + "\n");
      } catch (err) {
        fail(err);
      }
    });
}

/** `barwise prompt history` */
function registerHistory(promptCmd: Command): void {
  promptCmd
    .command("history")
    .description("Show the suite's recorded eval scores")
    .option("--suite <manifest>", "Suite manifest (defaults to the packaged suite)")
    .option("--format <format>", "Output format (text or json)", "text")
    .action((opts: { suite?: string; format: string; }) => {
      try {
        const suite = loadSuite(suitePath(opts));
        const entries = readHistory(historyPathFor(suite.manifestPath));
        if (opts.format === "json") {
          process.stdout.write(JSON.stringify(entries, null, 2) + "\n");
          return;
        }
        if (entries.length === 0) {
          process.stdout.write("No recorded eval runs.\n");
          return;
        }
        for (const e of entries) {
          const target = [e.provider, e.model].filter(Boolean).join("/") || "(env default)";
          process.stdout.write(
            `${e.date}  artifact=${e.artifactVersion}  ${target}`
              + `  mean=${e.mean.toFixed(3)}  worst=${e.worst.toFixed(3)}  (repeat=${e.repeat})\n`,
          );
        }
      } catch (err) {
        fail(err);
      }
    });
}

function renderReport(report: SuiteReport): string {
  const lines: string[] = [];
  for (const c of report.cases) {
    lines.push(
      `${c.caseId}  mean=${c.mean.toFixed(3)}  worst=${c.worst.toFixed(3)}`,
    );
    for (const run of c.runs) {
      if (run.error) {
        lines.push(`  run failed: ${run.error}`);
      } else if (run.score) {
        for (const r of run.score.results.filter((r) => !r.passed)) {
          lines.push(`  ${r.kind}: ${r.message}`);
        }
      }
    }
  }
  lines.push(
    `suite ${report.suiteVersion}  artifact=${report.artifactVersion}`
      + `  mean=${report.mean.toFixed(3)}  worst=${
        report.worst.toFixed(3)
      }  (repeat=${report.repeat})`,
  );
  return lines.join("\n") + "\n";
}

function fail(err: unknown): void {
  process.stderr.write(`Error: ${(err as Error).message}\n`);
  process.exitCode = 1;
}
