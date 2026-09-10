#!/usr/bin/env node
/**
 * Format the tracked files that live OUTSIDE `barwise/`.
 *
 * `dprint.json` sits in `barwise/`, and `npm run fmt` runs from there,
 * so dprint never walks up: `README.md`, `CLAUDE.md`, `AGENTS.md` and
 * every `.claude/skills/*.md` were outside its reach and had never been
 * formatted, while `fmt:check` exited 0 (barwise-990). That is
 * barwise-905's shape applied to formatting -- a gate reporting OK over
 * a set that does not contain the thing you care about, and the three
 * files it missed are the three a new contributor reads first.
 *
 * dprint refuses a path outside its config's directory when invoked
 * from inside that directory, which is why this cannot be a second
 * pattern in `dprint.json` or a `../` glob in the npm script. Invoked
 * from the REPO ROOT with an explicit `--config`, it accepts them. So
 * this script supplies the one thing the npm script cannot: a different
 * cwd, without a `cd` in a command (CLAUDE.md, and `at-root.mjs` for
 * the same reason).
 *
 * ONE config, not two. A second `dprint.json` at the root would be a
 * must-agree copy of every style setting with nothing keeping the pair
 * honest, which CLAUDE.md forbids outright.
 *
 * The file list comes from `git ls-files` rather than a glob, so a new
 * top-level document is covered the day it is added rather than the day
 * someone remembers to widen a pattern. Extensions are limited to what
 * the three configured plugins handle.
 *
 * Usage: node scripts/fmt-root.mjs [--check]
 * Exit:  0 formatted/clean, 1 unformatted under --check, 2 refused.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { REPO_ROOT, trackedFiles } from "./lib/tracked.mjs";

const check = process.argv.includes("--check");

/** What the typescript, json and markdown plugins in dprint.json handle. */
const FORMATTABLE = /\.(md|json|ts|mjs|cjs|tsx)$/;

/**
 * `.jsonl` is one JSON document per line and the json plugin would
 * reflow it into one document per file; `.beads/issues.jsonl` is the
 * tracker and `check-beads.sh` owns its canonical form. `package-lock`
 * and `node_modules` are already excluded inside `dprint.json`, but the
 * exclusion is by pattern and this passes explicit paths, so they are
 * named again here rather than assumed.
 */
const SKIP = [
  /\.jsonl$/,
  /(^|\/)package-lock\.json$/,
  /(^|\/)node_modules\//,
  // ALL of `.beads/`, not just its hooks. The directory is vendored by
  // the beads tracker -- `lib/tracked.mjs`'s header already says callers
  // that lint rather than merely read should exclude it, and its README
  // is the same category as its hooks. Formatting a vendored file means
  // re-formatting it after every tracker update, and losing the diff
  // against upstream in between.
  /^\.beads\//,
];

const targets = trackedFiles()
  .filter((f) => !f.startsWith("barwise/"))
  .filter((f) => FORMATTABLE.test(f))
  .filter((f) => !SKIP.some((re) => re.test(f)));

if (targets.length === 0) {
  process.stderr.write(
    "fmt-root: no formattable files outside barwise/, which cannot be right.\n"
      + "  Refusing rather than reporting a clean run over nothing.\n",
  );
  process.exit(2);
}

const dprint = join(REPO_ROOT, "barwise", "node_modules", ".bin", "dprint");
const result = spawnSync(
  dprint,
  [check ? "check" : "fmt", "--config", join(REPO_ROOT, "barwise", "dprint.json"), ...targets],
  { cwd: REPO_ROOT, encoding: "utf8", stdio: "inherit" },
);

if (result.error) {
  process.stderr.write(`fmt-root: could not run dprint at ${dprint}\n  ${result.error.message}\n`);
  process.exit(2);
}
if (result.status !== 0) process.exit(result.status ?? 1);

process.stdout.write(
  `fmt-root: ${targets.length} file(s) outside barwise/ ${check ? "clean" : "formatted"}. OK\n`,
);
