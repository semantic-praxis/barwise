/**
 * The review tier table, and the checklist headings it is keyed to.
 *
 * Two readers need the same answer for different reasons: the gate
 * (`check-review-tiers.mjs`) verifies the table and the headings still
 * agree, and the classifier (WS3, `pr-risk.mjs`) reads the table to
 * decide whether a diff blocks. Two parsers over one table is the
 * must-agree copy CLAUDE.md forbids, and the drift would be invisible --
 * each would keep reporting OK over its own reading. Same shape, and the
 * same reason, as `lib/ci-gates.mjs` over `ci.yml`.
 *
 * Both readers THROW rather than returning an empty result. Nothing
 * downstream can distinguish "the checklist declares no trigger
 * headings" from "this parsed a file that is not the checklist", and
 * both would read as a clean run over zero rows -- the false green
 * `docs/specs/gate-refusal-contract.spec.md` exists to remove. The gate
 * turns a throw into exit 2.
 *
 * Spec: docs/specs/tiered-pr-review.spec.md (WS2, barwise-1037).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** `barwise/scripts/lib` -> `barwise` -> the repo root -> the checklist. */
export const CHECKLIST = resolve(SCRIPTS, "../../.claude/skills/pr-review/checklist.md");

/** `barwise/scripts/lib` -> `barwise/review-tiers.json`. */
export const TABLE = resolve(SCRIPTS, "../review-tiers.json");

/** Tier values a row may carry. `not-path-derivable` is a real answer, not a gap. */
export const TIERS = ["always", "high-risk", "routine", "not-path-derivable"];

/**
 * Every `## ` heading in checklist.md, in order, with the marker stripped.
 *
 * These ARE the trigger conditions -- "When `@barwise/core` changed" is
 * both the section a reviewer reads and the condition that selects it.
 * The file's `# ` title is not a trigger and is not returned; counting it
 * is how a body once claimed fourteen headings where there are thirteen.
 */
export function checklistHeadings(file = CHECKLIST) {
  let md;
  try {
    md = readFileSync(file, "utf8");
  } catch (cause) {
    throw new Error(`cannot read the checklist at ${file}`, { cause });
  }
  const headings = [];
  for (const line of md.split("\n")) {
    const m = /^## (.+?)\s*$/.exec(line);
    if (m) headings.push(m[1]);
  }
  if (headings.length === 0) {
    throw new Error(
      `no '## ' headings in ${file} -- this is not the checklist, or its format changed`,
    );
  }
  return headings;
}

/**
 * The rows of review-tiers.json, validated for shape AND for pattern
 * language.
 *
 * A row is validated here so the classifier does not have to guard each
 * field. A `not-path-derivable` row carries no globs by design, and a
 * row of any other tier without globs is an error rather than a silently
 * unmatchable row.
 *
 * The patterns are checked against `patternFault` because a pattern this
 * language does not define is worse than a malformed one: `*.ts` parses
 * fine and matches nothing, so the row would sit in the table looking
 * like a rule while the classifier silently never fired on it. That is
 * the same defect as a heading with no row, one level down, and it is
 * why the gate refuses rather than the classifier shrugging.
 */
export function tierRows(file = TABLE) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (cause) {
    throw new Error(`cannot read or parse the tier table at ${file}`, { cause });
  }
  const rows = parsed?.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`${file} declares no rows -- this is not the tier table`);
  }
  for (const [i, row] of rows.entries()) {
    const at = `row ${i} (${row?.heading ?? "no heading"})`;
    if (typeof row?.heading !== "string" || row.heading.length === 0) {
      throw new Error(`${at}: heading must be a non-empty string`);
    }
    if (!TIERS.includes(row?.tier)) {
      throw new Error(`${at}: tier must be one of ${TIERS.join(", ")}`);
    }
    if (typeof row?.why !== "string" || row.why.length === 0) {
      throw new Error(`${at}: why must be a non-empty string`);
    }
    if (row.tier === "not-path-derivable") {
      if (row.globs !== undefined) {
        throw new Error(`${at}: not-path-derivable rows carry no globs`);
      }
      continue;
    }
    if (!Array.isArray(row.globs) || row.globs.length === 0) {
      throw new Error(`${at}: tier ${row.tier} needs at least one glob`);
    }
    for (const g of row.globs) {
      if (typeof g !== "string" || g.length === 0) {
        throw new Error(`${at}: every glob must be a non-empty string`);
      }
      const fault = patternFault(g);
      if (fault) throw new Error(`${at}: ${fault}`);
    }
  }
  return rows;
}

/**
 * How the headings and the rows disagree, in both directions.
 *
 * Pure, so the gate's own tests can exercise every disagreement without
 * perturbing the real checklist -- and so the comparison is one thing a
 * reader can check rather than logic buried in a script's body.
 *
 * `duplicated` is not hypothetical bookkeeping: two rows for one heading
 * would let a later edit change one and leave the other, and the
 * classifier would pick whichever it saw first.
 */
