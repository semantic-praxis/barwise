#!/usr/bin/env node
/**
 * What kind of change is this: the one owner of CI's change classes.
 *
 * Two predicates decide which gates a change runs, and both `ci.yml`'s
 * detect step and `ci-local.mjs` need them. They lived as four lines of
 * shell inside the workflow, so the local runner could not see them and
 * ran every gate on every change: a tracker-only edit cost three minutes
 * locally against 37 seconds in CI, and a docs-only diff that skipped the
 * build in CI still ran the optimizer suite there while passing locally,
 * because locally the build had run (barwise-954). One module, imported by
 * one and executed by the other, makes that disagreement impossible rather
 * than checked (`docs/specs/ci-local-condition-parity.spec.md`).
 *
 * `ci.yml` runs this BEFORE `setup-node` and `npm ci`, on whatever Node the
 * runner ships with. So it imports node: builtins only -- never a package,
 * never a workspace module. That constraint is the reason it is a file of
 * its own rather than a function in `ci-gates.mjs`.
 */
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** A change made only of these files skips build, test and lint in CI. */
const DOCS_ONLY = /\.md$|^\.beads\//;

/**
 * The optimizer lane runs when it is touched, or when the CLI it shells out
 * to is: its metric tests call the real `barwise prompt score`, so a CLI
 * change can break them without touching a Python file.
 */
const OPTIMIZER = /^barwise\/optimizer\/|^barwise\/packages\/cli\//;

/**
 * Classify a list of repo-root-relative paths.
 *
 * An EMPTY list is not docs-only. The shell this replaced guarded with
 * `[ -n "$changed" ]`, and the reason holds: a diff that came back empty is
 * as likely to be a diff that failed to see anything as a change with no
 * files, and "not docs-only" is the answer that runs the gates.
 */
export function classify(paths) {
  return {
    docsOnly: paths.length > 0 && paths.every((p) => DOCS_ONLY.test(p)),
    optimizer: paths.some((p) => OPTIMIZER.test(p)),
  };
}

/** NUL-separated so a path git would quote reaches the regexes as itself. */
function gitPaths(args, cwd) {
  const out = execFileSync("git", [...args, "-z"], { cwd, encoding: "utf8" });
  return out.split("\0").filter(Boolean);
}

/**
 * The files `base..HEAD` changes, as CI computes them: `git diff --name-only
 * <base> HEAD`, repo-root-relative whatever the cwd. Throws if git cannot
 * answer; a caller that cannot classify must not guess.
 */
export function committedPaths(base, cwd = process.cwd()) {
  return gitPaths(["diff", "--name-only", base, "HEAD"], cwd);
}

/**
 * The files a local run must also count: uncommitted edits, staged or not,
 * and untracked files git does not ignore. `ci:local` runs before a commit
 * as often as before a push, and a source edit that is not yet committed
 * must not be classified as docs-only.
 *
 * The `:/` pathspec is load-bearing. `ls-files --others` lists only the
 * subtree of its cwd, and `ci-local.mjs` runs from `barwise/`: without it an
 * untracked file at the repo root or under `.github/` went unseen, which
 * is the direction that can skip a gate CI will run.
 */
export function uncommittedPaths(cwd = process.cwd()) {
  return [
    ...gitPaths(["diff", "--name-only", "HEAD"], cwd),
    ...gitPaths(["ls-files", "--others", "--exclude-standard", "--full-name", "--", ":/"], cwd),
  ];
}

/**
 * `node scripts/lib/changed-class.mjs <base>` -- the detect step's entry.
 *
 * stdout carries only `key=value` lines, because the step appends it to
 * `$GITHUB_OUTPUT`; the file list and the verdict go to stderr so the log
 * shows what was classified.
 */
function main(argv) {
  const base = argv[0];
  if (!base) {
    console.error("usage: changed-class.mjs <base-sha>");
    process.exit(2);
  }
  const paths = committedPaths(base);
  const c = classify(paths);
  console.error("Changed files:");
  for (const p of paths) console.error(`  ${p}`);
  if (c.docsOnly) {
    console.error("Docs/tracker-only change -- skipping build, test, and lint steps.");
  }
  console.log(`docs_only=${c.docsOnly}`);
  console.log(`optimizer=${c.optimizer}`);
}

const invoked = process.argv[1] && realpathSync(process.argv[1]);
if (invoked === realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2));
}
