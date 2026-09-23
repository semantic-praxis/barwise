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
 * Three inputs, one answer over the same changes:
 *
 *   --changes  one pull-request-files API record per line, as JSON
 *              (`{filename, status, previous_filename}`). This is what the
 *              Copilot workflow sends, because it is the only one of the
 *              three that is both exact and carries each file's status.
 *   --files    bare paths, one per line: for a person, and for tests that
 *              plant a list without a repository. It has no status, so it
 *              never reports trivial (`isTrivial` says why).
 *   --base     a local run on a branch, read from git.
 *
 * No input is normalised. A path is read exactly as its producer wrote
 * it, or refused: the first version trimmed each line, so a real file
 * named ` .beads/issues.jsonl` became the tracker, and the Copilot
 * workflow would have skipped its review (a Copilot finding on #533).
 *
 *   node barwise/scripts/pr-risk.mjs                    # vs origin/main
 *   node barwise/scripts/pr-risk.mjs --base main --json
 *   git diff --name-only A...B | node .../pr-risk.mjs --files -
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { classify, isTrivial, TABLE, tierRows, trivialGlobs } from "./lib/review-tiers.mjs";

// `lib/tracked.mjs` resolves the repository root AT IMPORT, and exits 2
// when git cannot answer. That is right for a gate that always needs the
// root, and wrong here: with `--changes` or `--files` this script needs no
// repository at all, which is how CI calls it -- from records the API has.
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

/** The whole of `--changes` or `--files`: a path, or `-` for stdin. */
function readInput(flag, from) {
  try {
    return from === "-" ? readFileSync(0, "utf8") : readFileSync(from, "utf8");
  } catch (err) {
    refuse(
      from === "-" ? "stdin could not be read" : `cannot read the ${flag} input at ${from}`,
      err.message,
    );
  }
}

/** Lines of a text input, with only the empty ones dropped. Never trimmed. */
function lines(raw) {
  return raw.split("\n").filter((l) => l !== "");
}

/**
 * One `--changes` record: `{filename, status, previous_filename}` from the
 * pull request files API. JSON, not a bare name, because JSON is the only
 * line format in which every legal file name -- a leading space, an
 * embedded newline -- survives the trip exactly.
 */
function changeRecord(line, n) {
  let rec;
  try {
    rec = JSON.parse(line);
  } catch (err) {
    refuse(`--changes line ${n} is not JSON`, err.message);
  }
  const str = (v) => typeof v === "string" && v.length > 0;
  if (rec === null || typeof rec !== "object" || !str(rec.filename) || !str(rec.status)) {
    refuse(
      `--changes line ${n} is not a files API record`,
      `Expected {"filename": "...", "status": "...", "previous_filename": ...}; got ${line}`,
    );
  }
  if (rec.previous_filename != null && !str(rec.previous_filename)) {
    refuse(`--changes line ${n} has a previous_filename that is not a path`, line);
  }
  return { path: rec.filename, status: rec.status, previous: rec.previous_filename ?? null };
}

/** `git diff --name-status` letters, in the files API's words. */
const GIT_STATUS = { M: "modified", A: "added", D: "removed", T: "changed" };

/**
 * The changes, as `{ path, status, previous }`, from whichever input was
 * given. `previous` is a rename's source path and is classified too: a
 * file moved OUT of `core/src/` is a change to core.
 */
async function readChanges() {
  const fromChanges = opt("--changes", null);
  const fromFiles = opt("--files", null);
  if (fromChanges !== null && fromFiles !== null) {
    refuse("--changes and --files were both given", "They are two spellings of one input.");
  }
  if (fromChanges !== null) {
    return lines(readInput("--changes", fromChanges)).map((l, i) => changeRecord(l, i + 1));
  }
  if (fromFiles !== null) {
    const files = lines(readInput("--files", fromFiles));
    // Refused, not trimmed. Trimming made a name that begins with a space
    // into a different, allow-listed file; refusing costs only the rare
    // real name with edge whitespace, and a CRLF list, both loudly.
    const padded = files.filter((f) => f !== f.trim());
    if (padded.length > 0) {
      refuse(
        `${padded.length} path(s) in --files begin or end with whitespace`,
        `first: ${JSON.stringify(padded[0])}\n  A bare list cannot say whether that is`
          + " part of the name; --changes can, because it is JSON.",
      );
    }
    return files.map((path) => ({ path, status: null, previous: null }));
  }

  const base = opt("--base", "origin/main");
  const { REPO_ROOT } = await import("./lib/tracked.mjs");
  let out;
  try {
    // Three dots: what this branch changed since it diverged, not every
    // difference from the base tip. A two-dot diff would attribute the
    // base's own movement to this PR and misclassify on someone else's
    // commits. `-z` prints names exactly, unquoted; `--no-renames` turns
    // a rename into its delete and its add, because `--name-only` names
    // only a rename's destination and so lost the path it came from.
    out = execFileSync(
      "git",
      ["diff", "--name-status", "-z", "--no-renames", `${base}...HEAD`],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
      },
    );
  } catch (err) {
    refuse(
      `\`git diff --name-status ${base}...HEAD\` failed`,
      `${err.stderr?.toString().trim().split("\n")[0] ?? err.message}`
        + `\n  A shallow clone or a missing '${base}' both land here.`,
    );
  }
  const fields = out.split("\u0000");
  if (fields.at(-1) === "") fields.pop();
  if (fields.length % 2 !== 0) {
    refuse("git printed a status without a path", `${fields.length} NUL-separated fields`);
  }
  const changes = [];
  for (let i = 0; i < fields.length; i += 2) {
    const letter = fields[i];
    changes.push({
      path: fields[i + 1],
      status: GIT_STATUS[letter] ?? `git:${letter}`,
      previous: null,
    });
  }
  return changes;
}

