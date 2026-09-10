#!/usr/bin/env node
/**
 * Run every CI gate under an enumerated set of environment faults and
 * report which ones answer, which refuse, and which print PASS blind.
 *
 * This is the probe behind `docs/specs/gate-refusal-contract.spec.md`
 * made repeatable. That reading was taken by hand once, found one false
 * green (`audit-gate`) and seven accidental crashes, and then stopped
 * existing -- so the next gate added is under the contract only if
 * someone remembers. WS3 of that spec is this file: the enumeration,
 * run on demand.
 *
 * WHY A MATRIX AND NOT A MONKEY. Chaos engineering randomises because
 * the fault space of a distributed system is too large to enumerate.
 * A gate's environment is not: wrong cwd, missing binary, `git`
 * answering emptily, shallow clone, wrong Node major. Each is written
 * down in CLAUDE.md because it drew blood. Randomising over five known
 * faults buys nothing and costs determinism, in a repository whose
 * whole discipline is that a reading you did not earn is worth less
 * than no reading.
 *
 * WHAT MAKES THE VERDICT DECIDABLE. "Exited 0 under a fault" is not by
 * itself a defect: a gate that never touches `git` is right to be
 * unmoved when `git` breaks. The distinguishing fact is whether the
 * gate reached for the thing that was broken, and that is measured
 * rather than assumed -- the `git` shim LOGS every call, so
 * `exit 0 having called git and been told nothing` is a false green by
 * observation, and `exit 0 having never called git` is independence by
 * observation. Without the log this harness would have to carry a
 * hand-maintained list of which gates use git, which is the same
 * must-agree copy the gates themselves are being audited for.
 *
 * WHAT IT REFUSES TO CONCLUDE. A gate whose UNPERTURBED run is already
 * non-zero cannot be read: every fault reading is then about whatever
 * is already wrong (shellcheck absent from a container, say), not about
 * the fault. Those rows report UNREADABLE and the harness exits 2 --
 * the contract applied to itself. A harness that scored them as
 * conforming would be the exact defect it audits.
 *
 * Usage:
 *   node scripts/fault-matrix.mjs [--only <substring>] [--node <path>]
 *                                 [--json <path>]
 *
 *   --only   restrict to gates whose script name contains the substring
 *   --node   also run the wrong-Node-major axis using this interpreter;
 *            refused unless it runs and reports a DIFFERENT major
 *   --json   write the full matrix as JSON for a follow-up reading
 *
 * Exit codes:
 *   0  every readable gate conformed on every axis run
 *   1  a finding: a false green, or a reading that changed with cwd
 *   2  refused: a gate could not be read, or an axis could not be set up
 *
 * A finding outranks a refusal because it is the more actionable of the
 * two, and the report names both regardless of which the exit code
 * carries.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ciGates } from "./lib/ci-gates.mjs";

const SCRIPTS = resolve(dirname(fileURLToPath(import.meta.url)));
const NPM_ROOT = resolve(SCRIPTS, "..");
const GIT_ROOT = resolve(NPM_ROOT, "..");

const REFUSED = 2;
const FINDING = 1;

/**
 * A refusal raised from a pure function, so the pure functions stay
 * testable. `process.exit` inside `classify` would take the test runner
 * with it, and a function that cannot be called from a test is a
 * function whose refusal path is never verified -- the defect this
 * whole spec is about, one level in. `main` converts it to exit 2.
 */
class Refusal extends Error {}

export function refuse(message) {
  throw new Refusal(message);
}

// --- deriving the gate list ------------------------------------------

/**
 * Resolve one ci.yml step to the node script it runs, or `null`.
 *
 * `run check:no-nul`            -> scripts/check-no-nul.mjs
 * `run audit:specs -- --check`  -> scripts/audit-spec-status.mjs --check
 * `run fmt:check`               -> scripts/fmt-root.mjs --check
 *                                  (the `dprint check &&` half is a
 *                                   third-party tool, out of scope)
 * `run lint`, `run build`, ...  -> null
 *
 * Ambiguity is refused rather than guessed: a script chaining two node
 * gates has no single answer for "what did this gate do", and picking
 * the first would make the second silently unaudited.
 */
