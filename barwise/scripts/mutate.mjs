#!/usr/bin/env node
/**
 * Prove a test fails on the defect it claims to catch.
 *
 * Plant one textual mutation in one file, run a command, restore the
 * file, and report whether the command noticed. Exit 0 means the
 * mutation was CAUGHT -- the assertion about the suite, not a re-run of
 * it, which is why the code inverts (docs/specs/mutation-verification-
 * helper.spec.md, "Should the exit code invert?").
 *
 * WHY THIS EXISTS. Six times a verification came back green for a
 * reason unrelated to what it verified (barwise-906), and every one was
 * a hand-rolled backup/mutate/run/restore where the correct instrument
 * and a blind one look identical at the call site:
 *
 *   1. The mutation never applied. A `sed -i` whose anchor no longer
 *      matched -- dprint reflowed the line -- left the file untouched
 *      and printed `4 passed`, which is byte-identical to the reading
 *      you get when the mutation DID apply and the test was too weak.
 *      Hence: the anchor count is asserted, and a no-op replacement is
 *      refused.
 *   2. The mutation applied where the check does not look. An untracked
 *      NUL probe against a gate that enumerates `git ls-files`.
 *      Hence: the target resolves from REPO_ROOT, and the reading is
 *      the command's own status rather than the operator's belief about
 *      where it looked.
 *   3. The restore was verified by an instrument that cannot fail.
 *      `git diff --stat` prints nothing for an untracked file whether
 *      it is pristine or corrupt, and prints a nonzero count for a
 *      tracked file carrying unrelated uncommitted work in BOTH states.
 *      Hence: SHA-256 of the bytes, which knows nothing about git.
 *   4. The status was read through a pipe. `echo | sh hook | tail` puts
 *      echo in PIPESTATUS[0]. Hence: spawnSync with no shell.
 *
 * Usage:
 *   node scripts/mutate.mjs --file <path> --old <text> --new <text>
 *                           [--count N] [--backup-dir <path>]
 *                           -- <command> [args...]
 *
 * --file resolves against the REPO ROOT, because a gate's coverage must
 * not depend on the cwd it was invoked from. The COMMAND runs in the
 * caller's cwd, because that is where `npx vitest run tests/...` means
 * what the caller typed.
 *
 * Exit codes:
 *   0  caught   -- the command failed with the mutation applied
 *   1  uncaught -- the command passed with the mutation applied
 *   2  refused  -- anchor absent or ambiguous, mutation is a no-op, or
 *                  the restore did not verify
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { REPO_ROOT } from "./lib/tracked.mjs";

const REFUSED = 2;

function refuse(message) {
  process.stderr.write(`mutate: ${message}\n`);
  process.exit(REFUSED);
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Split argv at the first bare `--`. Everything after it is the command,
 * verbatim -- no shell, so a quoted argument stays one argument.
 */
function parseArgs(argv) {
  const flags = {};
  let command = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      command = argv.slice(i + 1);
      break;
    }
    if (!arg.startsWith("--")) refuse(`unexpected positional argument "${arg}"`);
    const name = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value === "--") refuse(`--${name} needs a value`);
    flags[name] = value;
    i++;
  }
  return { flags, command };
}

const { flags, command } = parseArgs(process.argv.slice(2));

for (const required of ["file", "old", "new"]) {
  if (flags[required] === undefined) refuse(`--${required} is required`);
}
if (!command || command.length === 0) {
  refuse("a command is required, after a bare `--`");
}

const expected = flags.count === undefined ? 1 : Number(flags.count);
if (!Number.isInteger(expected) || expected < 1) {
  refuse(`--count must be a positive integer, got "${flags.count}"`);
}

const target = isAbsolute(flags.file) ? flags.file : resolve(REPO_ROOT, flags.file);
if (!existsSync(target)) {
  refuse(`no such file: ${target}\n  (paths resolve against the repo root, not the cwd)`);
}

const original = readFileSync(target, "utf8");
const originalHash = sha256(original);

// Counted before anything is written. A mutation that silently fails to
// apply is the failure mode this whole script exists for: it produces a
// PASSING run indistinguishable from a test that missed the defect.
const occurrences = original.split(flags.old).length - 1;
if (occurrences !== expected) {
  refuse(
    `anchor occurs ${occurrences} time(s) in ${flags.file}, expected ${expected}.\n`
      + `  Nothing was written. Re-read the file: a formatter may have reflowed\n`
      + `  the line since the anchor was written.`,
  );
}

