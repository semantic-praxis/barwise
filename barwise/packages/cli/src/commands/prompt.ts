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
import type { RunProgress, SuiteReport } from "@barwise/promptlab";
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
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
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
    .option(
      "--max-tokens <n>",
      "Output-token ceiling for every call. Omitted, each case derives one"
        + " from its transcript length.",
    )
    .option(
      "--save-payloads <dir>",
      "Write the payload of any collapsed or unscorable run to this directory,"
        + " so a rare failure leaves something to read.",
    )
    .option(
      "--context-window <n>",
      "Context window in tokens (ollama only). Omitted, one is derived per"
        + " call; set it when the machine cannot afford the derived size.",
    )
    .option("--format <format>", "Output format (text or json)", "text")
    .option(
      "--verbose",
      "Report each sample as it completes, and each retry as it happens",
    )
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
          maxTokens?: string;
          contextWindow?: string;
          savePayloads?: string;
          format: string;
          verbose?: boolean;
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

          if (opts.split !== undefined && opts.split !== "train" && opts.split !== "dev") {
            throw new Error(`Unknown split "${opts.split}". Use "train" or "dev".`);
          }
          // Validated before the first call, like the split above: a
          // typo that reaches the provider costs a sweep to discover.
          let maxTokens: number | undefined;
          if (opts.maxTokens !== undefined) {
            maxTokens = Number(opts.maxTokens);
            if (!Number.isInteger(maxTokens) || maxTokens < 1) {
              throw new Error(
                `--max-tokens must be a positive integer, got "${opts.maxTokens}".`,
              );
            }
          }
          let contextWindow: number | undefined;
          if (opts.contextWindow !== undefined) {
            contextWindow = Number(opts.contextWindow);
            if (!Number.isInteger(contextWindow) || contextWindow < 1) {
              throw new Error(
                `--context-window must be a positive integer, got "${opts.contextWindow}".`,
              );
            }
          }
          // Constructed after the guards, so a typo in a flag costs
          // nothing rather than a client and a sweep.
          const client = createLlmClient({
            provider: opts.provider as ProviderName | undefined,
            apiKey: opts.apiKey,
            model: opts.model,
            baseUrl: opts.baseUrl,
            ...(contextWindow !== undefined ? { contextWindow } : {}),
          });

          // Progress goes to stderr so `--format json` stays a clean
          // pipe. A sweep is dozens of sequential calls; without this a
          // rate-limited run and a hung one look the same from outside.
          const report = await runSuite(suite, client, {
            ...(artifact !== undefined ? { artifact } : {}),
            ...(opts.split !== undefined ? { split: opts.split as "train" | "dev" } : {}),
            ...(maxTokens !== undefined ? { maxTokens } : {}),
            repeat: Number(opts.repeat),
            ...(opts.verbose === true
              ? { onProgress: (e: RunProgress) => process.stderr.write(renderProgress(e)) }
              : {}),
          });

          // Say it before the scores, so an operator reading the tail of
          // a sweep cannot miss that the numbers rest on fewer samples
          // than they asked for.
          if (!report.complete) {
            const requested = report.repeat * report.cases.length;
            process.stderr.write(
              `WARNING: ${report.failures} of ${requested} runs produced no usable payload.`
                + ` Those runs are excluded from the means below, not scored zero.\n`,
            );
          }
          // Named separately from the failure count because it is the
          // one an operator fixes without touching the provider, and
          // because a truncated answer is the failure that looks least
          // like one: it arrives as well-formed JSON holding almost
          // nothing.
          if (report.truncations > 0) {
            const ceiling = Math.max(
              ...report.cases.flatMap((c) =>
                c.runs.filter((r) => r.truncated === true).map((r) => r.maxTokens ?? 0)
              ),
            );
            process.stderr.write(
              `WARNING: ${report.truncations} run(s) were cut off at the output-token`
                + ` ceiling, so what they measured was the budget, not the prompt.`
                + ` Re-run with --max-tokens above ${ceiling}.\n`,
            );
          }

          // Caching fails silently by construction: below a model's
          // minimum cacheable length nothing errors, the run succeeds,
          // and the only symptom is a bill. Worse than not caching --
          // every call pays the 1.25x write for a read that never comes.
          const cache = report.cache;
          if (cache?.requested === true && cache.readTokens === 0 && totalCalls(report) > 1) {
            process.stderr.write(
              `WARNING: caching was requested but nothing was read back across`
                + ` ${totalCalls(report)} calls, so every call paid the write premium`
                + ` for nothing. Either the prompt prefix fell below the model's`
                + ` minimum cacheable length, or it changed between calls.\n`,
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

          // Written before the history decision: a collapse is the run
          // most worth keeping and the least likely to be recorded,
          // since an incomplete sweep is refused.
          if (opts.savePayloads !== undefined) {
            const written = savePayloads(report, resolve(opts.savePayloads));
            process.stderr.write(
              written === 0
                ? `No collapsed or unscorable runs, so no payloads were written.\n`
                : `Wrote ${written} payload(s) to ${resolve(opts.savePayloads)}.\n`,
            );
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

/**
 * One line per event, on stderr, while the sweep is still running.
 *
 * Deliberately shows the score of each sample rather than a bare
 * counter: a rubric that no extraction can pass is visible three calls
 * in, which is when stopping still saves something. The collapse marker
 * needs the suite's floor, which the runner has already applied.
 */
function renderProgress(e: RunProgress): string {
  if (e.kind === "retry") {
    return `  ${e.caseId} run ${e.run}: attempt ${e.attempt} failed`
      + ` (${e.error}); waiting ${(e.delayMs / 1000).toFixed(1)}s\n`;
  }
  const position = `[${String(e.caseIndex).padStart(2)}/${e.caseCount}]`;
  const run = `run ${e.run}/${e.repeat}`;
  const took = e.latencyMs === undefined ? "" : `  ${(e.latencyMs / 1000).toFixed(1)}s`;
  const tries = e.attempts > 1 ? `  ${e.attempts} attempts` : "";
  // Shown on every line, not just the truncated ones: the run before
  // the first truncation is the one that could have warned, and it can
  // only do that if the pair is always visible.
  const tokens = e.outputTokens === undefined
    ? ""
    : `  ${e.outputTokens}${e.maxTokens === undefined ? "" : `/${e.maxTokens}`} out`;
  // A sweep that is not caching should be stopped in its first minute,
  // not discovered on the bill. Zero is printed rather than hidden --
  // that is the number worth seeing.
  const cached = e.cacheReadTokens === undefined ? "" : `  ${e.cacheReadTokens} cached`;

  if (e.truncated === true) {
    return `${position} ${e.caseId.padEnd(22)} ${run}  TRUNCATED, excluded`
      + `${took}${tokens}${cached}  raise --max-tokens\n`;
  }
  if (e.failed === true) {
    return `${position} ${e.caseId.padEnd(22)} ${run}  FAILED, excluded`
      + `${tries}  ${e.error ?? ""}\n`;
  }
  const score = e.score === undefined ? "  ----" : e.score.toFixed(3).padStart(6);
  const collapse = e.collapsed === true ? "  COLLAPSE" : "";
  const unscorable = e.score !== undefined && e.error !== undefined ? "  unscorable" : "";
  return `${position} ${e.caseId.padEnd(22)} ${run} ${score}${took}${tokens}${cached}${tries}`
    + `${collapse}${unscorable}\n`;
}

/**
 * The penalty terms behind a case's mean, averaged over its scored
 * samples. Printed only when something was actually charged: on a clean
 * case it would be four zeroes of noise.
 *
 * Score is `rubric fraction - 0.02 x corrections - 0.1 x errors
 * - 0.05 x warnings`, with the weights coming from the suite manifest.
 * A reader who can see the rubric checks pass but not these cannot
 * account for the number in front of them.
 */
function renderPenalties(c: SuiteReport["cases"][number]): string {
  const scored = c.runs.filter((r) => r.score !== undefined).map((r) => r.score!);
  if (scored.length === 0) return "";
  const mean = (pick: (s: (typeof scored)[number]) => number): number =>
    scored.reduce((sum, s) => sum + pick(s), 0) / scored.length;

  const parts: string[] = [];
  const push = (label: string, value: number): void => {
    if (value > 0) parts.push(`${label}=${value % 1 === 0 ? value : value.toFixed(1)}`);
  };
  push("corrections", mean((s) => s.conformanceCorrections));
  push("errors", mean((s) => s.validationErrors));
  push("warnings", mean((s) => s.validationWarnings));
  push("excessAmbiguity", mean((s) => s.ambiguityExcess));
  return parts.length > 0 ? `  [${parts.join(" ")}]` : "";
}

/**
 * Write the payloads the runner kept -- the collapsed and unscorable
 * runs -- one file per run, named for the case and sample it came from.
 *
 * Only those runs carry a payload at all: keeping thirty-five to
 * explain the one that needs explaining is how a diagnostic becomes
 * clutter. A collapse that happens one run in five is exactly the event
 * that cannot be reasoned about from its score.
 */
function savePayloads(report: SuiteReport, dir: string): number {
  let written = 0;
  for (const c of report.cases) {
    c.runs.forEach((run, index) => {
      if (run.payload === undefined) return;
      if (written === 0) mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${c.caseId}-run${index + 1}.json`), run.payload);
      written++;
    });
  }
  return written;
}

/** Requested runs, which is what the cache warning counts against. */
function totalCalls(report: SuiteReport): number {
  return report.repeat * report.cases.length;
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
    // Where a score below 1.0 came from, when no rubric check failed.
    // Without it a case reading `mean=0.900` with nothing listed under
    // it is unexplained output -- and the two penalty sources differ
    // fivefold in price, so which one is running changes what to do
    // about it.
    lines.push(
      `${c.caseId}  mean=${c.mean.toFixed(3)}  worst=${
        c.worst.toFixed(3)
      }${sd}${samples}${survived}${renderPenalties(c)}`,
    );
    for (const run of c.runs) {
      if (run.truncated) {
        lines.push(
          `  run truncated at ${run.outputTokens ?? "?"}/${run.maxTokens ?? "?"}`
            + ` output tokens (excluded): ${run.error}`,
        );
      } else if (run.failed) {
        // The identifiers go on their own line rather than into the
        // message: they are what a provider's support asks for, and the
        // SDK message is the field most likely to be reworded.
        lines.push(
          `  run failed (${run.failureKind}, ${run.attempts} attempt(s), excluded):`
            + ` ${run.error}`,
        );
        const detail = [
          run.status === undefined ? undefined : `status=${run.status}`,
          run.errorType === undefined ? undefined : `type=${run.errorType}`,
          run.requestId === undefined ? undefined : `request=${run.requestId}`,
        ].filter((d) => d !== undefined);
        if (detail.length > 0) lines.push(`    ${detail.join("  ")}`);
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
  // On its own line under the suite figure: it says nothing about the
  // score, only about what the run cost to produce.
  // Which rule to attack. The count alone said a run lost 0.30 without
  // saying to what, and the answer keys produce no warnings at all --
  // so this is addressable cost, not a floor.
  // Errors first: they cost twice a warning, and this line is the one
  // that says whether a conformance fix actually landed. Without it the
  // report could say a sweep hit four errors and never which four, so
  // crediting a fix meant paying for a fresh run.
  const errored = Object.entries(report.errorsByRule ?? {})
    .sort((a, b) => b[1] - a[1]);
  if (errored.length > 0) {
    lines.push(
      `  errors:   ${errored.map(([id, n]) => `${id} x${n}`).join(", ")}`,
    );
  }
  // Corrections last: cheapest at 0.02, and the line exists to separate
  // a category worth attacking from one that is merely noticed. On the
  // recorded answer keys every correction is `orphaned_reference_mode`,
  // which a lump count could never have shown.
  const corrected = Object.entries(report.correctionsByCategory ?? {})
    .sort((a, b) => b[1] - a[1]);
  const warned = Object.entries(report.warningsByRule ?? {})
    .sort((a, b) => b[1] - a[1]);
  if (warned.length > 0) {
    lines.push(
      `  warnings: ${warned.map(([id, n]) => `${id} x${n}`).join(", ")}`,
    );
  }
  if (corrected.length > 0) {
    lines.push(
      `  fixed:    ${corrected.map(([id, n]) => `${id} x${n}`).join(", ")}`,
    );
  }
  if (report.cache !== undefined) {
    lines.push(
      `  cache: ${report.cache.readTokens} read, ${report.cache.writeTokens} written`
        + (report.cache.requested ? "" : " (not requested)"),
    );
  }
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
