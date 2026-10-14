#!/usr/bin/env node
/**
 * Refuse a script that lists untracked files itself.
 *
 * `lib/changed-class.mjs` owns that listing (`uncommittedPaths`), and it is
 * correct in two ways a fresh spelling of the untracked listing tends not
 * to be: the `:/` pathspec, without which the listing covers only the cwd's
 * subtree, and `-z`, without which a path containing a newline splits in
 * two (Copilot, PR #602). The last hand-rolled copy, `measure-comparison`'s
 * `trial`, shipped with a different defect -- it left untracked files out
 * entirely until Copilot found it on PR #641
 * (docs/specs/pushed-tree-verification.spec.md, workstream 1).
 *
 * Scope: tracked `.mjs` files under `barwise/scripts/`, outside
 * `scripts/lib/` (where the helper lives) and `scripts/tests/` (where a
 * scratch repository is built and inspected by hand on purpose). Shell
 * scripts and hooks cannot import the helper and are out of the rule.
 *
 * The match is the `HAND_ROLLED` pattern below: the listing subcommand
 * followed by its untracked flag within one call's reach, in code or in a
 * string. A comment that quotes the command matches too -- this file's own
 * first draft did, and passed only while it was itself untracked. Say
 * "untracked files" instead.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { REPO_ROOT, trackedFiles } from "./lib/tracked.mjs";

const IN_SCOPE = /^barwise\/scripts\/(?!lib\/|tests\/).*\.mjs$/;
const HAND_ROLLED = /\bls-files\b[^;]{0,200}?--others\b/;

const scripts = trackedFiles().filter((f) => IN_SCOPE.test(f));

// trackedFiles() refuses an empty listing; this refuses an empty FILTER.
// No scripts in scope means the pattern no longer matches the layout, and
// "no offenders" over zero files is the reading that looks like a pass.
if (scripts.length === 0) {
  console.error(
    "check-git-listing: no tracked .mjs files under barwise/scripts/ -- the scope\n"
      + "  pattern no longer matches the repository. Refusing rather than passing.",
  );
  process.exit(2);
}

const offenders = [];
for (const file of scripts) {
  let source;
  try {
    source = readFileSync(resolve(REPO_ROOT, file), "utf8");
  } catch (error) {
    // Deleted in the working tree is not this gate's business. Anything
    // else -- a directory where the file was, no permission -- is a script
    // the gate could not read, and passing over it would print OK about a
    // file it never saw.
    if (error?.code === "ENOENT") continue;
    console.error(`check-git-listing: could not read ${file} (${error?.code ?? error}).`);
    process.exit(2);
  }
  const m = HAND_ROLLED.exec(source);
  if (m) {
    offenders.push({ file, line: source.slice(0, m.index).split("\n").length });
  }
}

if (offenders.length > 0) {
  console.error("Scripts listing untracked files themselves:\n");
  for (const o of offenders) console.error(`  ${o.file}:${o.line}`);
  console.error(
    "\nUse uncommittedPaths(cwd) from scripts/lib/changed-class.mjs, with\n"
      + "committedPaths(base, cwd) when changes since a base also count. A hand-\n"
      + "written listing has missed untracked files, the cwd's siblings, and\n"
      + "newline-bearing paths, one defect per copy.",
  );
  process.exit(1);
}
console.log(
  `check-git-listing: ${scripts.length} script(s), none lists untracked files itself. OK`,
);