/**
 * The table's patterns are written against paths exactly as git prints
 * them. A path that is absolute, or has a `.` or `..` SEGMENT, matches
 * nothing but the `**` row and still classifies -- a confident `routine`
 * over a list this could not read properly. Neither real producer (git
 * and the pull request files API) emits any of those shapes, so one here
 * means the list came from somewhere unexamined.
 *
 * Segments, not substrings: `a..b.ts` is a legal file name, and once
 * `--changes` carried names exactly, a substring test refused a real
 * pull request that had one (a Copilot finding on #533).
 */
function checkPaths(paths) {
  const bad = paths.filter(
    (f) => f.startsWith("/") || f.split("/").some((seg) => seg === "." || seg === ".."),
  );
  if (bad.length > 0) {
    refuse(
      `${bad.length} path(s) are not repo-root-relative as git prints them`,
      `first: ${
        bad[0]
      }\n  Expected e.g. barwise/packages/core/src/x.ts -- no leading '/', no '.' or '..' segment.`,
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

const changes = await readChanges();
if (changes.length === 0) {
  refuse(
    "the changed-file list is empty",
    "A pull request that changes nothing does not occur here, so this is a\n"
      + "  list that was never populated rather than a diff that is genuinely clean.",
  );
}
const paths = [...new Set(changes.flatMap((c) => (c.previous ? [c.path, c.previous] : [c.path])))];
checkPaths(paths);

// `trivial` is a separate question from the tier: it decides whether a
// Copilot review is requested at all (WS1), where the tier decides
// whether one blocks (WS4). Reported side by side because the workflow
// reads one and a person reading the output may want both.
const result = { ...classify(paths, rows), trivial: isTrivial(changes, trivial) };

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ ...result, fileCount: changes.length }, null, 2));
  process.exit(0);
}

const width = Math.max(...result.matched.map((r) => r.tier.length), 0);
console.log(
  `pr-risk: ${result.tier}${result.trivial ? ", trivial" : ""}`
    + `  (${changes.length} changed file${changes.length === 1 ? "" : "s"})`,
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