if (flags.new === flags.old) {
  refuse("--new is identical to --old; a no-op mutation proves nothing");
}

const mutated = original.split(flags.old).join(flags.new);
if (mutated === original) {
  refuse("the replacement leaves the file byte-identical; nothing to run");
}

const backupDir = flags["backup-dir"]
  ? resolve(flags["backup-dir"])
  : join(REPO_ROOT, ".mutate-backups");
mkdirSync(backupDir, { recursive: true });
const backup = join(backupDir, `${basename(target)}.${Date.now()}.bak`);
writeFileSync(backup, original, "utf8");

const mutatedHash = sha256(mutated);

/**
 * Restore and verify, in two steps that catch two different failures.
 *
 * FIRST, before writing anything, check that the file still holds
 * exactly what this script put there. If it does not, the command under
 * test wrote to its own input, and the reading is about a file state
 * neither the operator nor this script chose -- so the run is refused
 * even if the command "failed", because a failure for an unknown reason
 * is not evidence. Writing the original back first would erase that
 * evidence: the post-write hash then always matches, and the check can
 * only ever pass. That was this function's first form, and the test
 * below caught it.
 *
 * SECOND, restore and hash the bytes on disk. This is the check
 * barwise-906's acceptance criteria name, and it is by CONTENT rather
 * than through git because `git diff --stat` cannot report failure for
 * an untracked file, and reports a nonzero count in both states for a
 * tracked file carrying unrelated uncommitted work.
 *
 * A failure keeps the backup and names it. That is the one moment the
 * operator needs a path they can actually reach, which is why the
 * default backup directory is in the repo and not a temp dir the
 * container takes with it.
 */
function restoreOrDie() {
  const before = sha256(readFileSync(target, "utf8"));
  const tampered = before !== mutatedHash;

  writeFileSync(target, original, "utf8");
  const after = sha256(readFileSync(target, "utf8"));

  if (after !== originalHash) {
    process.stderr.write(
      `mutate: RESTORE FAILED for ${flags.file}\n`
        + `  expected sha256 ${originalHash}\n`
        + `  actual   sha256 ${after}\n`
        + `  original content kept at ${backup}\n`,
    );
    process.exit(REFUSED);
  }

  if (tampered) {
    process.stderr.write(
      `mutate: RESTORE FAILED for ${flags.file}\n`
        + `  the command wrote to the file under test while it ran.\n`
        + `  expected the mutated sha256 ${mutatedHash}\n`
        + `  found                       ${before}\n`
        + `  The original has been restored and verified, and is also at\n`
        + `  ${backup}. The run proves nothing: whatever the command\n`
        + `  reported, it was not about the mutation this script planted.\n`,
    );
    process.exit(REFUSED);
  }

  rmSync(backup, { force: true });
}

// A ctrl-c must not leave a mutated tree behind.
let finished = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (!finished) {
      finished = true;
      restoreOrDie();
    }
    process.exit(REFUSED);
  });
}

let status;
try {
  writeFileSync(target, mutated, "utf8");
  // No shell, so the status is this process's own and not a pipeline's.
  const run = spawnSync(command[0], command.slice(1), {
    cwd: process.cwd(),
    stdio: "inherit",
    encoding: "utf8",
  });
  if (run.error) {
    process.stderr.write(`mutate: could not run the command: ${run.error.message}\n`);
    status = null;
  } else {
    status = run.status === null ? 1 : run.status; // killed by a signal counts as failed
  }
} finally {
  if (!finished) {
    finished = true;
    restoreOrDie();
  }
}

if (status === null) process.exit(REFUSED);

if (status !== 0) {
  process.stdout.write(
    `mutate: CAUGHT -- the command failed (exit ${status}) with the mutation applied.\n`,
  );
  process.exit(0);
}

process.stdout.write(
  `mutate: UNCAUGHT -- the command PASSED with the mutation applied.\n`
    + `  ${flags.file}: "${flags.old}" -> "${flags.new}"\n`
    + `  Nothing in that command distinguishes the mutated file from the original.\n`,
);
process.exit(1);
