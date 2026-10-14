#!/usr/bin/env node
/**
 * Run the CI gate list locally, in CI's order.
 *
 * The steps are PARSED OUT OF `.github/workflows/ci.yml` rather than
 * restated here -- by `lib/ci-gates.mjs`, which `fault-matrix.mjs` also
 * reads, so the two answers cannot drift. A hand-copied list would be a
 * must-agree copy with nothing keeping it honest, which is the thing
 * CLAUDE.md forbids -- and it would fail in the specific way that
 * motivated this script: silently, by omitting the gate that was about
 * to break.
 *
 * Written after two red pushes in one session, each from a gate that had
 * simply not been run (`fmt:check`, then `knip`). The subsequent
 * "everything" pass was itself missing five more (`filesize`, `dup`,
 * `audit`, `publint`, the bundles), because it too was assembled from
 * memory. Deriving the list is the only version of this that stays true.
 *
 * It applies ci.yml's `if:` conditions too, not just its list. A gate CI
 * skips for this change is skipped here and named in the summary, and the
 * change is classified by `lib/changed-class.mjs` -- the module ci.yml's
 * own detect step runs -- over the branch's diff from
 * `git merge-base origin/main HEAD` plus anything uncommitted. Before, this
 * ran every gate on every change, which cost three minutes on a tracker
 * edit and, worse, passed a docs-only diff that CI then failed: locally the
 * build had always run, in CI it was skipped (barwise-954,
 * `docs/specs/ci-local-condition-parity.spec.md`). The unknown case runs:
 * an `if:` this cannot read, or a base it cannot find, runs the gate and
 * says why. `--all` runs every gate regardless.
 *
 * `--list` prints each gate with the verdict this change gets, without
 * running anything. A failure does not stop the run: every gate reports,
 * so one pass shows all the breakage rather than the first of it.
 *
 * A run holds a lock, points coverage at a directory of its own, and
 * keeps the complete output of every failing gate on disk -- see
 * `docs/specs/local-ci-isolation.spec.md` (barwise-960) for why each of
 * those three exists.
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classify,
  committedPaths,
  pathsDifferingFrom,
  uncommittedPaths,
} from "./lib/changed-class.mjs";
import { ciSteps, shouldRun } from "./lib/ci-gates.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * One run at a time, per checkout.
 *
 * Two concurrent runs are not two opinions about the same tree. They
 * share `packages/*\/coverage`, they compete for the CPU that the
 * timings are measured against, and the loser of the coverage race
 * reports test failures that do not exist -- observed twice in one
 * session (barwise-960). The lock names the holder so the second run can
 * say what to wait for rather than just refusing.
 */
const LOCK = resolve(ROOT, "node_modules/.ci-local.lock");

/**
 * Whether a pid is still running.
 *
 * EPERM means the process exists and belongs to someone else, which is
 * still "running" -- reading it as "gone" would delete a live run's lock.
 */
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

function holder() {
  try {
    const parsed = JSON.parse(readFileSync(LOCK, "utf8"));
    return typeof parsed?.pid === "number" ? parsed : undefined;
  } catch {
    // Unreadable or truncated: a run that died mid-write. Treat as stale
    // rather than as a reason to refuse forever.
    return undefined;
  }
}

let held = false;

/**
 * Take the lock, or exit naming the run that has it.
 *
 * A lock whose pid is gone is removed rather than obeyed. That is the
 * whole of the staleness story on purpose: a `--force` flag to override
 * a lock is a flag people learn to pass by default, and then the lock
 * protects nothing.
 */
function acquireLock(busyExit = 1) {
  for (let attempt = 0; attempt < 2; attempt++) {
    mkdirSync(dirname(LOCK), { recursive: true });
    let fd;
    try {
      fd = openSync(LOCK, "wx");
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      const who = holder();
      if (who !== undefined && alive(who.pid)) {
        console.error(`ci:local is already running: pid ${who.pid}, started ${who.started}.`);
        console.error(
          "Two runs share the coverage output and the CPU the timings are measured against,",
        );
        console.error("so this one would report a tree it did not measure. Waiting is the fix.");
        console.error(`Lock: ${LOCK}`);
        process.exit(busyExit);
      }
      rmSync(LOCK, { force: true });
      continue;
    }
    writeFileSync(fd, JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));
    closeSync(fd);
    held = true;
    return;
  }
  throw new Error(
    `could not take ${LOCK}: a stale lock is being recreated as fast as it is removed`,
  );
}

function releaseLock() {
  if (!held) return;
  held = false;
  rmSync(LOCK, { force: true });
}

