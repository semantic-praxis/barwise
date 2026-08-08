/**
 * The score history: one JSON line per eval run, checked into git next
 * to the suite it describes, so drift across model releases is visible
 * in the repository's own history.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SuiteReport } from "../run/runSuite.js";

export interface HistoryEntry {
  /** ISO date of the run, supplied by the caller (no clock in here). */
  readonly date: string;
  readonly suiteVersion: string;
  readonly artifactVersion: string;
  readonly provider?: string;
  readonly model?: string;
  readonly repeat: number;
  readonly mean: number;
  readonly worst: number;
  readonly cases: readonly { caseId: string; mean: number; worst: number; }[];
}

/** The history file that belongs to a suite manifest. */
export function historyPathFor(manifestPath: string): string {
  return join(dirname(manifestPath), "history.jsonl");
}

export function toHistoryEntry(
  report: SuiteReport,
  date: string,
  target?: { provider?: string; model?: string; },
): HistoryEntry {
  return {
    date,
    suiteVersion: report.suiteVersion,
    artifactVersion: report.artifactVersion,
    ...(target?.provider !== undefined ? { provider: target.provider } : {}),
    ...(target?.model !== undefined ? { model: target.model } : {}),
    repeat: report.repeat,
    mean: report.mean,
    worst: report.worst,
    cases: report.cases.map((c) => ({ caseId: c.caseId, mean: c.mean, worst: c.worst })),
  };
}

export function appendHistory(historyPath: string, entry: HistoryEntry): void {
  appendFileSync(historyPath, JSON.stringify(entry) + "\n");
}

export function readHistory(historyPath: string): HistoryEntry[] {
  if (!existsSync(historyPath)) return [];
  return readFileSync(historyPath, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as HistoryEntry);
}
