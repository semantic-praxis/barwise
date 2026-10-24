#!/usr/bin/env node
/**
 * Git merge driver for `.beads/issues.jsonl`
 * (docs/specs/beads-merge-driver.spec.md). Git calls it as
 * `driver.sh %O %A %B %P` and reads the result from %A.
 *
 * Exit status is a contract with the wrapper, beads-merge-driver.sh:
 *   0  merged; %A holds the result
 *   3  merged with conflict blocks for the reported ids; git sees 1
 *   2  an input is malformed; %A untouched, the wrapper line-merges
 * Anything else (node's own 1 for an uncaught exception or a missing
 * module) also sends the wrapper to git's line merge. 1 cannot mean "the
 * driver decided" for exactly that reason: git keeps %A on any non-zero
 * exit, and an unmarked %A is a silent loss of the other side's issues.
 *
 * Installed by install-merge-driver.mjs into the git common directory, so
 * it runs on branches that predate it; bump DRIVER_VERSION with any change
 * to the rules, because the installer never replaces a higher version.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { MalformedInput, resolveTracker } from "./lib/beads-merge.mjs";

export const DRIVER_VERSION = 1;

export const EXIT_MERGED = 0;
export const EXIT_MALFORMED = 2;
export const EXIT_REPORTED = 3;

function main([basePath, curPath, othPath, pathName = ".beads/issues.jsonl"]) {
  if (!basePath || !curPath || !othPath) {
    console.error("beads-merge-driver: usage: beads-merge-driver.mjs %O %A %B [%P]");
    return EXIT_MALFORMED;
  }
  let result;
  try {
    result = resolveTracker(
      readFileSync(basePath, "utf8"),
      readFileSync(curPath, "utf8"),
      readFileSync(othPath, "utf8"),
    );
  } catch (err) {
    if (!(err instanceof MalformedInput)) throw err;
    console.error(`beads-merge-driver: ${pathName}: ${err.message}; falling back to a line merge.`);
    return EXIT_MALFORMED;
  }
  // One write, last: a crash before it leaves %A as git gave it, for the
  // wrapper's line merge, never half-written.
  writeFileSync(curPath, result.text, "utf8");
  if (result.reported.length === 0) return EXIT_MERGED;
  console.error(
    `beads-merge-driver: ${pathName}: ${result.reported.length} issue(s) need a person:`,
  );
  for (const { id, reason } of result.reported) console.error(`  ${id}: ${reason}`);
  console.error(
    "  Each has a conflict block in the file. Keep or edit one candidate line per block,\n"
      + "  then run `npm run check:beads -- --strict` (steward skill, section 1).",
  );
  return EXIT_REPORTED;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
