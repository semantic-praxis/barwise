#!/usr/bin/env node
/**
 * The risk tier of a diff, and every checklist heading it triggers.
 *
 * WS3 of docs/specs/tiered-pr-review.spec.md (barwise-1038). Reads
 * `review-tiers.json` through `lib/review-tiers.mjs` -- the same parser
 * `check-review-tiers.mjs` uses, because two readings of one table is
 * the must-agree copy CLAUDE.md forbids.
 *
 * This is a CLASSIFIER, not a gate, and its exit codes say so:
 *
 *   0  classified; the tier is on stdout
 *   2  the changed-file list could not be obtained, and no tier is printed
 *
 * There is deliberately no exit 1. A high-risk tier is an answer, not a
 * failure -- the spec's gate contract allows a high-risk PR to merge once
 * a Copilot review has recorded no blocking finding, so mapping the tier
 * onto the exit status would make the classifier disagree with the gate
 * that consumes it. WS4 reads the tier and decides; this only reports.
 *
 * Exit 2 exists for one reading in particular. An empty changed-file list
 * classifies as `routine` under any sane rule, which is precisely what a
 * git invocation that answered about the wrong tree also produces -- a
 * confident "routine, nothing to see" over a diff never examined. A pull
 * request that changes no files is not a state this repository reaches,
 * so an empty list means the question was not asked
 * (docs/specs/gate-refusal-contract.spec.md, and barwise-905's shape).
 *
 * `--files` is how CI will feed the list it already has from the API, and
 * how the tests plant one without a repository. `--base` is for a local
 * run on a branch. Both print the same answer over the same list.
 *
 *   node barwise/scripts/pr-risk.mjs                    # vs origin/main
 *   node barwise/scripts/pr-risk.mjs --base main --json
 *   git diff --name-only A B | node .../pr-risk.mjs --files -
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { classify, isTrivial, TABLE, tierRows, trivialGlobs } from "./lib/review-tiers.mjs";

// `lib/tracked.mjs` resolves the repository root AT IMPORT, and exits 2
// when git cannot answer. That is right for a gate that always needs the
// root, and wrong here: with `--files` this script needs no repository at
// all, which is how CI will call it -- from a list the API already has.
// Imported at the top, it refused before ever reading the list it was
// given. So the git path imports it, and only the git path pays for it.

/**
 * `--flag value`, or the default. No dependency, and no partial matching.
 *
 * A flag PRESENT WITH NO VALUE is refused, not silently defaulted. The
 * first version returned the fallback for both, so `--base` with a typo
 * after it classified against `origin/main` and printed a confident tier
 * for a base the caller never named -- the exact "answered a different
 * question" shape this script's exit-2 contract exists to prevent.
 *
 * A value starting with `--` is treated as a missing value, because every
 * option here takes a path or a git ref and neither begins that way; the
 * realistic case is `--base --json`, where the ref was simply forgotten.
 */
function opt(flag, fallback) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return fallback;
  const value = process.argv[i + 1];
  if (value === undefined || value.startsWith("--")) {
    refuse(
      `${flag} was given with no value`,
      `Found ${value === undefined ? "nothing" : JSON.stringify(value)} after it.`
        + `\n  Defaulting here would classify an input you did not name.`,
    );
  }
  return value;
}

/** Could not answer. Never prints a tier -- that is the whole contract. */
function refuse(what, detail) {
  process.stderr.write(
    `pr-risk: cannot answer -- ${what}\n${detail ? `  ${detail}\n` : ""}`
      + "  No tier printed. A diff this could not read is not a routine diff.\n",
  );
  process.exit(2);
}

/**
 * The changed-file list, from a file, from stdin, or from git.
 *
 * Paths come back exactly as git prints them -- repo-root-relative, with
 * forward slashes -- because that is what the table's patterns are
 * written against. Anything that would need normalising here is a path
 * the table cannot express anyway.
 */
async function changedFiles() {
  const from = opt("--files", null);
  if (from !== null) {
    let raw;
    try {
      raw = from === "-" ? readFileSync(0, "utf8") : readFileSync(from, "utf8");
    } catch (err) {
      refuse(
        from === "-" ? "stdin could not be read" : `cannot read the file list at ${from}`,
        err.message,
      );
    }
    const files = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    // The table's patterns are written against paths exactly as git
    // prints them. A path that is absolute, `./`-prefixed, or carries a
    // `..` matches nothing but the `**` row and still classifies -- a
    // confident `routine` over a list this could not read properly.
    // Neither of the two real producers (`git diff --name-only` and the
    // pull request files API) emits any of those shapes, so one here
    // means the list came from somewhere unexamined.
    const bad = files.filter((f) => f.startsWith("/") || f.startsWith("./") || f.includes(".."));
    if (bad.length > 0) {
      refuse(
        `${bad.length} path(s) are not repo-root-relative as git prints them`,
        `first: ${
          bad[0]
        }\n  Expected e.g. barwise/packages/core/src/x.ts -- no leading '/' or './', no '..'.`,
      );
    }
    return files;
  }

  const base = opt("--base", "origin/main");
  const { REPO_ROOT } = await import("./lib/tracked.mjs");
  try {
    // Three dots: what this branch changed since it diverged, not every
    // difference from the base tip. A two-dot diff would attribute the
    // base's own movement to this PR and misclassify on someone else's
    // commits.
    return execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    })
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch (err) {
    refuse(
      `\`git diff --name-only ${base}...HEAD\` failed`,
      `${err.stderr?.toString().trim().split("\n")[0] ?? err.message}`
        + `\n  A shallow clone or a missing '${base}' both land here.`,
    );
  }
}

let rows, trivial;
try {
  rows = tierRows(opt("--table", TABLE));
  trivial = trivialGlobs(opt("--table", TABLE));
} catch (err) {
  refuse(err.message, err.cause?.message);
}

const files = await changedFiles();
if (files.length === 0) {
  refuse(
    "the changed-file list is empty",
    "A pull request that changes nothing does not occur here, so this is a\n"
      + "  list that was never populated rather than a diff that is genuinely clean.",
  );
}

// `trivial` is a separate question from the tier: it decides whether a
// Copilot review is requested at all (WS1), where the tier decides
// whether one blocks (WS4). Reported side by side because the workflow
// reads one and a person reading the output may want both.
const result = { ...classify(files, rows), trivial: isTrivial(files, trivial) };

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ ...result, fileCount: files.length }, null, 2));
  process.exit(0);
}

const width = Math.max(...result.matched.map((r) => r.tier.length), 0);
console.log(
  `pr-risk: ${result.tier}${result.trivial ? ", trivial" : ""}`
    + `  (${files.length} changed file${files.length === 1 ? "" : "s"})`,
);
console.log();
for (const row of result.matched.sort((a, b) => a.tier.localeCompare(b.tier))) {
  console.log(`  ${row.tier.padEnd(width)}  ${row.heading}`);
  const shown = row.files.slice(0, 3).join(", ");
  const more = row.files.length > 3 ? ` (+${row.files.length - 3} more)` : "";
  console.log(`  ${" ".repeat(width)}  ${shown}${more}`);
}
if (result.beyondReach.length > 0) {
  console.log();
  console.log(
    `  ${result.beyondReach.length} checklist groups are not path-derivable, so a`,
  );
  console.log("  routine tier does NOT mean the checklist is satisfied:");
  for (const row of result.beyondReach) console.log(`    - ${row.heading}`);
}
