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
  appendRunHistory,
  defaultSuitePath,
  historyPathFor,
  IncompleteRunError,
  loadSuite,
  marginOfError,
  readHistory,
  runSuite,
  scoreExtraction,
  toHistoryEntry,
} from "@barwise/promptlab";
import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describeProvenance, resolveProvenance } from "../workspace/provenance.js";

interface ProviderOpts {
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

export function registerPromptCommand(program: Command, version = "0.0.0-dev"): void {
  const promptCmd = program
    .command("prompt")
    .description("Evaluate and manage the LLM prompt artifacts");

  registerEval(promptCmd, version);
  registerScore(promptCmd);
  registerSchema(promptCmd);
  registerHistory(promptCmd);
}

function suitePath(opts: { suite?: string; }): string {
  return opts.suite ? resolve(opts.suite) : defaultSuitePath();
}

/** `barwise prompt eval` */
function registerEval(promptCmd: Command, version: string): void {
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
    .option(
      "--split <split>",
      "Run only one half of the suite (train or dev). Omitted runs every case.",
    )
    .option("--format <format>", "Output format (text or json)", "text")
    .option("--no-history", "Do not append this run to the suite's history file")
    .option(
      "--force-history",
      "Record the run even when some calls never returned a payload",
    )
    .action(
      async (
        opts: ProviderOpts & {
          suite?: string;
          artifacts?: string;
          repeat: string;
          split?: string;
          format: string;
          history: boolean;
          forceHistory?: boolean;
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

          if (opts.split !== undefined && opts.split !== "train" && opts.split !== "dev") {
            throw new Error(`Unknown split "${opts.split}". Use "train" or "dev".`);
          }
          const report = await runSuite(suite, client, {
            ...(artifact !== undefined ? { artifact } : {}),
            ...(opts.split !== undefined ? { split: opts.split as "train" | "dev" } : {}),
            repeat: Number(opts.repeat),
          });

          // Say it before the scores, so an operator reading the tail of
          // a sweep cannot miss that the numbers rest on fewer samples
          // than they asked for.
          if (!report.complete) {
            const requested = report.repeat * report.cases.length;
            process.stderr.write(
              `WARNING: ${report.failures} of ${requested} runs never returned a payload.`
                + ` Those runs are excluded from the means below, not scored zero.\n`,
            );
          }

          // Print before recording. The run has already been paid for,
          // and a refused history write must not also cost the operator
          // the scores they just bought.
          if (opts.format === "json") {
            process.stdout.write(JSON.stringify(report, null, 2) + "\n");
          } else {
            process.stdout.write(renderReport(report));
          }

          if (opts.history) {
            // A row that will be compared against later should say what
            // it cannot support. A one-off exploratory run is not
            // nagged -- this fires only when the run is being recorded.
            if (report.dispersion.standardError === undefined) {
              process.stderr.write(
                `NOTE: recording a run with no error bar (repeat=${report.repeat}).`
                  + ` A single sample per case cannot resolve a difference against`
                  + ` another row, so treat this one as a spot check, not a baseline.\n`,
              );
            }
            const build = resolveProvenance(version);
            const entry = toHistoryEntry(report, new Date().toISOString(), {
              build,
              ...(opts.provider !== undefined ? { provider: opts.provider } : {}),
              ...(opts.model !== undefined ? { model: opts.model } : {}),
            });
            // Say it while the operator is watching. A row recorded off
            // a modified tree names a commit that never produced it,
            // and by the time anyone reads the file back the working
            // tree is long gone.
            if (build.dirty === true) {
              process.stderr.write(
                `NOTE: recording against a modified working tree`
                  + ` (${describeProvenance(build)}). The commit alone will not`
                  + ` reproduce this run.\n`,
              );
            }
            try {
              appendRunHistory(historyPathFor(suite.manifestPath), report, entry, {
                ...(opts.forceHistory === true ? { force: true } : {}),
              });
            } catch (err) {
              if (!(err instanceof IncompleteRunError)) throw err;
              process.stderr.write(`${err.message}\n`);
            }
          }

          if (!report.complete) process.exitCode = 1;
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
          // This listing is where two runs actually get compared, so
          // the error bar belongs here more than anywhere. Rows written
          // before it existed print "+/- ?" rather than a bare mean --
          // an unknown precision is not the same as a tight one.
          const margin = marginOfError(e.standardError);
          const bar = margin === undefined ? " +/- ?" : ` +/- ${margin.toFixed(3)}`;
          // The hash goes next to the artifact version it can contradict:
          // two rows naming one version with different hashes ran
          // different prompts, and that is the only place it shows.
          const hash = e.promptHash === undefined ? "" : `@${e.promptHash}`;
          const built = e.build === undefined ? "" : `  ${describeProvenance(e.build)}`;
          process.stdout.write(
            `${e.date}  artifact=${e.artifactVersion}${hash}  ${target}`
              + `  mean=${e.mean.toFixed(3)}${bar}  worst=${
                e.worst.toFixed(3)
              }  (repeat=${e.repeat})${built}\n`,
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
    // n= is only interesting when it disagrees with repeat; showing it
    // always would bury the signal it exists to carry.
    const samples = c.samples === report.repeat ? "" : `  n=${c.samples}/${report.repeat}`;
    const sd = c.sd === undefined ? "" : `  sd=${c.sd.toFixed(3)}`;
    // When a floor is declared, the two questions the mean was blending
    // are shown apart: how often it survived, and how good it was when
    // it did (eval-metric-readiness spec).
    const survived = c.collapses === undefined
      ? ""
      : `  ok=${c.samples - c.collapses}/${c.samples}`
        + (c.qualityMean === undefined
          ? "  (no sample survived)"
          : `  quality=${c.qualityMean.toFixed(3)}`
            + (c.qualitySd === undefined ? "" : `+/-${c.qualitySd.toFixed(3)}`));
    lines.push(
      `${c.caseId}  mean=${c.mean.toFixed(3)}  worst=${
        c.worst.toFixed(3)
      }${sd}${samples}${survived}`,
    );
    for (const run of c.runs) {
      if (run.failed) {
        lines.push(
          `  run failed (${run.failureKind}, ${run.attempts} attempt(s), excluded):`
            + ` ${run.error}`,
        );
      } else if (run.error) {
        lines.push(`  unscorable payload (counted as 0): ${run.error}`);
      } else if (run.score) {
        for (const r of run.score.results.filter((r) => !r.passed)) {
          lines.push(`  ${r.kind}: ${r.message}`);
        }
      }
    }
  }
  // The error bar rides on the same line as the mean, deliberately. The
  // defect this closes is people quoting a mean without one, and a
  // figure parked on its own line is a figure that gets left behind.
  const margin = marginOfError(report.dispersion.standardError);
  const bar = margin === undefined
    ? ""
    : ` +/- ${margin.toFixed(3)} (95%${report.dispersion.lowerBound ? ", at least" : ""})`;
  lines.push(
    `suite ${report.suiteVersion}  artifact=${report.artifactVersion}`
      + `@${report.promptHash}`
      + `  mean=${report.mean.toFixed(3)}${bar}  worst=${
        report.worst.toFixed(3)
      }  (repeat=${report.repeat}${report.complete ? "" : `, ${report.failures} failed`})`,
  );
  lines.push(...renderResolution(report));
  return lines.join("\n") + "\n";
}

/**
 * What the run can and cannot tell you. Printed under the suite line
 * because a reader comparing two runs needs it before they subtract.
 */
function renderResolution(report: SuiteReport): string[] {
  const { standardError, resolvableDifference, lowerBound, dominantCase } = report.dispersion;
  const lines: string[] = [];

  if (standardError === undefined) {
    lines.push(
      `  no case has two or more samples, so this run resolves nothing:`
        + ` re-run with --repeat to get an error bar`,
    );
    return lines;
  }

  if (resolvableDifference !== undefined) {
    lines.push(
      resolvableDifference === 0
        ? `  every sample scored identically; any nonzero gap is real at this sample size`
        : `  gaps below ${resolvableDifference.toFixed(3)} are not resolvable`
          + ` against a comparable run`,
    );
  }
  if (lowerBound) {
    lines.push(
      `  some case has under two samples, so the interval above understates the true one`,
    );
  }
  // Naming the case that carries the noise is the actionable half: when
  // one case owns most of the variance, more samples average over a
  // single diagnosable failure instead of measuring the prompt.
  if (dominantCase !== undefined && dominantCase.share > 0.5) {
    lines.push(
      `  ${(dominantCase.share * 100).toFixed(0)}% of that noise is`
        + ` ${dominantCase.caseId} alone`,
    );
  }
  return lines;
}

function fail(err: unknown): void {
  process.stderr.write(`Error: ${(err as Error).message}\n`);
  process.exitCode = 1;
}
