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
 * The rows of review-tiers.json, validated for shape only.
 *
 * Glob SEMANTICS are WS3's problem; this validates that a row carries
 * what a consumer needs and nothing malformed, so the classifier does
 * not have to guard each field. A `not-path-derivable` row carries no
 * globs by design, and a row of any other tier without globs is an
 * error rather than a silently unmatchable row.
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