/** A gate name as a filename: `run test:coverage` -> `run-test-coverage.log`. */
function logName(gate) {
  return `${gate.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "")}.log`;
}

/**
 * The change class for this run, or why there is none.
 *
 * The base is `git merge-base origin/main HEAD`, the local analogue of
 * CI's `pull_request.base.sha`. It is never fetched: network I/O inside a
 * gate runner can hang in an offline container, and a missing or stale
 * `origin/main` is exactly the unknown case, which runs everything.
 */
function changeClass() {
  if (process.argv.includes("--all")) return { cls: undefined, why: "--all" };
  try {
    const base = execFileSync("git", ["merge-base", "origin/main", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const paths = [...new Set([...committedPaths(base, ROOT), ...uncommittedPaths(ROOT)])];
    return { cls: classify(paths), base: base.slice(0, 8), files: paths.length };
  } catch {
    return { cls: undefined, why: "no merge-base with origin/main" };
  }
}

/**
 * `--commit <sha>`: run the gate list against that commit, not this tree.
 *
 * The pre-push hook's question is whether CI will pass the commit being
 * pushed, and the working tree is not that commit. It holds build output a
 * CI checkout lacks -- on PR #641 a script test loaded `@barwise/core` from a
 * `dist` left by an earlier build, passed here, and failed in CI, which runs
 * the script tests before the build -- and files the push leaves behind. A
 * fresh worktree of the commit and a fresh `npm ci` are that commit's state
 * by construction, where hiding each difference in turn would be a list of
 * what a clone lacks, with nothing keeping it current
 * (docs/specs/pushed-tree-verification.spec.md, workstream 3).
 *
 * The build is not cold: Turbo's local cache is shared across worktrees, so
 * `build` and `test:coverage` replay entries this checkout already has. A
 * replay is keyed on the commit's own inputs, so it is not the `dist` left
 * over from some other tree that this exists to avoid; the spec's decision
 * (A) on a truly cold build is open.
 *
 * The lock is this checkout's, held from before the worktree exists until
 * after it is removed. The child run takes a lock in the worktree's own
 * `node_modules`, which no other run can see, so without this one two
 * pushes from one checkout would no longer exclude each other.
 *
 * Exit: the child's code (0 pass, 1 fail, 2 refused), or 2 when the commit
 * cannot be resolved, checked out or installed -- the gates never ran, so
 * nothing was found wrong and nothing was shown right.
 */
function runAtCommit(argv) {
  const at = argv.indexOf("--commit");
  const ref = argv[at + 1];
  if (ref === undefined || ref.startsWith("--")) {
    console.error("ci:local --commit needs a commit to check. Could not answer.");
    return 2;
  }
  let sha;
  let top;
  try {
    const git = (args) =>
      execFileSync("git", args, {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    sha = git(["rev-parse", "--verify", `${ref}^{commit}`]);
    top = git(["rev-parse", "--show-toplevel"]);
  } catch {
    console.error(`ci:local --commit: ${ref} does not name a commit here. Could not answer.`);
    return 2;
  }
  const passThrough = argv.filter((a, i) => i !== at && i !== at + 1);

  // Busy is "could not answer" here, not a failure: no gate ran, and the
  // hook must not report that CI would fail.
  acquireLock(2);
  let tree;
  const cleanup = () => {
    // Delete, then prune: prune drops the registration of a worktree whose
    // directory is gone.
    // A directory that will not delete must not keep the lock: the next run
    // reaps it once this process is gone.
    try {
      if (tree !== undefined) rmSync(tree, { recursive: true, force: true });
    } catch {
      console.error(`ci:local --commit: could not remove ${tree}; the next run will.`);
    }
    spawnSync("git", ["worktree", "prune"], { cwd: ROOT, stdio: "ignore" });
    releaseLock();
  };
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      cleanup();
      process.exit(130);
    });
  }

  try {
    // Inside the try, like every setup step: a worktree it cannot delete is
    // a refusal with the lock released, not an uncaught exit 1.
    reapAbandonedWorktrees();
    // The owner's pid is in the name, so a later run can tell an abandoned
    // worktree from a live one (reapAbandonedWorktrees).
    tree = mkdtempSync(join(tmpdir(), `${WORKTREE_PREFIX}${process.pid}-`));
    const left = [...new Set(pathsDifferingFrom(sha, ROOT))];
    if (left.length > 0) {
      console.log(
        `In this working tree but not in ${sha.slice(0, 8)}, so neither checked nor pushed:`,
      );
      for (const f of left) console.log(`  ${f}`);
      console.log("");
    }

    const add = spawnSync("git", ["worktree", "add", "--detach", "--quiet", tree, sha], {
      cwd: ROOT,
      encoding: "utf8",
    });
    if (add.status !== 0) {
      console.error(
        `ci:local --commit: could not check out ${sha.slice(0, 8)}: ${(add.stderr ?? "").trim()}`,
      );
      return 2;
    }
    const checkout = join(tree, relative(top, ROOT));
    console.log(
      `Checking ${sha.slice(0, 8)} in a fresh worktree: npm ci, then the CI gate list.\n`,
    );

    const install = spawnSync("npm", ["ci", "--no-audit", "--no-fund"], {
      cwd: checkout,
      stdio: "inherit",
    });
    if (install.error || install.status !== 0) {
      console.error(
        `ci:local --commit: npm ci failed in the worktree (${
          install.error?.code ?? `exit ${install.status}`
        }). `
          + "The gates did not run.",
      );
      return 2;
    }

    const run = spawnSync(process.execPath, [
      join(checkout, "scripts", "ci-local.mjs"),
      ...passThrough,
    ], {
      cwd: checkout,
      stdio: "inherit",
    });
    if (run.error || run.status === null) {
      console.error(
        `ci:local --commit: the gate run did not finish (${run.error?.code ?? run.signal}).`,
      );
      return 2;
    }
    return run.status;
  } catch (error) {
    // Anything thrown before the gates ran -- a full or unwritable temp
    // directory, git failing to list paths -- is a refusal, with the lock
    // released by the finally below rather than left for the next run.
    console.error(`ci:local --commit: could not set up the check: ${error?.message ?? error}`);
    return 2;
  } finally {
    cleanup();
  }
}

const WORKTREE_PREFIX = "barwise-commit-";

/**
 * Remove worktrees a killed `--commit` run left behind.
 *
 * SIGINT and SIGTERM clean up; SIGKILL cannot, and then both the directory
 * and its registration survive -- `git worktree prune` keeps a registration
 * whose directory still exists. Each run names its worktree with its pid, so
 * a worktree whose owner is no longer alive is abandoned. A live owner is
 * left alone even though this run holds the lock: the lock belongs to this
 * checkout, and another checkout of the same repository has its own lock
 * and shares the worktree list.
 */
function reapAbandonedWorktrees() {
  const list = spawnSync("git", ["worktree", "list", "--porcelain"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (list.status !== 0) return;
  for (const line of list.stdout.split("\n")) {
    if (!line.startsWith("worktree ")) continue;
    const path = line.slice("worktree ".length);
    const m = new RegExp(`/${WORKTREE_PREFIX}(\\d+)-[^/]*$`).exec(path);
    if (m === null || alive(Number(m[1]))) continue;
    rmSync(path, { recursive: true, force: true });
  }
  spawnSync("git", ["worktree", "prune"], { cwd: ROOT, stdio: "ignore" });
}

if (process.argv.includes("--commit")) {
  process.exit(runAtCommit(process.argv.slice(2)));
}

const change = changeClass();
const plan = ciSteps().map((s) => {
  if (change.cls === undefined) return { ...s, run: true, understood: true };
  return { ...s, ...shouldRun(s.condition, change.cls) };
});
const list = plan.filter((p) => p.run).map((p) => p.args);
const skipped = plan.filter((p) => !p.run);
const unread = plan.filter((p) => !p.understood);

const classLine = change.cls === undefined
  ? `Running every gate (${change.why}).`
  : `Change class: docs_only=${change.cls.docsOnly} optimizer=${change.cls.optimizer} `
    + `(${change.files} file(s) since ${change.base}, uncommitted included).`;

if (process.argv.includes("--list")) {
  console.log(classLine);
  for (const p of plan) {
    const verdict = p.run ? (p.understood ? "run " : "run?") : "skip";
    console.log(`  ${verdict}  npm ${p.args}${p.condition ? `   [if: ${p.condition}]` : ""}`);
  }
  console.log(`${list.length} run, ${skipped.length} skipped.`);
  process.exit(0);
}

acquireLock();

/**
 * Everything this run writes outside the checkout: the coverage output
 * the gates produce, and the full log of any gate that failed.
 *
 * Coverage goes here because vitest's v8 provider derives its per-worker
 * temp directory from `reportsDirectory` and clears it at the start of
 * every run, so two runs of one package delete each other's files. The
 * variable reaches the gates through `globalPassThroughEnv` in
 * turbo.json; without that line Turborepo's strict env mode drops it and
 * the run writes to `packages/*\/coverage` after all.
 */
const RUN_DIR = mkdtempSync(join(tmpdir(), "barwise-ci-"));
const COVERAGE_DIR = join(RUN_DIR, "coverage");
const LOG_DIR = join(RUN_DIR, "logs");
mkdirSync(COVERAGE_DIR, { recursive: true });
mkdirSync(LOG_DIR, { recursive: true });

process.on("exit", releaseLock);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    releaseLock();
    rmSync(RUN_DIR, { recursive: true, force: true });
    process.exit(130);
  });
}

