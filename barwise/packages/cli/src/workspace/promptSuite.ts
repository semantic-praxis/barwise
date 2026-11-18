/**
 * Which eval suite a `barwise prompt` command reads, and where its
 * history lives (barwise-fke).
 *
 * The default is the packaged suite as compiled into promptlab, on every
 * build: the CLI no longer works out where the suite's files are, so a
 * single downloaded file needs nothing beside it. History is the one
 * thing that needs a place on disk, and only the operator knows it, so
 * it belongs to a suite named with --suite; its `history.jsonl` lives
 * beside that manifest. In a checkout, recording to the repository's
 * history means `--suite packages/promptlab/evals/suite.yaml` (owner,
 * 2026-11-17).
 */
import { type EvalSuite, historyPathFor, loadPackagedSuite, loadSuite } from "@barwise/promptlab";
import { resolve } from "node:path";

/** The suite `--suite` names, else the packaged one. */
export function resolveSuite(opts: { suite?: string; }): EvalSuite {
  return opts.suite ? loadSuite(resolve(opts.suite)) : loadPackagedSuite();
}

/** Why a suite with no manifest on disk has no history to read or write. */
export const NO_HISTORY = "The packaged eval suite is built into the CLI and has no history"
  + " file. Pass --suite <manifest> to record or read a history; it lives in"
  + " history.jsonl beside that manifest (in a barwise checkout:"
  + " --suite packages/promptlab/evals/suite.yaml).";

/** The suite's history file. Throws for the packaged suite, which has none. */
export function historyPathOf(suite: EvalSuite): string {
  if (suite.manifestPath === undefined) throw new Error(NO_HISTORY);
  return historyPathFor(suite.manifestPath);
}
