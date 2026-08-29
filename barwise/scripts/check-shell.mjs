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
 * checks this project opted into are declared. Per-file exceptions are
 * `# shellcheck disable=` directives carrying a reason, so a suppression
 * is reviewable where it applies rather than centralised into a list
 * nobody reads.
 *
 * `.beads/hooks/` is vendored by the beads tracker and is not ours to
 * lint; it is the only exclusion.
 */
import { execFileSync, spawnSync } from "node:child_process";

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

const tracked = execFileSync("git", ["ls-files", "-z", "*.sh"], {
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
})
  .split("\0")
  .filter(Boolean)
  .filter((f) => !f.startsWith(".beads/hooks/"));

if (tracked.length === 0) {
  console.log("check-shell: no tracked shell scripts.");
  process.exit(0);
}

const run = spawnSync("shellcheck", ["-f", "gcc", ...tracked], { encoding: "utf8" });
if (run.stdout) process.stdout.write(run.stdout);
if (run.stderr) process.stderr.write(run.stderr);
if (run.status !== 0) {
  console.error(
    `\ncheck-shell: shellcheck flagged ${tracked.length} script(s) above.\n`
      + "Fix them, or add a `# shellcheck disable=SCxxxx` directive WITH A REASON\n"
      + "at the narrowest scope that works -- a line, a function, or the file.",
  );
  process.exit(1);
}
console.log(`check-shell: ${tracked.length} script(s), no findings. OK`);