console.log(classLine);
for (const u of unread) {
  console.log(`  not understood, so running: npm ${u.args}   [if: ${u.condition}]`);
}
console.log(`Running ${list.length} of ${plan.length} gates from ci.yml, in order.\n`);
const failed = [];
// A gate that exits 2 could not answer; it did not find anything. Reported
// apart from a failure because conflating them is the defect
// docs/specs/gate-refusal-contract.spec.md exists to remove -- and this runner
// was committing it about the gates it reports: `check-shell` and
// `check-secrets` refuse for want of shellcheck and gitleaks in any fresh
// container, and both read as "gates failed", indistinguishable from a real
// shellcheck finding or a staged credential (barwise-1012).
const refused = [];
for (const g of list) {
  process.stdout.write(`  ${g.padEnd(34)} `);
  const started = Date.now();
  const r = spawnSync("npm", g.split(/\s+/), {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, BARWISE_COVERAGE_DIR: COVERAGE_DIR },
  });
  const secs = ((Date.now() - started) / 1000).toFixed(0);
  if (r.status === 0) {
    console.log(`ok    ${secs}s`);
  } else if (r.status === 2) {
    console.log(`REFUSED  ${secs}s`);
    const log = join(LOG_DIR, logName(g));
    writeFileSync(log, `${r.stdout ?? ""}${r.stderr ?? ""}`);
    refused.push({ gate: g, out: `${r.stdout ?? ""}${r.stderr ?? ""}`, log });
  } else {
    console.log(`FAIL  ${secs}s`);
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    // The whole output, not the tail. A turbo run over twelve packages
    // puts the failing test's name thousands of lines above the summary
    // footer, so the 25-line tail this used to print never contained it:
    // diagnosing one such failure cost three separate reproduction runs
    // before the file existed.
    const log = join(LOG_DIR, logName(g));
    writeFileSync(log, out);
    failed.push({ gate: g, out, log });
  }
}

