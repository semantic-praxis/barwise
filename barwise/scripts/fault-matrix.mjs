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
 *                                 [--json <path>] [--all]
 *
 *   --only   restrict to gates whose script name contains the substring
 *   --node   also run the wrong-Node-major axis using this interpreter;
 *            refused unless it runs and reports a DIFFERENT major
 *   --json   write the full matrix as JSON for a follow-up reading
 *   --all    also run the steps on MATRIX_EXCEPTIONS (lib/ci-gates.mjs),
 *            which CI leaves out; the matrix itself is always left out
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
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ciGates, MATRIX_EXCEPTIONS, TOOL_EXCEPTIONS } from "./lib/ci-gates.mjs";

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

/**
 * Every ci.yml step that is a node gate, in CI's order, less the steps on
 * `MATRIX_EXCEPTIONS` unless `all` is set (the on-demand `--all`).
 */
export function nodeGates(steps, scripts, { all = false } = {}) {
  const gates = [];
  for (const step of steps) {
    const gate = resolveNodeGate(step, scripts);
    if (gate === null) continue;
    // Never itself, --all included: it would run itself under every axis.
    if (gate.script === "scripts/fault-matrix.mjs") continue;
    if (!all && Object.hasOwn(MATRIX_EXCEPTIONS, gate.name)) continue;
    gates.push(gate);
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

/**
 * `gate.file` is an absolute path for a gate that does not live in
 * `scripts/` (a test fixture); a real gate is found from `gate.script`.
 */
export function run(gate, { cwd = NPM_ROOT, env = process.env, node = process.execPath }) {
  const file = gate.file ?? join(SCRIPTS, gate.script.replace(/^scripts\//, ""));
  return spawnSync(node, [file, ...gate.args], {
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
      // Only the repository under test is shallow. A gate test builds
      // sandbox repositories of its own, and answering "true" for them too
      // reported test cases as crashing on a fault no real shallow clone
      // produces (gate-contract-enforced WS1, its code review).
      shallow: `if [ "$1" = "rev-parse" ] && [ "$2" = "--is-shallow-repository" ]; then\n`
        + `  top=$(${JSON.stringify(real)} rev-parse --show-toplevel 2>/dev/null)\n`
        + `  if [ "$top" = ${JSON.stringify(GIT_ROOT)} ]; then echo true; exit 0; fi\n`
        + `fi\nexec ${JSON.stringify(real)} "$@"\n`,
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

// --- the tool axis ----------------------------------------------------
//
// docs/specs/fault-matrix-axes.spec.md, WS1. The git shim above logs a
// lookup of a name it holds; it cannot log the lookup of a name it does
// not, so a "tool is missing" fault cannot be injected by removing a
// directory from PATH and counting. The answer is to hold EVERY name:
// the farm is a directory with one logging wrapper per executable on the
// real PATH. The unperturbed run is the record pass (it says which names
// the gate reached for), and each reached name is then deleted from the
// farm for one rerun, which is a real ENOENT rather than a simulated one.

/**
 * Names the farm holds but the tool axis never perturbs: `node` and `sh`
 * (the wrappers and every gate need them) and `git` (it has its own axes).
 */
const FARM_BASE = new Set(["node", "sh", "git"]);

const shq = (s) => `'${String(s).replaceAll("'", `'\\''`)}'`;

/**
 * Every executable on `path`, first directory winning, as `Map<name, file>`.
 */
function executablesOn(path) {
  const found = new Map();
  for (const raw of path.split(delimiter)) {
    if (raw === "") continue;
    // A relative entry ("." or node_modules/.bin) would be exec'd relative
    // to whatever cwd a gate runs in; resolve it once, here.
    const dir = resolve(raw);
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (found.has(name)) continue;
      const file = join(dir, name);
      try {
        if (!statSync(file).isFile()) continue;
        accessSync(file, constants.X_OK);
      } catch {
        continue;
      }
      found.set(name, file);
    }
  }
  return found;
}

/**
 * Build the farm: `{ dir, log, names }`. Each wrapper appends
 * `<parent pid> <name>` to one log with a single `printf`, which O_APPEND
 * keeps whole under concurrent writers, and then `exec`s the real binary.
 * The parent pid is what lets the matrix tell the gate's own call from the
 * transitive ones npm and npx make (see `reachedTools`).
 */
export function buildFarm({ path = process.env.PATH ?? "" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "barwise-farm-"));
  const log = join(dir, ".calls.log");
  writeFileSync(log, "");
  const names = executablesOn(path);
  for (const [name, real] of names) {
    const wrapper = join(dir, name);
    writeFileSync(
      wrapper,
      `#!/bin/sh\nprintf '%s %s\\n' "$PPID" ${shq(name)} >> ${shq(log)}\nexec ${shq(real)} "$@"\n`,
    );
    chmodSync(wrapper, 0o755);
  }
  return { dir, log, names: new Set(names.keys()) };
}

/** The log as `[{ ppid, name }]`, in call order. */
export function readFarmLog(farm) {
  return readFileSync(farm.log, "utf8").split("\n").filter(Boolean).map((line) => {
    const [ppid, ...rest] = line.split(" ");
    return { ppid: Number(ppid), name: rest.join(" ") };
  });
}

/**
 * The instrument must be able to say it is blind. A wrapper that logs
 * nothing (a shell that cannot write the log, a `git` the farm failed to
 * hold) reads as "no gate reaches any tool", every row INDEPENDENT, and
 * the axis would report a clean matrix over nothing. So: call `git` through
 * the farm and require this process to be named as its parent.
 */
export function farmCanary(farm) {
  writeFileSync(farm.log, "");
  const r = spawnSync("git", ["--version"], { env: { ...process.env, PATH: farm.dir } });
  if (r.error || r.status !== 0) {
    refuse(
      `the tool axis cannot call git through its wrapper farm: ${
        r.error?.message ?? `exit ${r.status}`
      }`,
    );
  }
  if (!readFarmLog(farm).some((e) => e.name === "git" && e.ppid === process.pid)) {
    refuse(
      "the tool axis' wrapper farm did not log a call to git made by this process,\n"
        + "  so it would read every gate as reaching no tool. The instrument is blind.",
    );
  }
  writeFileSync(farm.log, "");
}

/**
 * The names a gate reached for itself: calls whose PARENT is the gate's
 * own process, less `FARM_BASE`, as `Map<name, count>`. Calls with any
 * other parent are transitive (npm calling `env`, `uname`, `dirname`):
 * deleting one of those crashes npm, not the gate, and would read as a
 * false finding. What still slips through goes on `TOOL_EXCEPTIONS`.
 */
export function reachedTools(entries, pid) {
  const reached = new Map();
  for (const { ppid, name } of entries) {
    if (ppid !== pid || FARM_BASE.has(name)) continue;
    reached.set(name, (reached.get(name) ?? 0) + 1);
  }
  return reached;
}

/** `TOOL_EXCEPTIONS` names that no gate reached: a stale declaration. */
export function staleToolExceptions(exceptions, reachedByGate) {
  const seen = new Set();
  for (const names of reachedByGate) for (const n of names.keys()) seen.add(n);
  return Object.keys(exceptions).filter((n) => !seen.has(n));
}

/** The farm's directory as the whole PATH: a name not in it does not exist. */
const farmEnv = (farm) => ({ ...process.env, PATH: farm.dir });

/**
 * Delete `name`'s wrapper for the duration of `fn`, then put it back.
 * The farm is shared by every gate, so the restore is in a `finally`.
 */
function withoutWrapper(farm, name, fn) {
  const wrapper = join(farm.dir, name);
  const body = readFileSync(wrapper, "utf8");
  rmSync(wrapper);
  try {
    return fn();
  } finally {
    writeFileSync(wrapper, body);
    chmodSync(wrapper, 0o755);
  }
}

/**
 * The tool axis for one gate. The record pass is the gate's unperturbed
 * run on the farm, so it doubles as the baseline: a gate the farm itself
 * breaks fails unperturbed and reads UNREADABLE, not as a finding. Then one
 * rerun per counted name with that wrapper deleted.
 *
 * Returns `{ record, raw, counted, readings }`; `raw` is every name reached
 * before `TOOL_EXCEPTIONS`, `counted` the names perturbed, and `readings`
 * the `{ axis, exit, touched }` of each rerun. Nothing is perturbed when the
 * record pass is not 0.
 */
export function toolAxis(gate, farm, { cwd } = {}) {
  writeFileSync(farm.log, "");
  const record = run(gate, { env: farmEnv(farm), cwd });
  const raw = reachedTools(readFarmLog(farm), record.pid);
  const counted = new Map([...raw].filter(([n]) => !Object.hasOwn(TOOL_EXCEPTIONS, n)));
  const readings = [];
  if (record.status === 0) {
    for (const [name, touched] of counted) {
      if (!farm.names.has(name)) continue;
      const exit = withoutWrapper(farm, name, () => run(gate, { env: farmEnv(farm), cwd }).status);
      readings.push({ axis: `tool-${name}`, exit, touched });
    }
  }
  return { record, raw, counted, readings };
}

/**
 * The gates' tool reach that the wrapper cannot see: a probe that never
 * execs (`command -v`, `which`) and a tool named by absolute path. Over the
 * gate's source and the relative modules it imports. A LISTING for the
 * report's footer, not a gate: a hit does not say the gate is wrong, only
 * that INDEPENDENT on that gate is weaker than it looks (the shadow, not
 * the property).
 */
const UNSEEN_REACH = [
  ["command -v", /command -v/],
  ["which", /["'`]which\b/],
  ["absolute tool path", /["'`]\/(?:usr|bin|sbin|opt)\//],
  ["node_modules/.bin", /node_modules[/"',\s]+\.bin/],
];

export function unseenToolReach(file, seen = new Set()) {
  if (seen.has(file)) return [];
  seen.add(file);
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const code = text.split("\n").filter((l) => !/^\s*(\/\/|\/?\*)/.test(l)).join("\n");
  const hits = UNSEEN_REACH.filter(([, re]) => re.test(code)).map(([label]) => label);
  for (const m of code.matchAll(/(?:from\s+|import\()\s*["'](\.{1,2}\/[^"']+\.mjs)["']/g)) {
    hits.push(...unseenToolReach(resolve(dirname(file), m[1]), seen));
  }
  return [...new Set(hits)];
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
  const all = argv.includes("--all");

  const manifest = join(NPM_ROOT, "package.json");
  if (!existsSync(manifest)) refuse(`no package.json at ${NPM_ROOT}`);
  const scripts = JSON.parse(readFileSync(manifest, "utf8")).scripts ?? {};

  let gates = nodeGates(ciGates(), scripts, { all });
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
  const reached = [];
  const width = Math.max(...gates.map((g) => g.script.length));

  console.log(
    `fault-matrix: ${gates.length} node gates from ci.yml, `
      + `${altNode === undefined ? 5 : 6} axes, on ${process.version}.\n`,
  );

  const treeBefore = dirtySet();

  // The farm is built and its canary passed before any gate runs: a blind
  // instrument refuses the run rather than reading every gate as independent.
  const farm = buildFarm();
  const removeFarm = () => rmSync(farm.dir, { recursive: true, force: true });
  process.on("exit", removeFarm);
  // A CI cancel or Ctrl-C skips "exit" handlers; remove the farm there too.
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.once(sig, () => {
      removeFarm();
      process.exit(2);
    });
  }
  farmCanary(farm);
  const reachedByGate = [];
  const unseen = [];

  for (const gate of gates) {
    // The unperturbed run is the tool axis' record pass, on the farm, so a
    // gate the farm breaks reads UNREADABLE instead of as a finding.
    const tools = toolAxis(gate, farm);
    const base = tools.record;
    const baseline = base.status;
    const line = [`  ${gate.script.padEnd(width)}`];

    const record = (axis, kind, exit, touched) => {
      const c = classify({ kind, baseline, exit, touched });
      rows.push({ gate: gate.script, axis, kind, baseline, exit, touched, ...c });
      line.push(`${axis}=${c.verdict}`);
    };

    // Counted before the readable check: a TOOL_EXCEPTIONS name reached only
    // by a gate that is UNREADABLE today is not stale.
    reachedByGate.push(tools.raw);
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

    for (const t of tools.readings) record(t.axis, "instrumented", t.exit, t.touched);
    const blind = unseenToolReach(join(SCRIPTS, gate.script.replace(/^scripts\//, "")));
    if (blind.length > 0) unseen.push([gate.script, blind]);
    reached.push([gate.script, [...tools.counted.keys()]]);

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

  // A stale TOOL_EXCEPTIONS name is judged only on a full run: under --only
  // the gate that reaches it may simply not have been selected.
  if (only === undefined) {
    for (const name of staleToolExceptions(TOOL_EXCEPTIONS, reachedByGate)) {
      rows.push({
        gate: "scripts/lib/ci-gates.mjs",
        axis: `tool-${name}`,
        kind: "instrumented",
        verdict: "STALE EXCEPTION",
        ok: false,
        refused: false,
      });
    }
  }

  const findings = rows.filter((r) => !r.ok && !r.refused);
  const unreadable = rows.filter((r) => r.refused);

  console.log("\nPer axis (tool-<name> readings are one axis, `tool`):");
  const axes = new Map();
  for (const r of rows) {
    const axis = r.axis.startsWith("tool-") ? "tool" : r.axis;
    const counts = axes.get(axis) ?? new Map();
    counts.set(r.verdict, (counts.get(r.verdict) ?? 0) + 1);
    axes.set(axis, counts);
  }
  for (const [axis, counts] of axes) {
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    const detail = [...counts].map(([v, n]) => `${n} ${v}`).join(", ");
    console.log(`  ${axis.padEnd(12)} ${String(total).padStart(3)} readings: ${detail}`);
  }

  // Printed every run so a set that shrinks (a wrapper that stopped
  // logging, a gate that stopped calling a tool) shows as a diff here
  // rather than as the silent absence of a row.
  const withTools = reached.filter(([, names]) => names.length > 0);
  console.log("\nTools reached by the record pass (parent = the gate's own process):");
  for (const [script, names] of withTools) {
    console.log(`  ${script.padEnd(width)}  ${names.join(", ")}`);
  }
  console.log(
    `  reached-tool set: ${
      [...new Set(withTools.flatMap(([, n]) => n))].sort().join(", ") || "(none)"
    }; `
      + `${reached.length - withTools.length} gate(s) reach none.`,
  );

  console.log(
    `\n${rows.length} readings, ${findings.length} findings, ${unreadable.length} unreadable.`,
  );
  for (const f of findings) {
    const detail = f.cwdExits === undefined
      ? `exit ${f.exit}, ${f.axis.startsWith("tool-") ? "tool" : "git"} calls ${f.touched ?? "n/a"}`
      : Object.entries(f.cwdExits).map(([where, e]) => `${where}=${e}`).join(", ");
    console.log(
      f.verdict === "STALE EXCEPTION"
        ? `  FINDING   TOOL_EXCEPTIONS names ${f.axis.slice(5)}, which no gate reached`
        : `  FINDING   ${f.gate} under ${f.axis}: ${f.verdict} (${detail})`,
    );
  }
  for (const u of unreadable) {
    console.log(
      `  UNREADABLE ${u.gate}: unperturbed exit ${u.baseline}, so no fault reading is about the fault`,
    );
  }
  console.log(
    "\nNot run: the stale-lock axis (it would have to write to uv.lock, and this\n"
      + "  harness only reads) and, without --node, the wrong-Node-major axis.\n"
      + "  A missing manifest or lockfile is each gate's own precondition and is not\n"
      + "  perturbed here (gate-refusal-contract, decision 2).\n"
      + "  Tools unseen by the tool axis: one reached by absolute path (dprint under\n"
      + "  fmt:check), one probed without an exec (command -v, which), and one a\n"
      + "  shell starts beneath the gate. A reading of INDEPENDENT does not cover them.",
  );
  if (unseen.length > 0) {
    console.log("  Gates whose source probes or names a tool the wrappers cannot see:");
    for (const [script, labels] of unseen) {
      console.log(`    ${script.padEnd(width)}  ${labels.join(", ")}`);
    }
  }

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