export function resolveNodeGate(step, scripts) {
  if (!step.startsWith("run ")) return null;
  const [nameHalf, ...extraHalves] = step.slice(4).split(" -- ");
  const name = nameHalf.trim();
  if (name.startsWith("--")) return null; // `run --workspace=... bundle`
  const command = scripts[name];
  if (command === undefined) return null;

  const segments = command.split("&&").map((s) => s.trim());
  const matches = [];
  for (const segment of segments) {
    const m = /^node\s+(scripts\/[A-Za-z0-9._-]+\.mjs)\s*(.*)$/.exec(segment);
    if (m) matches.push({ script: m[1], args: m[2].split(/\s+/).filter(Boolean) });
  }
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    refuse(
      `npm script "${name}" runs ${matches.length} node gates in one command.\n`
        + `  This harness reads one exit code per gate and cannot attribute a\n`
        + `  shared one. Split the script, or the second gate goes unaudited.`,
    );
  }
  const extra = extraHalves.join(" -- ").split(/\s+/).filter(Boolean);
  return { name, script: matches[0].script, args: [...matches[0].args, ...extra] };
}

/** Every ci.yml step that is a node gate, in CI's order. */
export function nodeGates(steps, scripts) {
  const gates = [];
  for (const step of steps) {
    const gate = resolveNodeGate(step, scripts);
    if (gate !== null) gates.push(gate);
  }
  return gates;
}

// --- the verdict ------------------------------------------------------

const ok = (verdict) => ({ verdict, ok: true, refused: false });
const finding = (verdict) => ({ verdict, ok: false, refused: false });

/**
 * Classify one (gate, fault) reading. Pure, so it can be tested over the
 * cases the real matrix does not currently produce -- the false green
 * above all, which is the verdict that matters and the one no gate in
 * this repository still returns.
 *
 * THE AXIS KIND IS EXPLICIT because the three ask different questions,
 * and collapsing them scores a real defect as conformance. The first
 * draft of this function took `touched === undefined` to mean "judge by
 * invariance" and returned REFUSED before looking -- so when
 * `audit-gate`'s `cwd: ROOT` pin was mutated away, the gate answered 0
 * from two directories and 2 from the third, and this called it
 * conforming. `npm run mutate` reported UNCAUGHT, which is the only
 * reason it is not still doing that.
 *
 *   instrumented  the fault broke a resource and the shim counted the
 *                 gate's reaches for it. Refusing is right; answering
 *                 anyway having reached is a FALSE GREEN; never
 *                 reaching is independence, which is also right.
 *   invariant     the same tree, read from somewhere else. There is no
 *                 resource to break, so the requirement is the whole
 *                 answer: the reading must not move. A refusal from one
 *                 cwd and a pass from another is a moved reading --
 *                 exactly the shape of the defect that opened this spec.
 *   refusable     a genuinely different environment (another Node
 *                 major). Refusing is the DESIRED behaviour, because
 *                 the pin exists precisely so an unpinned runtime does
 *                 not get to answer. Same answer is fine too. A
 *                 DIFFERENT answer is the finding.
 *
 * `touched` is how many times the gate reached for the broken resource,
 * and is read only for `instrumented`.
 */
export function classify({ kind, baseline, exit, touched }) {
  if (baseline !== 0) return { verdict: "UNREADABLE", ok: false, refused: true };
  const same = exit === baseline;
  switch (kind) {
    case "invariant":
      return same ? ok("INVARIANT") : finding("READING MOVED");
    case "refusable":
      if (exit === REFUSED) return ok("REFUSED");
      return same ? ok("INVARIANT") : finding("READING MOVED");
    case "instrumented":
      if (exit === REFUSED) return ok("REFUSED");
      if (touched === 0) return same ? ok("INDEPENDENT") : finding("READING MOVED");
      if (exit === 0) return finding("FALSE GREEN");
      return finding("CRASHED");
    default:
      // Not a default case that guesses. A new axis added without a kind
      // would otherwise be scored by whichever branch happened to be
      // first, which is how the bug above got in.
      return refuse(`unknown axis kind ${JSON.stringify(kind)}`);
  }
}

// --- running one gate under one fault ---------------------------------

