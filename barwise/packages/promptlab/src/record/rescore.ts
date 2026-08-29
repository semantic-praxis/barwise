/**
 * Score a recorded round's payloads under the current build
 * (docs/specs/recorded-evidence-commands.spec.md).
 *
 * This is how a scorer change is judged: take the payloads a paid round
 * already produced, score them under today's rules, and report what
 * moved. It ran three times as throwaway scripts before it was code,
 * and its outputs were quoted as findings in three baseline appendices
 * that nobody could re-derive.
 *
 * Deliberately crossing suite versions is the point rather than an
 * error -- the question is what a round WOULD score under today's rules,
 * so the result records both versions and leaves the reader to say what
 * that means. `compare` refuses a version mismatch for the opposite
 * reason: two recorded means across a bump are incomparable, which is
 * what the `suiteVersion` field exists to mark.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { EvalSuite } from "../evalcase/types.js";
import { scoreExtraction } from "../score/scoreExtraction.js";
import { parsePayloadFileName } from "./payloadName.js";

/** One payload, scored. */
export interface PayloadScore {
  /** Path relative to the directory that was rescored. */
  readonly file: string;
  /** The immediate directory holding it -- an arm, in a round tree. */
  readonly arm: string;
  readonly caseId: string;
  /** Zero-based run index, as the filename encodes it. */
  readonly index: number;
  readonly score: number;
  readonly rubricPassed: number;
  readonly rubricTotal: number;
}

/** Everything a rescore of one directory produced. */
export interface RescoreResult {
  /** The suite version the payloads were scored UNDER, now. */
  readonly suiteVersion: string;
  /** Sorted by file, so two runs over an unchanged tree are identical. */
  readonly payloads: readonly PayloadScore[];
}

/** Every `*.json` under `dir`, recursively, as paths relative to it. */
function payloadFiles(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    const rel = prefix === "" ? entry : `${prefix}/${entry}`;
    if (statSync(full).isDirectory()) out.push(...payloadFiles(full, rel));
    else if (entry.endsWith(".json")) out.push(rel);
  }
  return out;
}

/**
 * Score every payload under `dir`.
 *
 * A payload naming a case the manifest does not declare FAILS the whole
 * run rather than being skipped. Skipping is how a re-score silently
 * covers fewer files than it claims, and a count that quietly shrank is
 * exactly the kind of number this command exists to make trustworthy.
 */
export function rescoreDirectory(dir: string, suite: EvalSuite): RescoreResult {
  const byId = new Map(suite.cases.map((c) => [c.evalCase.id, c]));
  const payloads: PayloadScore[] = [];

  for (const file of payloadFiles(dir)) {
    const parsed = parsePayloadFileName(basename(file));
    if (!parsed) continue; // not a payload; a log or a note beside them
    const loaded = byId.get(parsed.caseId);
    if (!loaded) {
      throw new Error(
        `${join(dir, file)}: case "${parsed.caseId}" is not declared in `
          + `${suite.manifestPath}. Rescoring it would report a count smaller `
          + `than the round it claims to cover.`,
      );
    }
    const score = scoreExtraction(readFileSync(join(dir, file), "utf8"), loaded, suite.weights);
    const slash = file.lastIndexOf("/");
    payloads.push({
      file,
      arm: slash === -1 ? "." : file.slice(0, slash),
      caseId: parsed.caseId,
      index: parsed.index,
      score: score.score,
      rubricPassed: score.rubricPassed,
      rubricTotal: score.rubricTotal,
    });
  }

  return { suiteVersion: suite.version, payloads };
}

/** One payload's movement between two rescores. */
export interface PayloadDelta {
  readonly file: string;
  readonly arm: string;
  readonly caseId: string;
  readonly before: number;
  readonly after: number;
  readonly delta: number;
}

/** What changed between two rescores of the same tree. */
export interface RescoreDiff {
  readonly beforeVersion: string;
  readonly afterVersion: string;
  readonly unchanged: number;
  /** Sorted by delta, most negative first. */
  readonly fell: readonly PayloadDelta[];
  /** Sorted by delta, most positive first. */
  readonly rose: readonly PayloadDelta[];
}

/**
 * Diff two rescores of the same payload set.
 *
 * Refuses a differing payload set rather than diffing the intersection.
 * A partial diff understates its own blast radius, and the number it
 * would print -- "N payloads fell" -- reads as a count over the round.
 */
export function diffRescores(before: RescoreResult, after: RescoreResult): RescoreDiff {
  const beforeByFile = new Map(before.payloads.map((p) => [p.file, p]));
  const afterFiles = new Set(after.payloads.map((p) => p.file));
  const missing = [...beforeByFile.keys()].filter((f) => !afterFiles.has(f));
  const added = after.payloads.filter((p) => !beforeByFile.has(p.file)).map((p) => p.file);
  if (missing.length > 0 || added.length > 0) {
    throw new Error(
      "The two rescores cover different payloads, so a diff would understate "
        + `its own coverage. Only in the baseline: ${missing.length}`
        + `${missing.length > 0 ? ` (e.g. ${missing[0]})` : ""}. `
        + `Only in the new run: ${added.length}`
        + `${added.length > 0 ? ` (e.g. ${added[0]})` : ""}.`,
    );
  }

  const fell: PayloadDelta[] = [];
  const rose: PayloadDelta[] = [];
  let unchanged = 0;
  for (const now of after.payloads) {
    const was = beforeByFile.get(now.file)!;
    const delta = now.score - was.score;
    const row: PayloadDelta = {
      file: now.file,
      arm: now.arm,
      caseId: now.caseId,
      before: was.score,
      after: now.score,
      delta,
    };
    // Exact equality: both sides came from the same deterministic scorer,
    // so a tolerance would only hide a real movement too small to see.
    if (delta === 0) unchanged++;
    else if (delta < 0) fell.push(row);
    else rose.push(row);
  }
  fell.sort((a, b) => a.delta - b.delta);
  rose.sort((a, b) => b.delta - a.delta);

  return {
    beforeVersion: before.suiteVersion,
    afterVersion: after.suiteVersion,
    unchanged,
    fell,
    rose,
  };
}