export function compareTable(headings, rows) {
  const declared = rows.map((r) => r.heading);
  return {
    missing: headings.filter((h) => !declared.includes(h)),
    stale: declared.filter((h) => !headings.includes(h)),
    duplicated: declared.filter((h, i) => declared.indexOf(h) !== i),
  };
}

/**
 * The pattern language of `review-tiers.json`, stated once.
 *
 * These are NOT globs, despite the field name they are stored under.
 * The language is four shapes and no more:
 *
 *   `**`          every path (the "Every PR" row, which has no trigger)
 *   `a/b/`        every path under the directory a/b
 *   `a/<*>/c/`    every path under a/<one segment>/c
 *   `a/b.json`    that exact path
 *
 * A `*` is one whole path segment. There is no partial-segment match and
 * no recursive wildcard except the bare `**`, which is why `patternFault`
 * refuses a shape like `*.ts`: it parses, matches nothing, and sits in
 * the table looking like a rule.
 *
 * Node's `path.matchesGlob` is NOT used, and not for style. Measured over
 * this repository -- the table's 25 distinct patterns against all 1637
 * tracked files, 40,925 comparisons -- it disagrees on 73, and every one
 * is a path with a dot-segment that its `*` and `**` decline to match.
 * That silently empties the rows this table most needs: "Every PR" would
 * miss 71 files, all of `.beads/`, `.claude/`, `.github/` and `.husky/`
 * among them, and the high-risk surface row would miss
 * `barwise/packages/vscode/.vscode-test.mjs` and `.vscodeignore`. A
 * classifier reading fewer files than it claims, while printing a
 * confident tier, is barwise-905's shape exactly. `matchesGlob` is also
 * experimental in the Node `.nvmrc` pins, so its semantics can move under
 * a runtime upgrade. Four shapes we define beat a matcher we cannot pin
 * and whose default excludes the paths that carry the rules.
 *
 * Paths are compared as git prints them: relative to the repo root, with
 * forward slashes, no leading `./`.
 */

/** Why `pattern` is not in the language, or `null` if it is. */
export function patternFault(pattern) {
  if (pattern === "**") return null;
  if (pattern.startsWith("/")) {
    return `pattern ${JSON.stringify(pattern)} is absolute; paths are relative to the repo root`;
  }
  const body = pattern.endsWith("/") ? pattern.slice(0, -1) : pattern;
  if (body.length === 0) return `pattern ${JSON.stringify(pattern)} names no path`;
  for (const seg of body.split("/")) {
    if (seg.length === 0) {
      return `pattern ${JSON.stringify(pattern)} has an empty path segment`;
    }
    if (seg === "." || seg === "..") {
      // Accepted, these are rows that can never fire: git prints no path
      // with a `.` or `..` segment, so `./barwise/packages/core/src/`
      // passes the completeness gate and matches nothing forever. That is
      // the same silently-dead rule `*.ts` would be, by a different route
      // -- and `pr-risk` already refuses these shapes on its INPUT side,
      // so accepting them on the pattern side was the one-way hole.
      return `pattern ${JSON.stringify(pattern)} has a ${JSON.stringify(seg)} segment; `
        + "git prints no such path, so this row could never match";
    }
    if (seg.includes("*") && seg !== "*") {
      return (
        `pattern ${JSON.stringify(pattern)} uses ${JSON.stringify(seg)}: a '*' is one whole `
        + "path segment here, so a partial-segment wildcard would match nothing and look like a rule"
      );
    }
  }
  return null;
}

/**
 * Does `file` fall under `pattern`? See the language above.
 *
 * PRECONDITION: `pattern` is in the language -- `patternFault(pattern)`
 * is null. This does NOT re-check, and on a pattern outside the language
 * it returns a confident wrong answer rather than an error: `*.ts` reads
 * as a literal segment and matches only a file named `*.ts`. Validation
 * is `tierRows`' job, once at load, which is the only way rows reach
 * `classify`; putting it here would run it once per file per pattern
 * (40,925 times over this repository) to re-establish something already
 * known. Any NEW caller reaching this directly owes that check.
 *
 * `file` is one path from a changed-file list. A directory pattern does
 * not match the directory itself, only what is under it -- git lists
 * files, so `barwise/packages/cli` as a path does not arise, and
 * matching it would be answering about something that was not changed.
 */
export function matchesPattern(file, pattern) {
  if (pattern === "**") return true;
  const isDir = pattern.endsWith("/");
  const pat = (isDir ? pattern.slice(0, -1) : pattern).split("/");
  const segs = file.split("/");
  if (isDir ? segs.length <= pat.length : segs.length !== pat.length) return false;
  return pat.every((seg, i) => seg === "*" || seg === segs[i]);
}

