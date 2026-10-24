/**
 * The generated marks in `.gitattributes` stay the one list
 * (docs/specs/plan-scope-check.spec.md, WS4).
 *
 * Three things must agree with it, and each drifted before: a regen:*
 * script's output (a new regenerator could ship unmarked and inflate every
 * PR that touches it), and the review-tiers row "When generated output
 * changed", whose glob named a `prompts/` directory that never existed and
 * routed nothing for five weeks (barwise-fs0).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { generatedPaths } from "../lib/generated.mjs";
import { matchesPattern, patternFault } from "../lib/review-tiers.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: REPO, encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

/**
 * What each regen:* script writes. A script missing here fails the first
 * test, so a new regenerator cannot ship without saying where its output
 * goes -- and then the second test asks for the mark. A regenerator that
 * writes only a section of a hand-written file is listed in
 * SECTION_WRITERS instead: marking the whole file would hide its
 * hand-written body from diffs and from `plan-scope`.
 */
const REGEN = {
  "regen:examples": ["barwise/examples/output/"],
  "regen:tutorial": ["barwise/docs/tutorial/"],
  "regen:builtins": ["barwise/packages/llm/src/prompt/artifacts/builtins.generated.ts"],
  "regen:references": ["barwise/packages/promptlab/evals/*.reference.orm.yaml"],
};
const SECTION_WRITERS = {
  "regen:architecture": ["barwise/docs/ARCHITECTURE.md"],
};

/** Tracked files an output entry stands for: a directory, a file, or one `*` in the last segment. */
function filesOf(output) {
  if (output.endsWith("/")) return tracked.filter((f) => f.startsWith(output));
  if (!output.includes("*")) return tracked.filter((f) => f === output);
  const at = output.lastIndexOf("/");
  const [head, tail] = [output.slice(0, at + 1), output.slice(at + 1)];
  const re = new RegExp(
    `^${tail.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")}$`,
  );
  return tracked.filter((f) =>
    f.startsWith(head) && !f.slice(head.length).includes("/") && re.test(f.slice(head.length))
  );
}

test("generated marks: every regen:* script says where its output goes", () => {
  const scripts = Object.keys(
    JSON.parse(readFileSync(join(REPO, "barwise", "package.json"), "utf8")).scripts,
  ).filter((s) => s.startsWith("regen:"));
  const listed = [...Object.keys(REGEN), ...Object.keys(SECTION_WRITERS)];
  assert.deepEqual(scripts.filter((s) => !listed.includes(s)), [], "regen scripts with no entry");
  assert.deepEqual(listed.filter((s) => !scripts.includes(s)), [], "entries for no regen script");
});

test("generated marks: every regen:* output is marked linguist-generated", () => {
  for (const [script, outputs] of Object.entries(REGEN)) {
    for (const output of outputs) {
      const files = filesOf(output);
      // An output that matches nothing is a path that moved, not a pass.
      assert.ok(files.length > 0, `${script}: ${output} matches no tracked file`);
      const marked = generatedPaths(files, REPO);
      assert.deepEqual(files.filter((f) => !marked.has(f)), [], `${script}: unmarked output`);
    }
  }
});

test("generated marks: the review-tiers generated row routes marked files only, and every output it can name", () => {
  const rows = JSON.parse(readFileSync(join(REPO, "barwise", "review-tiers.json"), "utf8")).rows;
  const row = rows.find((r) => r.heading === "When generated output changed");
  assert.ok(row, 'review-tiers.json has no "When generated output changed" row');
  const marked = generatedPaths(tracked, REPO);
  for (const glob of row.globs) {
    const hits = tracked.filter((f) => matchesPattern(f, glob));
    assert.ok(hits.length > 0, `${glob} routes nothing`);
    assert.deepEqual(hits.filter((f) => !marked.has(f)), [], `${glob} routes hand-written files`);
  }
  // Every regen output the tiers pattern language can express is on the
  // row. One cannot: `*` there is a whole segment, so
  // `evals/*.reference.orm.yaml` has no spelling that leaves the
  // hand-written suite.yaml beside it out.
  const expressible = Object.values(REGEN).flat().filter((o) => patternFault(o) === null);
  assert.deepEqual(expressible.filter((o) => !row.globs.includes(o)), [], "outputs the row misses");
  assert.deepEqual(
    Object.values(REGEN).flat().filter((o) => patternFault(o) !== null),
    ["barwise/packages/promptlab/evals/*.reference.orm.yaml"],
    "the only output the tiers language cannot express",
  );
});
