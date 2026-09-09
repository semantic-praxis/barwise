#!/usr/bin/env node
// at-root.mjs -- run one of the monorepo's npm scripts from any working
// directory, with no `cd` in the command.
//
//   node "$(git rev-parse --show-toplevel)/barwise/scripts/at-root.mjs" <script> [args...]
//
// The location is this file's own, not the caller's cwd and not git's
// answer, so the same spelling works from the repository root, from
// `barwise/`, and from inside a package directory.
//
// Why it exists (barwise-907, second recorded occurrence, 2026-09-09):
// the agent harness moves the working directory between commands, so a
// `cd barwise` that was already satisfied fails with ENOENT. Twice in one
// session that happened; the second time the `cd` headed an `&&` chain,
// `npm run fmt` was skipped silently, and `fmt:check` went red in the
// gate run. The root package.json forwarder covers the repository root
// and `barwise/`, and nothing covered a package directory. A `cd` in a
// command is the habit that fails; this file spells the location once.
//
// Exit code is the script's own. No script named, or `--help`, prints
// usage and exits 2, so a bare invocation cannot read as success.

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BARWISE = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const [script, ...args] = process.argv.slice(2);
if (!script || script === "--help" || script === "-h") {
  process.stderr.write(
    "usage: node barwise/scripts/at-root.mjs <npm-script> [args...]\n"
      + `runs \`npm run <npm-script> -- [args...]\` in ${BARWISE} from any cwd\n`,
  );
  process.exit(2);
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npm, ["run", script, ...(args.length ? ["--", ...args] : [])], {
  cwd: BARWISE,
  stdio: "inherit",
});
if (result.error) {
  process.stderr.write(`at-root: could not start npm: ${result.error.message}\n`);
  process.exit(1);
}
process.exit(result.status ?? 1);