/**
 * The risk tier of a changed-file list, and why.
 *
 * `matched` carries the files that triggered each row so the answer can
 * be read rather than trusted -- a classifier that prints only "high-risk"
 * is a verdict nobody can check against the diff.
 *
 * `beyondReach` is the part WS4 must not forget: the `not-path-derivable`
 * rows never match anything, so a `routine` tier means "no path-shaped
 * trigger fired", NOT "the checklist is satisfied". Returning them beside
 * the verdict is cheaper than expecting every caller to remember they
 * exist, and the spec says a routine classification that reads as
 * checklist-satisfied is the way this design goes wrong.
 *
 * An `always` row matches every diff and is reported, but does not make a
 * diff high-risk: its tier is a statement about scope, not liability.
 */
export function classify(files, rows) {
  const matched = [];
  for (const row of rows) {
    if (row.tier === "not-path-derivable") continue;
    const hit = files.filter((f) => row.globs.some((g) => matchesPattern(f, g)));
    if (hit.length > 0) {
      matched.push({ heading: row.heading, tier: row.tier, why: row.why, files: hit });
    }
  }
  return {
    tier: matched.some((r) => r.tier === "high-risk") ? "high-risk" : "routine",
    matched,
    beyondReach: rows
      .filter((r) => r.tier === "not-path-derivable")
      .map((r) => ({ heading: r.heading, why: r.why })),
  };
}

/**
 * The patterns under which a pull request is TRIVIAL: every changed file
 * must match one, or it is not.
 *
 * This decides whether a Copilot review is requested at all
 * (`.github/workflows/copilot-review.yml`, WS1), which is why it is an
 * explicit ALLOW-list and not derived from the tier rows. Deriving it --
 * "trivial if no row but 'Every PR' matched" -- was the obvious move and
 * is wrong: the rows cover checklist triggers, not the repository, so a
 * change to `barwise/packages/diagram/src/` matches no row and would have
 * read as trivial. An unrecognised path must mean "review it", never
 * "skip it", because the two errors are not symmetric: a wrong skip is a
 * defect nobody looked at, a wrong review is one request's cost.
 *
 * Throws, like `tierRows`, rather than returning an empty list. An empty
 * allow-list is SAFE (nothing is trivial, everything is reviewed) but a
 * missing one is a file that is not the one we think it is, and that
 * should be loud. The workflow maps any refusal to "request the review".
 */
export function trivialGlobs(file = TABLE) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (cause) {
    throw new Error(`cannot read or parse the tier table at ${file}`, { cause });
  }
  const globs = parsed?.trivial?.globs;
  if (!Array.isArray(globs) || globs.length === 0) {
    throw new Error(`${file} declares no trivial.globs -- the allow-list is missing`);
  }
  if (typeof parsed.trivial.why !== "string" || parsed.trivial.why.length === 0) {
    throw new Error(`${file}: trivial.why must say why these paths need no review`);
  }
  for (const g of globs) {
    if (typeof g !== "string" || g.length === 0) {
      throw new Error(`${file}: every trivial glob must be a non-empty string`);
    }
    if (g === "**") {
      // Every path would be trivial and no pull request would ever be
      // reviewed. A one-character edit to this file must not be able to
      // switch the reviewer off for the whole repository.
      throw new Error(`${file}: trivial.globs may not contain "**" -- it would exempt everything`);
    }
    const fault = patternFault(g);
    if (fault) throw new Error(`${file}: trivial.${fault}`);
  }
  return globs;
}

/**
 * Is this change list trivial -- every change an EDIT to a path under an
 * allow-listed pattern?
 *
 * `changes` are `{ path, status }`, with the pull request files API's
 * status words (`modified`, `added`, `removed`, `renamed`, ...). Only
 * `modified` can be trivial, because an edit to the tracker is what the
 * allow-list's evidence measured. The other statuses are not that: a
 * rename's SOURCE is somewhere else, so moving code in under an
 * allow-listed name read as a tracker edit by name alone, and deleting
 * the tracker is not a closure. A status of `null` -- a bare path list,
 * which cannot say -- is therefore never trivial either.
 *
 * An EMPTY list is not trivial, and that is the whole reason this is a
 * function rather than an inline `changes.every(...)`: `[].every(f)` is
 * true, so the obvious one-liner reads "no files" as "nothing needs
 * review" and skips the reviewer on exactly the input a broken git call
 * or an empty API page produces. `pr-risk` already refuses an empty list
 * before it gets here; this refuses it again for any other caller, in
 * the direction that costs a review rather than one that loses it.
 */
export function isTrivial(changes, globs) {
  if (changes.length === 0) return false;
  return changes.every(
    (c) => c.status === "modified" && globs.some((g) => matchesPattern(c.path, g)),
  );
}