// The gates' coverage output is vitest's own bookkeeping and nothing
// reads it after the run; the logs are the part worth keeping.
rmSync(COVERAGE_DIR, { recursive: true, force: true });

for (const f of [...failed, ...refused]) {
  console.error(`\n${"=".repeat(60)}\nnpm ${f.gate}\n${"=".repeat(60)}`);
  console.error(f.out.trimEnd().split("\n").slice(-25).join("\n"));
  console.error(`\nfull output: ${f.log}`);
}

/**
 * The gates this run did not run, on EVERY exit path -- a pass, a failure
 * and a refusal alike. A runner that silently does less than it used to is
 * how a fast path becomes a hole; these lines are the evidence that it did
 * the right less, and `--all` is how to do more. Printed only on success at
 * first, so a docs-only run with one failing gate did not say what it had
 * skipped (Copilot, PR #602).
 */
function reportSkipped(write) {
  if (skipped.length === 0) return;
  write(`${skipped.length} skipped for this change, as CI skips them (--all runs them):`);
  for (const s of skipped) write(`  npm ${s.args}   [if: ${s.condition}]`);
}

// Exit 1 only for a real finding. Refusals alone exit 2, so a caller can tell
// "this tree has a problem" from "this container cannot check everything" --
// and neither prints that all gates passed, because they did not.
if (failed.length > 0) {
  console.error(`\n${failed.length} of ${list.length} gates failed.`);
  if (refused.length > 0) {
    console.error(`${refused.length} could not answer: ${refused.map((r) => r.gate).join(", ")}`);
  }
  reportSkipped(console.error);
  console.error(`Logs: ${LOG_DIR}`);
  process.exit(1);
}
if (refused.length > 0) {
  console.error(
    `\n${refused.length} of ${list.length} gates COULD NOT ANSWER; the rest passed.`,
  );
  console.error(`  ${refused.map((r) => r.gate).join("\n  ")}`);
  console.error(`Install what they name, or accept that much is unchecked.`);
  reportSkipped(console.error);
  console.error(`Logs: ${LOG_DIR}`);
  process.exit(2);
}
rmSync(RUN_DIR, { recursive: true, force: true });
console.log(`\nAll ${list.length} gates passed.`);
reportSkipped(console.log);
