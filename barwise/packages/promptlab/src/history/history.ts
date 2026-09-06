/**
 * The score history: one JSON line per eval run, checked into git next
 * to the suite it describes, so drift across model releases is visible
 * in the repository's own history.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SuiteReport } from "../run/runSuite.js";

/**
 * What built the run, supplied by the caller.
 *
 * Separate from `promptHash` because the two have different authors and
 * answer different questions. The hash is computed by this package from
 * bytes it rendered and says whether the prompt was the same; `build`
 * is handed in by the CLI and says whether the rest of the system was
 * -- the scorer, the weights, the reference models and the evaluator
 * all move a score without touching a prompt. Keeping the seam visible
 * in the shape lets a reader tell which fields this package vouches
 * for.
 */
export interface BuildProvenance {
  /** The barwise version that ran. Always known to the CLI. */
  readonly version: string;
  /** Git commit, absent when the run was not from a barwise checkout. */
  readonly commit?: string;
  /**
   * Whether the working tree carried uncommitted changes. Load-bearing:
   * a commit recorded against a modified tree names a revision that
   * never produced the run, and nothing downstream could detect it.
   */
  readonly dirty?: boolean;
}

export interface HistoryEntry {
  /** ISO date of the run, supplied by the caller (no clock in here). */
  readonly date: string;
  readonly suiteVersion: string;
  readonly artifactVersion: string;
  /**
   * Fingerprint of the prompt that ran. Optional only because rows
   * written before the field exist; every new row carries one.
   */
  readonly promptHash?: string;
  /** What built the run. Absent on rows written before the field. */
  readonly build?: BuildProvenance;
  readonly provider?: string;
  readonly model?: string;
  /**
   * Extended-thinking budget the run's calls carried
   * (docs/specs/thinking-budget-dimension.spec.md). Recorded because
   * it changes scores without changing promptHash, provider or model;
   * absent means no thinking parameter was sent, which is what every
   * row written before the field means.
   */
  readonly thinkingBudget?: number;
  readonly repeat: number;
  /**
   * Which half of the suite ran. Absent means all of it, which is what
   * every row written before splits existed means.
   */
  readonly split?: string;
  readonly mean: number;
  readonly worst: number;
  /**
   * Standard error of `mean`. Absent on a run whose cases had one
   * sample each, and on every row written before this field existed --
   * in both cases because the precision genuinely is not known, which
   * is the honest thing for an old row to say (barwise-814).
   */
  readonly standardError?: number;
  /**
   * Tokens the run consumed, totalled across every call.
   *
   * Unlike every other field here, this says nothing about whether two
   * rows are comparable -- caching is score-neutral, since the model
   * sees identical tokens either way. It earns its place on a different
   * ground: cost is a longitudinal question, and these four numbers let
   * a later reader reconstruct it against whatever price table exists
   * then, without this package committing to one now.
   *
   * `prompt` is the provider's own input count and excludes the cached
   * portion on Anthropic, so the input a run actually sent is roughly
   * `prompt + cacheRead + cacheWrite`. Absent on rows written before
   * this field, and on providers that report no usage.
   */
  readonly tokens?: {
    readonly prompt: number;
    readonly completion: number;
    readonly cacheRead?: number;
    readonly cacheWrite?: number;
  };
  /**
   * Runs behind each case's mean. Equal to `repeat` on a healthy run;
   * present so a later reader can tell a full sample from a partial one
   * rather than inferring it (barwise-806).
   */
  /**
   * Which validation rules warned across the run, and how often.
   *
   * Unlike `tokens`, which needed an argument because caching is
   * score-neutral, this needs none: warnings are score-constitutive and
   * were roughly 80% of everything lost on the first baseline. A row
   * carrying a mean without them cannot answer whether the score moved
   * because warnings fell or because a rubric check began passing --
   * different achievements that one number conflates.
   *
   * Suite level, not per case: seven rules across seven cases is
   * forty-nine numbers answering a question nobody asks per case.
   */
  readonly warningsByRule?: Readonly<Record<string, number>>;
  /**
   * Which validation rules errored, and how often, across the run.
   *
   * Recorded for the same reason as the warning tally and with a
   * stronger case: an error weighs 0.1 against a warning's 0.05, and
   * the row carried the count without the identity. Comparing two rows
   * could say the errors went from four to one and never which three
   * stopped firing -- so a fix could not be credited from the record,
   * only from a fresh paid run
   * (docs/specs/pipeline-observability.spec.md).
   */
  readonly errorsByRule?: Readonly<Record<string, number>>;
  /**
   * Which conformance checks fired across the run, and how often.
   *
   * Completes the trio: a row can now say why a mean is what it is
   * across all three penalty kinds rather than two. On the recorded
   * answer keys every correction is one category, which a lump count
   * could never have shown.
   */
  readonly correctionsByCategory?: Readonly<Record<string, number>>;
  readonly cases: readonly {
    caseId: string;
    mean: number;
    worst: number;
    samples?: number;
    sd?: number;
    /**
     * What the case paid, averaged over its scored samples. These
     * decompose the mean beside it: a case can lose to a failed rubric
     * check, to conformance corrections, or to warnings, and the three
     * call for entirely different work.
     */
    penalties?: {
      corrections: number;
      errors: number;
      warnings: number;
    };
  }[];
}