/**
 * The tracked tree's dirty set, read with the REAL git.
 *
 * A gate reads and reports; it must not write. This is not a
 * hypothetical: taking the first reading for this harness, an ad-hoc
 * probe invoked `audit-spec-status.mjs` with package.json's default
 * args instead of ci.yml's `--check`, and the gate REGENERATED
 * `spec-status-baseline.json`, replacing five classified rows with
 * "TODO: classify". The run reported cleanly. Deriving the args from
 * ci.yml makes that particular mistake impossible, but the class is not
 * closed by construction -- any gate could grow a write -- so the
 * invariant is asserted per gate rather than argued once.
 */
function dirtySet() {
  const r = spawnSync("git", ["status", "--porcelain"], {
    cwd: GIT_ROOT,
    encoding: "utf8",
  });
  if (r.error || r.status !== 0) {
    refuse(`could not read the working tree with git: ${r.error?.message ?? `exit ${r.status}`}`);
  }
  return r.stdout;
}

function run(gate, { cwd = NPM_ROOT, env = process.env, node = process.execPath }) {
  return spawnSync(node, [join(SCRIPTS, gate.script.replace(/^scripts\//, "")), ...gate.args], {
    cwd,
    env,
    encoding: "utf8",
    timeout: 300_000,
  });
}

/**
 * Run a gate with `git` replaced by a shim that logs and then lies.
 *
 * "empty" is the reading that looks like an answer: git exits 0 and
 * prints nothing, so `REPO_ROOT` becomes `""` and `resolve("", file)`
 * silently means cwd. "absent" is exit 127. "shallow" passes everything
 * through to the real git EXCEPT `rev-parse --is-shallow-repository`,
 * so the rest of the gate's world stays true -- a whole shallow clone
 * would change the tree under test and confound the reading with it.
 */
function withGitShim(gate, mode) {
  const dir = mkdtempSync(join(tmpdir(), "barwise-fault-"));
  try {
    const log = join(dir, "git-calls.log");
    writeFileSync(log, "");
    const real = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
    if (mode === "shallow" && real === "") {
      refuse("the shallow axis passes through to the real git, and git is not on PATH");
    }
    const body = {
      empty: "exit 0\n",
      absent: "exit 127\n",
      shallow: `if [ "$1" = "rev-parse" ] && [ "$2" = "--is-shallow-repository" ]; then\n`
        + `  echo true\n  exit 0\nfi\nexec ${JSON.stringify(real)} "$@"\n`,
    }[mode];
    const stub = join(dir, "git");
    writeFileSync(stub, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\n${body}`);
    chmodSync(stub, 0o755);
    const result = run(gate, {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}` },
    });
    const calls = readFileSync(log, "utf8").split("\n").filter(Boolean);
    // The shallow axis instruments a git that still WORKS, so a call is
    // not evidence the gate was misled. Only the answer moved, and only
    // for gates that ask -- so dependence is the shallow question asked,
    // not any git call at all.
    const relevant = mode === "shallow"
      ? calls.filter((c) => c.includes("--is-shallow-repository")).length
      : calls.length;
    return { exit: result.status, touched: relevant, calls };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- the axes ---------------------------------------------------------

/**
 * The cwd axis, spelled once. `packages/core` is the directory a person
 * or an agent is standing in when they run `node scripts/…` by hand,
 * which CLAUDE.md explicitly anticipates and which is how `audit-gate`
 * came to audit a package instead of the workspace.
 */
const CWDS = [
  ["repo root", GIT_ROOT],
  ["barwise/", NPM_ROOT],
  ["packages/core", join(NPM_ROOT, "packages", "core")],
];

function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const i = argv.indexOf(`--${name}`);
    if (i === -1) return undefined;
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) refuse(`--${name} needs a value`);
    return value;
  };
  const only = flag("only");
  const altNode = flag("node");
  const jsonPath = flag("json");

  const manifest = join(NPM_ROOT, "package.json");
  if (!existsSync(manifest)) refuse(`no package.json at ${NPM_ROOT}`);
  const scripts = JSON.parse(readFileSync(manifest, "utf8")).scripts ?? {};

  let gates = nodeGates(ciGates(), scripts);
  if (gates.length === 0) {
    refuse("ci.yml declares no node gates, which cannot be right");
  }
  if (only !== undefined) gates = gates.filter((g) => g.script.includes(only));
  if (gates.length === 0) refuse(`--only "${only}" matched no gate`);

  if (altNode !== undefined) {
    const probe = spawnSync(altNode, ["--version"], { encoding: "utf8" });
    if (probe.error || probe.status !== 0) {
      refuse(`--node ${altNode} did not run: ${probe.error?.message ?? `exit ${probe.status}`}`);
    }
    const other = probe.stdout.trim();
    const major = (v) => v.replace(/^v/, "").split(".")[0];
    if (major(other) === major(process.version)) {
      refuse(
        `--node ${altNode} reports ${other}, the same major as ${process.version}.\n`
          + `  The axis is "a DIFFERENT Node major", and this would run it against\n`
          + `  itself and report conformance it never tested.`,
      );
    }
  }

  const rows = [];
  const width = Math.max(...gates.map((g) => g.script.length));

  console.log(
    `fault-matrix: ${gates.length} node gates from ci.yml, `
      + `${altNode === undefined ? 4 : 5} axes, on ${process.version}.\n`,
  );

  const treeBefore = dirtySet();

  for (const gate of gates) {
    const base = run(gate, {});
    const baseline = base.status;
    const line = [`  ${gate.script.padEnd(width)}`];

    const record = (axis, kind, exit, touched) => {
      const c = classify({ kind, baseline, exit, touched });
      rows.push({ gate: gate.script, axis, kind, baseline, exit, touched, ...c });
      line.push(`${axis}=${c.verdict}`);
    };

    if (baseline !== 0) {
      // One row, not five: every axis reading would be about whatever is
      // already failing. Saying so once is the honest report.
      record("baseline", "invariant", baseline, undefined);
      console.log(`${line[0]}  UNREADABLE (unperturbed exit ${baseline})`);
      continue;
    }

    for (const mode of ["empty", "absent", "shallow"]) {
      const r = withGitShim(gate, mode);
      record(`git-${mode}`, "instrumented", r.exit, r.touched);
    }

    // Every cwd, not the first that differs: `audit-gate` gave the same
    // reading from two of three and a different one from `packages/core`,
    // so a two-point check would have called it invariant.
    const cwdExits = CWDS.map(([label, dir]) => [label, run(gate, { cwd: dir }).status]);
    const moved = cwdExits.find(([, e]) => e !== baseline);
    record("cwd", "invariant", moved === undefined ? baseline : moved[1], undefined);
    rows[rows.length - 1].cwdExits = Object.fromEntries(cwdExits);

    if (altNode !== undefined) {
      record("node-major", "refusable", run(gate, { node: altNode }).status, undefined);
    }

    const treeAfter = dirtySet();
    if (treeAfter !== treeBefore) {
      refuse(
        `${gate.script} WROTE to the working tree.\n`
          + `  A gate reports a reading; it must not change what it read.\n`
          + `  Before:\n${treeBefore || "    (clean)\n"}  After:\n${treeAfter}`
          + `  Restore with \`git checkout -- <path>\` before trusting any reading above.`,
      );
    }

    console.log(line.join("  "));
  }

  const findings = rows.filter((r) => !r.ok && !r.refused);
  const unreadable = rows.filter((r) => r.refused);

  console.log(
    `\n${rows.length} readings, ${findings.length} findings, ${unreadable.length} unreadable.`,
  );
  for (const f of findings) {
    const detail = f.cwdExits === undefined
      ? `exit ${f.exit}, git calls ${f.touched ?? "n/a"}`
      : Object.entries(f.cwdExits).map(([where, e]) => `${where}=${e}`).join(", ");
    console.log(`  FINDING   ${f.gate} under ${f.axis}: ${f.verdict} (${detail})`);
  }
  for (const u of unreadable) {
    console.log(
      `  UNREADABLE ${u.gate}: unperturbed exit ${u.baseline}, so no fault reading is about the fault`,
    );
  }
  console.log(
    "\nNot run: the stale-lock axis (it would have to write to uv.lock, and this\n"
      + "  harness only reads) and, without --node, the wrong-Node-major axis.",
  );

  if (jsonPath !== undefined) {
    writeFileSync(
      resolve(jsonPath),
      `${JSON.stringify({ node: process.version, rows }, null, 2)}\n`,
    );
    console.log(`\nMatrix written to ${resolve(jsonPath)}`);
  }

  if (findings.length > 0) process.exit(FINDING);
  if (unreadable.length > 0) process.exit(REFUSED);
  console.log("\nEvery readable gate conformed on every axis run. OK");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    process.stderr.write(`fault-matrix: ${error.message}\n`);
    process.exit(REFUSED);
  }
}
