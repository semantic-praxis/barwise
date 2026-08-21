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
  readonly repeat: number;
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
   * Runs behind each case's mean. Equal to `repeat` on a healthy run;
   * present so a later reader can tell a full sample from a partial one
   * rather than inferring it (barwise-806).
   */
  readonly cases: readonly {
    caseId: string;
    mean: number;
    worst: number;
    samples?: number;
    sd?: number;
  }[];
}

/** The history file that belongs to a suite manifest. */
export function historyPathFor(manifestPath: string): string {
  return join(dirname(manifestPath), "history.jsonl");
}

export function toHistoryEntry(
  report: SuiteReport,
  date: string,
  target?: { provider?: string; model?: string; build?: BuildProvenance; },
): HistoryEntry {
  return {
    date,
    suiteVersion: report.suiteVersion,
    artifactVersion: report.artifactVersion,
    promptHash: report.promptHash,
    ...(target?.build !== undefined ? { build: target.build } : {}),
    ...(target?.provider !== undefined ? { provider: target.provider } : {}),
    ...(target?.model !== undefined ? { model: target.model } : {}),
    repeat: report.repeat,
    mean: report.mean,
    worst: report.worst,
    ...(report.dispersion.standardError !== undefined
      ? { standardError: report.dispersion.standardError }
      : {}),
    cases: report.cases.map((c) => ({
      caseId: c.caseId,
      mean: c.mean,
      worst: c.worst,
      samples: c.samples,
      ...(c.sd !== undefined ? { sd: c.sd } : {}),
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
