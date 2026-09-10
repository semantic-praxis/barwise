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
 * `--list` prints the gates without running them. A failure does not stop
 * the run: every gate reports, so one pass shows all the breakage rather
 * than the first of it.
 *
 * A run holds a lock, points coverage at a directory of its own, and
 * keeps the complete output of every failing gate on disk -- see
 * `docs/specs/local-ci-isolation.spec.md` (barwise-960) for why each of
 * those three exists.
 */
import { spawnSync } from "node:child_process";
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
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ciGates } from "./lib/ci-gates.mjs";

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
function acquireLock() {
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
        process.exit(1);
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

const list = ciGates();
if (process.argv.includes("--list")) {
  for (const g of list) console.log(`npm ${g}`);
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

console.log(`Running ${list.length} gates from ci.yml, in order.\n`);
const failed = [];
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

if (failed.length > 0) {
  for (const f of failed) {
    console.error(`\n${"=".repeat(60)}\nnpm ${f.gate}\n${"=".repeat(60)}`);
    console.error(f.out.trimEnd().split("\n").slice(-25).join("\n"));
    console.error(`\nfull output: ${f.log}`);
  }
  console.error(`\n${failed.length} of ${list.length} gates failed.`);
  console.error(`Logs: ${LOG_DIR}`);
  process.exit(1);
}
rmSync(RUN_DIR, { recursive: true, force: true });
console.log(`\nAll ${list.length} gates passed.`);
