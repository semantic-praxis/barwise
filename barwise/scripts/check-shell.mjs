#!/usr/bin/env node
/**
 * Lint every tracked shell script with shellcheck.
 *
 * The scripts were the one artifact class with no gate at all: not
 * dprint, not oxlint, not tsc. Three portability bugs shipped in
 * `compile-runner.sh` before anyone read it adversarially, and shellcheck
 * catches one of them (SC2144, at error severity) for free.
 *
 * Options live in `.shellcheckrc` at the repo root, where the two style
 * checks and the two correctness checks this project opted into are
 * declared. Per-file exceptions are `# shellcheck disable=` directives
 * carrying a reason, so a suppression is reviewable where it applies
 * rather than centralised into a list nobody reads.
 *
 * TWO THINGS THIS GETS RIGHT ONLY BECAUSE THEY WERE GOT WRONG FIRST:
 *
 * The file list is anchored to the repo root rather than the process
 * cwd. `git ls-files '*.sh'` resolves its pathspec RELATIVE to cwd, so
 * this gate linted 7 scripts when run by hand from the repo root and 6
 * under `npm run check:shell` from `barwise/` -- silently dropping
 * `.claude/hooks/session-start.sh`, the one script CI never saw. The
 * count in the OK line is the tell; anchoring is the fix.
 *
 * Husky hooks are linted too, as `sh`. They are tracked shell scripts
 * with no extension and no shebang, so a `*.sh` glob misses them and
 * shellcheck cannot infer a dialect -- and husky v9 executes them with
 * `sh`, which makes a bashism a run-time failure in the hook that is
 * supposed to be catching failures. `.husky/_/` is husky's own generated
 * shim directory and is gitignored, so it never appears here.
 *
 * `.beads/hooks/` is vendored by the beads tracker and is not ours to
 * lint; it is the only exclusion.
 */
import { spawnSync } from "node:child_process";
import { REPO_ROOT as ROOT, trackedFiles } from "./lib/tracked.mjs";

const probe = spawnSync("shellcheck", ["--version"], { encoding: "utf8" });
if (probe.error) {
  console.error(
    "shellcheck is not installed.\n"
      + "  macOS:  brew install shellcheck\n"
      + "  Debian: sudo apt-get install -y shellcheck\n"
      + "  Other:  https://github.com/koalaman/shellcheck#installing",
  );
  process.exit(1);
}

// One listing, from the shared anchored helper -- see scripts/lib/
// tracked.mjs for why this is not spelled `git ls-files` here. Partitioned
// with a predicate rather than by pathspec: two globs (`.husky/*` and
// `*/.husky/*`) would be needed to reach a husky directory at either
// depth, and git's wildmatch would then decide whether a file lands in
// the list twice.
const all = trackedFiles().filter((f) => !f.startsWith(".beads/hooks/"));

const scripts = all.filter((f) => f.endsWith(".sh"));
// A hook, not husky's generated `_/` shims -- those are gitignored, so
// the exclusion is belt and braces against a repo that commits them.
const hooks = all.filter((f) => /(^|\/)\.husky\/[^/]+$/.test(f) && !f.includes("/.husky/_/"));

if (scripts.length + hooks.length === 0) {
  console.log("check-shell: no tracked shell scripts.");
  process.exit(0);
}

let failed = false;
/** `dialect` is null for files whose shebang answers the question. */
function check(files, dialect) {
  if (files.length === 0) return;
  const args = ["-f", "gcc", ...(dialect ? ["-s", dialect] : []), ...files];
  const run = spawnSync("shellcheck", args, { cwd: ROOT, encoding: "utf8" });
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
  if (run.status !== 0) failed = true;
}

check(scripts, null);
check(hooks, "sh");

if (failed) {
  console.error(
    "\ncheck-shell: shellcheck flagged the script(s) above.\n"
      + "Fix them, or add a `# shellcheck disable=SCxxxx` directive WITH A REASON\n"
      + "at the narrowest scope that works -- a line, a function, or the file.",
  );
  process.exit(1);
}
console.log(
  `check-shell: ${scripts.length} script(s) and ${hooks.length} husky hook(s), no findings. OK`,
);