/** The history file that belongs to a suite manifest. */
export function historyPathFor(manifestPath: string): string {
  return join(dirname(manifestPath), "history.jsonl");
}

/**
 * The model identifier the runs actually reported, when they agree.
 *
 * A recorded row named whatever the operator typed. `--model
 * claude-sonnet-5` is an alias the provider resolves to a dated
 * snapshot, so two rows a month apart could name the same model and be
 * two different ones, with nothing in the file to say so (barwise-917).
 * The runs carry the provider's own answer; this reads it back.
 *
 * Undefined when the runs disagree, which is not a fallback but a
 * refusal: no single identifier describes a row whose calls were
 * answered by different snapshots, and naming one of them would be
 * worse than naming the alias. The caller's requested value stands in,
 * as it does when no run reported anything at all.
 */
function observedModel(report: SuiteReport): string | undefined {
  const seen = new Set<string>();
  for (const c of report.cases) {
    for (const r of c.runs) {
      if (r.modelUsed !== undefined) seen.add(r.modelUsed);
    }
  }
  return seen.size === 1 ? [...seen][0] : undefined;
}

export function toHistoryEntry(
  report: SuiteReport,
  date: string,
  target?: {
    provider?: string;
    model?: string;
    build?: BuildProvenance;
    thinkingBudget?: number;
  },
): HistoryEntry {
  // The provider's answer wins over the request string; the request
  // stands in only when nothing was reported or the runs disagree.
  const model = observedModel(report) ?? target?.model;
  return {
    date,
    suiteVersion: report.suiteVersion,
    artifactVersion: report.artifactVersion,
    promptHash: report.promptHash,
    ...(target?.build !== undefined ? { build: target.build } : {}),
    ...(target?.provider !== undefined ? { provider: target.provider } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(target?.thinkingBudget !== undefined
      ? { thinkingBudget: target.thinkingBudget }
      : {}),
    repeat: report.repeat,
    ...(report.split !== undefined ? { split: report.split } : {}),
    ...(tokenTotals(report) ?? {}),
    mean: report.mean,
    worst: report.worst,
    ...(report.dispersion.standardError !== undefined
      ? { standardError: report.dispersion.standardError }
      : {}),
    ...(Object.keys(report.warningsByRule ?? {}).length > 0
      ? { warningsByRule: report.warningsByRule }
      : {}),
    ...(Object.keys(report.errorsByRule ?? {}).length > 0
      ? { errorsByRule: report.errorsByRule }
      : {}),
    ...(Object.keys(report.correctionsByCategory ?? {}).length > 0
      ? { correctionsByCategory: report.correctionsByCategory }
      : {}),
    cases: report.cases.map((c) => ({
      caseId: c.caseId,
      mean: c.mean,
      worst: c.worst,
      samples: c.samples,
      ...(c.sd !== undefined ? { sd: c.sd } : {}),
      ...(penaltiesOf(c) ?? {}),
    })),
  };
}

/**
 * Refuse to record a run the provider did not fully answer
 * (barwise-806). The history file is the project's only longitudinal
 * record, and a row whose mean rests on fewer samples than it asked
 * for -- or on none at all -- is read later as a measurement. Better no
 * row than a row nobody can distinguish from a real one.
 */
export function appendHistory(historyPath: string, entry: HistoryEntry): void {
  appendFileSync(historyPath, JSON.stringify(entry) + "\n");
}

/** Thrown instead of recording an incomplete run. */
export class IncompleteRunError extends Error {
  constructor(public readonly failures: number, public readonly requested: number) {
    super(
      `Refusing to record this run: ${failures} of ${requested} requested runs`
        + ` never returned a payload, so the means rest on fewer samples than`
        + ` they claim. Re-run once the provider is healthy, or record it`
        + ` deliberately with --force.`,
    );
    this.name = "IncompleteRunError";
  }
}

/**
 * Record a completed run. Throws `IncompleteRunError` when any run
 * failed, unless the caller explicitly overrides.
 */
export function appendRunHistory(
  historyPath: string,
  report: SuiteReport,
  entry: HistoryEntry,
  options?: { force?: boolean; },
): void {
  if (!report.complete && options?.force !== true) {
    const requested = report.repeat * report.cases.length;
    throw new IncompleteRunError(report.failures, requested);
  }
  appendHistory(historyPath, entry);
}

export function readHistory(historyPath: string): HistoryEntry[] {
  if (!existsSync(historyPath)) return [];
  return readFileSync(historyPath, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as HistoryEntry);
}

/**
 * Totals across every call of the run, or nothing when no provider
 * reported usage at all. Cache figures are folded in only when a
 * provider reported them, so a row from a provider with no cache does
 * not claim it read zero.
 */
function tokenTotals(
  report: SuiteReport,
): { tokens: NonNullable<HistoryEntry["tokens"]>; } | undefined {
  const runs = report.cases.flatMap((c) => c.runs);
  const sum = (pick: (r: (typeof runs)[number]) => number | undefined): number =>
    runs.reduce((total, r) => total + (pick(r) ?? 0), 0);

  const prompt = sum((r) => r.promptTokens);
  const completion = sum((r) => r.outputTokens);
  if (prompt === 0 && completion === 0) return undefined;

  return {
    tokens: {
      prompt,
      completion,
      ...(report.cache !== undefined
        ? { cacheRead: report.cache.readTokens, cacheWrite: report.cache.writeTokens }
        : {}),
    },
  };
}

/**
 * A case's average penalty counts, or nothing when it produced no
 * scored sample. Averaged rather than totalled so the figures sit on
 * the same scale as the mean they explain, whatever `repeat` was.
 */
function penaltiesOf(
  c: SuiteReport["cases"][number],
): { penalties: { corrections: number; errors: number; warnings: number; }; } | undefined {
  const scored = c.runs.filter((r) => r.score !== undefined).map((r) => r.score!);
  if (scored.length === 0) return undefined;
  const mean = (pick: (s: (typeof scored)[number]) => number): number =>
    scored.reduce((sum, s) => sum + pick(s), 0) / scored.length;
  return {
    penalties: {
      corrections: mean((s) => s.conformanceCorrections),
      errors: mean((s) => s.validationErrors),
      warnings: mean((s) => s.validationWarnings),
    },
  };
}
