#!/usr/bin/env node
/**
 * The instruments for docs/specs/effect-comparison.spec.md, in one place.
 *
 *   startup   [--runs N] [--no-build]   G4: `barwise validate` on the reference
 *                                       model, npm build and release bundle
 *   bundles   [--no-build]              R2: vscode and CLI bundle sizes
 *   malformed [--json] [--format 3.0]   D2 (and effect-adoption S4): how the
 *                                       loader reports malformed object
 *                                       types, fact types and constraints;
 *                                       --format 3.0 scores the 3.0 cases
 *                                       (effect-adoption 1r)
 *   corpus    [--write D | --read D]    effect-adoption S1 (1r): each tracked
 *                                       model's 3.0 bytes, hashed, strict and
 *                                       lenient, for comparing two heads;
 *                                       --write keeps the 3.0 text in D,
 *                                       --read lists D's files instead
 *   typecheck [--runs N]                effect-adoption S6: core's cold
 *                                       type-check time and instantiations
 *   diff      <base> [<head>]           D1, R1, R3: what a change touched
 *   trial     --base <ref> [--path P]   D3: a trial branch left the held-out
 *                                       oracle alone
 *   heldout   --task t1|t2 --path P     D3: what the task asked for, checked
 *                                       against a run's built core
 *   usage     <transcript.jsonl>        D3: input tokens a run processed, from
 *             [--turns]                 its own transcript; --turns adds each
 *                                       turn's counts, and nothing else, so
 *                                       the figure can be checked from a
 *                                       committed record
 *
 * Exit codes follow the gate-refusal contract
 * (docs/specs/gate-refusal-contract.spec.md): 0 measured (and, for
 * `startup` and `trial`, passed), 1 measured and failed, 2 could not
 * answer -- the build is missing, a ref does not resolve, git is absent.
 * `typecheck` reports and never fails on a reading: S6 is a measure, not a
 * gate (effect-adoption.spec.md, owner decision 2026-10-15).
 * `malformed`, `bundles` and `diff` report and never fail: what they
 * measure is compared in WS4, not judged here.
 *
 * Builds that feed a measurement run with `--force`: a cached rebuild
 * after a revert once left the vscode bundle holding reverted code
 * (barwise-r7j).
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { cpus, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { committedPaths, uncommittedPaths } from "./lib/changed-class.mjs";
import { corpusListing } from "./lib/corpus-listing.mjs";
import {
  ambiguityReport,
  caseProblem,
  combine,
  scoreDocument,
  summarize,
} from "./lib/malformed-score.mjs";
import { median } from "./lib/median.mjs";
import { keeps, preservations, refusals } from "./lib/schema-cases.mjs";
import { REPO_ROOT } from "./lib/tracked.mjs";

const BARWISE = join(REPO_ROOT, "barwise");
// The 2.0 schema, frozen when 3.0 landed: the trial tasks and the malformed
// fixtures were grounded on 2.0 documents, so their cases come from the 2.0
// schema whatever the current format is (orm-format-3 WS4b-ii).
const SCORER_SCHEMA = fileURLToPath(
  new URL("../packages/core/schemas/orm-model-2.0.schema.json", import.meta.url),
);
const CLI_DIST = join(BARWISE, "packages/cli/dist/index.js");
const CLI_BUNDLE = join(BARWISE, "packages/cli/dist/bundle/index.cjs");
const REFERENCE_MODEL = join(BARWISE, "examples/models/learning-design.orm.yaml");
const MALFORMED_DIR = join(BARWISE, "packages/core/tests/fixtures/malformed");
const COUNT_HOOK = join(BARWISE, "scripts/lib/module-count-hook.mjs");
/** G4: the limit, and why -- about where a wait starts to break a train of thought. */
const LIMIT_MS = 1000;
/** The tree's own compiler: a reading taken with another tree's tsc is not this tree's. */
const TSC = join(BARWISE, "node_modules/typescript/bin/tsc");
const CORE_DIR = join(BARWISE, "packages/core");

/**
 * Paths a trial branch may not change: the oracle it is scored against,
 * and the instruments that score it. The arm brief forbids "the WS0 tests,
 * the law tests or any golden file"; a golden is matched by name anywhere
 * under a package's tests, because they live in four layouts today (a
 * `golden/` directory, `goldens/`, `*.golden.txt`, `*.golden.test.ts`)
 * and a list of directories would miss the next one.
 */
/**
 * The `scripts/lib` modules this script runs: every one it imports, and the
 * hook it loads by path. Read from this file's own source rather than
 * listed, because a listed set was left behind twice -- `malformed-score`
 * missing from the first version, `median` from the next (Copilot, PR #641).
 * An import added here is protected without anyone remembering to.
 */
const INSTRUMENT_LIBS = [
  ...[
    ...readFileSync(fileURLToPath(import.meta.url), "utf8").matchAll(
      /from "\.\/lib\/([\w-]+\.mjs)"/g,
    ),
  ]
    .map((m) => m[1]),
  basename(COUNT_HOOK),
];

const PROTECTED = [
  /^barwise\/scripts\/measure-comparison\.mjs$/,
  ...INSTRUMENT_LIBS.map((f) => new RegExp(`^barwise/scripts/lib/${f.replace(".", "\\.")}$`)),
  /^barwise\/scripts\/tests\/measure-comparison\.test\.mjs$/,
  /^barwise\/packages\/core\/tests\/serialization\/objectTypeLayout\.test\.ts$/,
  /^barwise\/packages\/core\/tests\/serialization\/schemaDataTypes\.test\.ts$/,
  /^barwise\/packages\/core\/tests\/fixtures\/malformed\//,
  /^barwise\/packages\/[^/]+\/tests\/laws\//,
  /\.law\.test\.[cm]?[jt]s$/,
  /^barwise\/packages\/[^/]+\/tests\/(.*\/)?[^/]*golden/i,
  /^barwise\/packages\/promptlab\/tests\/referenceDrift\.test\.ts$/,
  /\.reference\.orm\.yaml$/,
];

function refuse(message) {
  process.stderr.write(`measure-comparison: ${message}\n`);
  process.exit(2);
}

function git(args, cwd = REPO_ROOT) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function run(command, args, cwd = BARWISE) {
  const r = spawnSync(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  // An executable that cannot start returns status null and no stderr.
  if (r.error) refuse(`\`${command}\` could not be started: ${r.error.message}`);
  if (r.status !== 0) {
    refuse(`\`${command} ${args.join(" ")}\` failed:\n${(r.stderr ?? "").slice(-2000)}`);
  }
}

function environment() {
  let commit;
  let dirty;
  try {
    commit = git(["rev-parse", "HEAD"]).trim();
    dirty = git(["status", "--porcelain"]).trim() !== "";
  } catch {
    refuse(
      "git could not name the commit being measured, and a reading without one cannot be compared.",
    );
  }
  return {
    date: new Date().toISOString(),
    commit,
    dirty,
    node: process.version,
    cpu: cpus()[0]?.model ?? "unknown",
    cpus: cpus().length,
  };
}

/**
 * The value after `name`, or undefined when the flag is absent. A flag given
 * with no value refuses: `trial --base HEAD --path` used to measure the
 * repository root instead of the worktree the caller meant.
 */
function flag(args, name) {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) refuse(`${name} needs a value.`);
  return value;
}

// -- startup ---------------------------------------------------------------

function timeOnce(args, env = process.env) {
  const t0 = process.hrtime.bigint();
  const r = spawnSync(process.execPath, args, { cwd: BARWISE, stdio: "ignore", env });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  if (r.status !== 0) {
    refuse(`\`node ${args.join(" ")}\` exited ${r.status}; a failing command has no startup time.`);
  }
  return ms;
}

/**
 * `--runs`, or `fallback`. Exit 1 means a measurement over a limit, so a
 * count that measures nothing has to refuse rather than report a median of
 * no samples.
 */
function runsFlag(args, fallback) {
  const given = args.includes("--runs") ? flag(args, "--runs") : fallback;
  if (!/^[1-9][0-9]*$/.test(given ?? "")) {
    refuse(`--runs takes a positive integer, not ${given ?? "nothing"}.`);
  }
  return Number(given);
}

function startup(args) {
  const runs = runsFlag(args, "15");
  if (!args.includes("--no-build")) {
    run("npx", [
      "turbo",
      "run",
      "build",
      "--filter=...@barwise/cli",
      "--force",
      "--output-logs=errors-only",
    ]);
    run("npm", ["run", "--workspace=@barwise/cli", "bundle"]);
  }
  for (const f of [CLI_DIST, CLI_BUNDLE, REFERENCE_MODEL]) {
    if (!existsSync(f)) refuse(`${f} is missing; build first or drop --no-build.`);
  }
  const subjects = {
    "npm validate": [CLI_DIST, "validate", REFERENCE_MODEL],
    "bundle validate": [CLI_BUNDLE, "validate", REFERENCE_MODEL],
    "npm --version": [CLI_DIST, "--version"],
  };
  const times = Object.fromEntries(Object.keys(subjects).map((k) => [k, []]));
  // Alternated, so drift on a shared machine lands on every subject alike.
  for (let i = 0; i < runs; i++) {
    for (const [name, a] of Object.entries(subjects)) times[name].push(timeOnce(a));
  }
  const dir = mkdtempSync(join(tmpdir(), "measure-comparison-"));
  const out = join(dir, "count.json");
  timeOnce(["--import", COUNT_HOOK, ...subjects["npm validate"]], {
    ...process.env,
    MODULE_COUNT_OUT: out,
  });
  const loaded = JSON.parse(readFileSync(out, "utf8"));
  rmSync(dir, { recursive: true, force: true });

  const result = {
    environment: environment(),
    model: "examples/models/learning-design.orm.yaml",
    runs,
    medianMs: Object.fromEntries(Object.entries(times).map(([k, v]) => [k, Math.round(median(v))])),
    rangeMs: Object.fromEntries(
      Object.entries(times).map((
        [k, v],
      ) => [k, [Math.round(Math.min(...v)), Math.round(Math.max(...v))]]),
    ),
    npmValidateLoads: { modules: loaded.modules, megabytes: +(loaded.bytes / 1048576).toFixed(2) },
    limitMs: LIMIT_MS,
  };
  result.g4 =
    result.medianMs["npm validate"] < LIMIT_MS && result.medianMs["bundle validate"] < LIMIT_MS
      ? "pass"
      : "fail";
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.g4 === "pass" ? 0 : 1;
}

// -- typecheck -------------------------------------------------------------

/**
 * One cold type-check of core: `--incremental false`, because core's
 * tsconfig is incremental and a warm `.tsbuildinfo` makes the second run
 * of anything fast. Reads tsc's own `--extendedDiagnostics` totals rather
 * than timing the process, so node's start-up is not in the number.
 */
function typecheckOnce() {
  const r = spawnSync(
    process.execPath,
    [TSC, "--noEmit", "--incremental", "false", "--extendedDiagnostics", "-p", "tsconfig.json"],
    { cwd: CORE_DIR, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" },
  );
  if (r.error) refuse(`tsc could not be started: ${r.error.message}`);
  if (r.status !== 0) {
    refuse(
      `core does not type-check, and a failing type-check has no time:\n${
        (r.stdout + r.stderr).slice(-2000)
      }`,
    );
  }
  const seconds = /^Total time:\s+([0-9.]+)s$/m.exec(r.stdout)?.[1];
  const instantiations = /^Instantiations:\s+([0-9]+)$/m.exec(r.stdout)?.[1];
  if (seconds === undefined || instantiations === undefined) {
    refuse("tsc ran but printed no Total time or Instantiations, so there is nothing to read.");
  }
  return { ms: Number(seconds) * 1000, instantiations: Number(instantiations) };
}

function typecheck(args) {
  const runs = runsFlag(args, "3");
  if (!existsSync(TSC)) refuse(`${TSC} is missing; run npm ci in this tree first.`);
  if (!existsSync(join(CORE_DIR, "tsconfig.json"))) refuse(`${CORE_DIR}/tsconfig.json is missing.`);
  const readings = Array.from({ length: runs }, typecheckOnce);
  const times = readings.map((r) => r.ms);
  const result = {
    environment: environment(),
    runs,
    medianMs: Math.round(median(times)),
    rangeMs: [Math.round(Math.min(...times)), Math.round(Math.max(...times))],
    // Deterministic for one tree: reported to explain a time, never judged.
    instantiations: median(readings.map((r) => r.instantiations)),
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

// -- bundles ---------------------------------------------------------------

function bundles(args) {
  if (!args.includes("--no-build")) {
    run("npx", [
      "turbo",
      "run",
      "build",
      "--filter=...barwise-vscode",
      "--force",
      "--output-logs=errors-only",
    ]);
    run("npm", ["run", "--workspace=@barwise/cli", "bundle"]);
  }
  const files = {
    "vscode client": "packages/vscode/dist/client/extension.js",
    "vscode mcp": "packages/vscode/dist/mcp/index.js",
    "vscode server": "packages/vscode/dist/server/OrmLanguageServer.js",
    "vscode webview": "packages/vscode/dist/webview/main.js",
    "cli bundle": "packages/cli/dist/bundle/index.cjs",
  };
  const bytes = {};
  for (const [name, rel] of Object.entries(files)) {
    const path = join(BARWISE, rel);
    if (!existsSync(path)) refuse(`${rel} is missing; build first or drop --no-build.`);
    bytes[name] = statSync(path).size;
  }
  process.stdout.write(`${JSON.stringify({ environment: environment(), bytes }, null, 2)}\n`);
  return 0;
}

// -- malformed -------------------------------------------------------------

/**
 * The fixture sets, by the format they are written in. The 2.0 set is the
 * comparison's and WS0's; the 3.0 set restates it at 3.0 and adds the
 * rules 3.0 brought (effect-adoption.spec.md, 1r, R0).
 */
const MALFORMED_SETS = { "2.0": MALFORMED_DIR, "3.0": join(MALFORMED_DIR, "3.0") };

async function malformed(args) {
  const format = flag(args, "--format") ?? "2.0";
  const dir = MALFORMED_SETS[format];
  if (!dir) refuse(`--format ${format}: one of ${Object.keys(MALFORMED_SETS).join(", ")}.`);
  const manifestPath = join(dir, "cases.json");
  if (!existsSync(manifestPath)) refuse(`${manifestPath} is missing.`);
  let loader;
  try {
    const core = await import("@barwise/core");
    loader = new core.OrmYamlSerializer();
  } catch (error) {
    refuse(`@barwise/core could not be loaded (build it first): ${error.message.split("\n")[0]}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const { cases } = manifest;
  // The fixtures say what they are written in; the flag only picks the set.
  const version = manifest.orm_version ?? "2.0";
  if (version !== format) refuse(`${manifestPath} states orm_version ${version}, not ${format}.`);
  const read = (file) => readFileSync(join(dir, file), "utf8");
  let results;
  let all;
  try {
    results = cases.map((c) => ({
      file: c.file,
      ...scoreDocument(read(c.file), [caseProblem(c, read(c.file)).problem], loader),
    }));
    all = combine(cases, read, version);
  } catch (error) {
    // A manifest the scorer cannot read is no reading, not a finding.
    refuse(`the ${format} cases cannot be scored: ${error.message}`);
  }
  const combined = scoreDocument(all.yaml, all.problems, loader);
  const ambiguity = ambiguityReport([...results, combined]);
  if (ambiguity) refuse(ambiguity);

  if (args.includes("--json")) {
    process.stdout.write(
      `${JSON.stringify({ environment: environment(), format, results, combined }, null, 2)}\n`,
    );
    return 0;
  }
  const one = (r) => {
    const s = summarize(r);
    const constraint = s.inConstraint > 0
      ? `  constraint named ${s.namesConstraint}/${s.inConstraint}`
      : "";
    return `${
      s.outcome.padEnd(8)
    } reported ${s.reported}/${s.problems}  named ${s.namesElement}${constraint}  silent losses ${s.silentLosses}`;
  };
  for (const r of results) process.stdout.write(`${r.file.padEnd(40)} ${one(r)}\n`);
  process.stdout.write(`${"combined (every case in one file)".padEnd(40)} ${one(combined)}\n`);
  return 0;
}

// -- corpus ----------------------------------------------------------------

/** Every file under `dir`, as paths relative to it, sorted. */
function filesUnder(dir, prefix = "") {
  return readdirSync(join(dir, prefix), { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory() ? filesUnder(dir, join(prefix, e.name)) : [join(prefix, e.name)]
    )
    .sort();
}

async function corpus(args) {
  const writeDir = flag(args, "--write");
  const readDir = flag(args, "--read");
  if (writeDir && readDir) refuse("--write and --read are two runs, on two heads; give one.");
  let loader;
  try {
    const core = await import("@barwise/core");
    loader = new core.OrmYamlSerializer();
  } catch (error) {
    refuse(`@barwise/core could not be loaded (build it first): ${error.message.split("\n")[0]}`);
  }
  // Tracked files, asked of git: a checkout holds untracked trial outputs
  // CI never sees, and a listing of them would differ between worktrees.
  let texts;
  try {
    const files = readDir
      ? filesUnder(resolve(readDir)).map((f) => [f, join(resolve(readDir), f)])
      : git(["ls-files", "--", "*.orm.yaml"]).trim().split("\n").filter(Boolean)
        .map((f) => [f, join(REPO_ROOT, f)]);
    texts = new Map(files.map(([f, abs]) => [f, readFileSync(abs, "utf8")]));
  } catch (error) {
    refuse(`the corpus could not be read: ${error.message.split("\n")[0]}`);
  }
  const written = writeDir ? new Map() : undefined;
  const lines = corpusListing(texts, loader, written);
  for (const [f, text] of written ?? []) {
    const out = join(resolve(writeDir), f);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, text);
  }
  process.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

// -- diff ------------------------------------------------------------------

function diff(args) {
  const [base, head = "HEAD"] = args;
  if (!base) refuse("diff needs a base ref: diff <base> [<head>].");
  try {
    git(["rev-parse", "--verify", `${base}^{commit}`]);
    git(["rev-parse", "--verify", `${head}^{commit}`]);
  } catch {
    refuse(`${base} or ${head} does not name a commit.`);
  }
  // `:(glob)` with `**`: a bare `packages/*/src` pathspec matches the
  // directory name only, and the first version of this counted zero files.
  const scope = [":(glob)barwise/packages/*/src/**", "barwise/packages/core/schemas/**"];
  const numstat = git(["diff", "--numstat", base, head, "--", ...scope]).trim().split("\n").filter(
    Boolean,
  );
  const files = numstat.map((l) => {
    const [added, removed, path] = l.split("\t");
    return { path, added: Number(added), removed: Number(removed) };
  });
  const hunks = (git(["diff", "-U0", base, head, "--", ...scope]).match(/^@@ /gm) ?? []).length;
  const slice = /^barwise\/packages\/core\/src\/(model|serialization)\//;
  const sliceFiles = files.filter((f) => slice.test(f.path)).map((f) => {
    let lines = 0;
    try {
      lines = git(["show", `${head}:${f.path}`]).split("\n").length - 1;
    } catch {
      lines = 0; // deleted at head
    }
    return { path: f.path, lines };
  });
  const result = {
    base,
    head,
    files: files.length,
    hunks,
    added: files.reduce((n, f) => n + f.added, 0),
    removed: files.reduce((n, f) => n + f.removed, 0),
    consumerFiles: files.filter((f) => !slice.test(f.path)).map((f) => f.path),
    sliceLines: sliceFiles.reduce((n, f) => n + f.lines, 0),
    sliceFiles,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

// -- trial -----------------------------------------------------------------

function trial(args) {
  const base = flag(args, "--base");
  const path = flag(args, "--path") ?? REPO_ROOT;
  if (!base) refuse("trial needs --base <ref>.");
  let changed;
  try {
    git(["rev-parse", "--verify", `${base}^{commit}`], path);
    // A trial commits some of its work and leaves some uncommitted, and a
    // file it ADDED and never committed is as much a change to the oracle as
    // one it edited. The same union ci-local classifies a change by, from
    // the module that owns it: a hand-written copy here once missed
    // untracked files entirely (check:git-listing keeps it from coming back).
    changed = [...new Set([...committedPaths(base, path), ...uncommittedPaths(path)])];
  } catch {
    refuse(`git could not diff ${path} against ${base}.`);
  }
  const touched = changed.filter((f) => PROTECTED.some((re) => re.test(f)));
  process.stdout.write(
    `${
      JSON.stringify({ base, path, changed: changed.length, protectedTouched: touched }, null, 2)
    }\n`,
  );
  return touched.length === 0 ? 0 : 1;
}

// -- heldout ---------------------------------------------------------------

/**
 * The task's own requirements, checked against a run's built `@barwise/core`.
 *
 * The oracle a run is scored by is the suite as the run left it, so it
 * checks only what the run's own tests check. Pilot run plain-t1-p1 passed
 * it while accepting `unit: ""` and diffing an absent unit as `""`, so
 * adding or removing that value reported no change (Copilot, PR #653). These
 * cases are held out: they live here, outside both arm branches, and a run
 * never sees them.
 *
 * Arm-neutral by construction: only the surface the brief keeps the same in
 * both arms -- YAML load and save, the JSON Schema validator,
 * `OrmModel.addObjectType`, `diffModels` -- and outcomes rather than names,
 * so a change kind may be called anything as long as a change is reported.
 */
async function heldout(args) {
  const task = flag(args, "--task");
  const path = flag(args, "--path");
  // Own keys only: `toString` or `constructor` would otherwise pass this
  // check and fail as a scored run, exit 1, not as a refusal (Copilot, PR #662).
  if (!Object.hasOwn(HELD_OUT, task ?? "")) {
    refuse(`heldout needs --task ${Object.keys(HELD_OUT).join(" or ")}, not ${task ?? "(none)"}.`);
  }
  if (!path) refuse("heldout needs --path <worktree of the run>.");
  // Resolved once, against the caller's directory, and imported by URL: a
  // bare relative path is checked against cwd but imported as a package
  // specifier, or against this script's own directory (Copilot, PR #653).
  const dist = join(resolve(path), "barwise/packages/core/dist");
  if (!existsSync(join(dist, "index.js"))) {
    refuse(`no built core at ${dist}; run npm run build in the run's tree first.`);
  }
  let core;
  let diffModule;
  try {
    core = await import(pathToFileURL(join(dist, "index.js")).href);
    diffModule = await import(pathToFileURL(join(dist, "diff/index.js")).href);
  } catch (error) {
    refuse(`could not load the run's built core: ${error?.message ?? error}`);
  }
  // The file schema the generated cases are derived from: this checkout's,
  // fixed when the task was grounded, not the run's, which the run could edit.
  // Found from this script's own path, not REPO_ROOT: that follows the
  // caller's cwd, so a scorer run from inside a trial worktree would read the
  // trial's schema, and a constraint deleted there would delete its case
  // without touching a protected file (Copilot, PR #662).
  // A schema the generator cannot account for is a refusal, not fewer cases.
  let caseList;
  try {
    const schema = JSON.parse(readFileSync(SCORER_SCHEMA, "utf8"));
    caseList = HELD_OUT[task]({ ...core, diffModels: diffModule.diffModels, schema });
  } catch (error) {
    refuse(`could not build the held-out cases: ${error?.message ?? error}`);
  }
  const cases = caseList.map(
    ([name, check]) => {
      try {
        return { name, ok: check() === true };
      } catch (error) {
        return { name, ok: false, error: String(error?.message ?? error).split("\n")[0] };
      }
    },
  );

  const failed = cases.filter((c) => !c.ok).length;
  process.stdout.write(
    `${JSON.stringify({ task, path, passed: cases.length - failed, failed, cases }, null, 2)}\n`,
  );
  return failed === 0 ? 0 : 1;
}

const throws = (fn) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};

/** T1, add an optional `unit` to value types (Appendix B). */
function t1Cases({ OrmModel, OrmYamlSerializer, SchemaValidator, diffModels }) {
  const yaml = new OrmYamlSerializer();

  const doc = (fields) => ({
    orm_version: "2.0",
    model: {
      name: "Heldout",
      object_types: [{ id: "ot-1", name: "Weight", kind: "value", ...fields }],
    },
  });
  const toYaml = (fields) => yaml.serialize(yaml.deserialize(JSON.stringify(doc(fields))));
  const load = (fields) => yaml.deserialize(JSON.stringify(doc(fields)));
  const weightDelta = (a, b) =>
    diffModels(load(a), load(b)).deltas.find((d) => d.elementType === "object_type");

  /** Refused by `make`, or accepted and then kept by a save and a load and seen by the diff. */
  const emptyUnitIsRefusedOrOrdinary = (make) => {
    if (throws(() => make({ unit: "" }))) return true;
    const kept = yaml.deserialize(yaml.serialize(make({ unit: "" }))).objectTypes[0].unit === "";
    const kindOf = (a, b) =>
      diffModels(make(a), make(b)).deltas.find((d) => d.elementType === "object_type")?.kind;
    return kept && kindOf({}, { unit: "" }) === "modified"
      && kindOf({ unit: "" }, {}) === "modified";
  };

  return [
    // Values, not text: `unit: "kg"` is as correct as `unit: kg`, and a text
    // check would send a correct run back for a round it did not need.
    ["a value type's unit survives a save and a load", () => {
      const once = load({ unit: "kg" });
      const twice = yaml.deserialize(yaml.serialize(once));
      return once.objectTypes[0].unit === "kg" && twice.objectTypes[0].unit === "kg";
    }],
    // A key written for every value type would change every existing file
    // (G2), so absence is checked in the text as well as in the value.
    ["a value type without a unit writes none", () => {
      const text = toYaml({});
      return !/\bunit\b/.test(text) && yaml.deserialize(text).objectTypes[0].unit === undefined;
    }],
    [
      "a file's entity type carrying a unit is refused",
      () => throws(() => load({ kind: "entity", reference_mode: "weight_id", unit: "kg" })),
    ],
    [
      "the JSON Schema allows a unit on a value type",
      () => new SchemaValidator().validateModel(doc({ unit: "kg" })).valid === true,
    ],
    ["the JSON Schema forbids a unit on an entity type", () =>
      new SchemaValidator().validateModel(
        doc({ kind: "entity", reference_mode: "weight_id", unit: "kg" }),
      ).valid === false],
    [
      "construction keeps a value type's unit",
      () =>
        new OrmModel({ name: "Heldout" }).addObjectType({
          name: "Weight",
          kind: "value",
          unit: "kg",
        })
          .unit === "kg",
    ],
    [
      "construction refuses an entity type's unit",
      () =>
        throws(() =>
          new OrmModel({ name: "Heldout" }).addObjectType({
            name: "Weight",
            kind: "entity",
            referenceMode: "weight_id",
            unit: "kg",
          })
        ),
    ],
    [
      "the diff reports a changed unit",
      () => weightDelta({ unit: "kg" }, { unit: "lb" })?.kind === "modified",
    ],
    ["the diff reports an added unit", () => weightDelta({}, { unit: "kg" })?.kind === "modified"],
    ["the diff reports a removed unit", () => weightDelta({ unit: "kg" }, {})?.kind === "modified"],
    [
      "the diff reports nothing for an unchanged unit",
      () => weightDelta({ unit: "kg" }, { unit: "kg" })?.kind === "unchanged",
    ],
    // The task leaves an empty unit open, so either answer passes. What does
    // not is half an answer. Stated once, for each way in: refused, or
    // accepted and then an ordinary value -- kept through a save and a load,
    // and seen arriving and leaving by the diff. Each review of PR #653 found
    // another half-answer the cases had let through (blind diff, then a
    // refusal in one way in only, then a save that drops it); one rule asked
    // of both ways in closes the family rather than the instance. A model
    // built in code that the file format then refuses fails here too: it
    // cannot be saved and loaded.
    [
      "an empty unit in a file is refused, or kept and diffed like any value",
      () => emptyUnitIsRefusedOrOrdinary((fields) => load(fields)),
    ],
    [
      "an empty unit from code is refused, or kept and diffed like any value",
      () =>
        emptyUnitIsRefusedOrOrdinary((fields) => {
          const m = new OrmModel({ name: "Heldout" });
          m.addObjectType({ name: "Weight", kind: "value", ...fields });
          return m;
        }),
    ],
  ];
}

/**
 * T2, convert `SubtypeFact` to a sealed record (Appendix C).
 *
 * "Sealed record" is checked as both arms already built `ObjectType`: a
 * plain object, frozen, carrying only its declared fields -- not as either
 * arm spells it. The rest holds what the base already does (defaults,
 * refusals, the YAML layout, the diff) so a conversion that loses one fails
 * here, plus the one rule the task adds: code refuses what a file refuses.
 * The base accepts `definingRule: { storage: "nope" }` from code, writes it,
 * and then refuses the file it wrote.
 */
const BASE_SUBTYPE_YAML = [
  "subtype_facts:",
  "    - id: sf-1",
  "      subtype: ot-b",
  "      supertype: ot-a",
  "      provides_identification: false",
  "      is_exclusive: true",
  "      is_exhaustive: true",
  "      defining_rule:",
  "        kind: semiderived",
  "        expression: e",
  "        storage: derived_and_stored",
  "",
].join("\n");

/** YAML key to config key for a subtype fact and its defining rule. */
const SUBTYPE_FACT_KEYS = {
  id: "id",
  subtype: "subtypeId",
  supertype: "supertypeId",
  provides_identification: "providesIdentification",
  is_exclusive: "isExclusive",
  is_exhaustive: "isExhaustive",
  defining_rule: ["definingRule", {
    kind: "kind",
    storage: "storage",
    expression: "expression",
    is_formal: "isFormal",
  }],
};

function t2Cases({ OrmModel, OrmYamlSerializer, diffModels, schema }) {
  const yaml = new OrmYamlSerializer();
  const FIELDS = new Set([
    "id",
    "subtypeId",
    "supertypeId",
    "providesIdentification",
    "isExclusive",
    "isExhaustive",
    "definingRule",
  ]);
  const doc = (subtypeFact) => ({
    orm_version: "2.0",
    model: {
      name: "Heldout",
      object_types: [
        { id: "ot-a", name: "Person", kind: "entity", reference_mode: "person_id" },
        { id: "ot-b", name: "Employee", kind: "entity", reference_mode: "employee_id" },
      ],
      subtype_facts: [{ id: "sf-1", subtype: "ot-b", supertype: "ot-a", ...subtypeFact }],
    },
  });
  const load = (subtypeFact = {}) => yaml.deserialize(JSON.stringify(doc(subtypeFact)));
  const twoTypes = () => {
    const m = new OrmModel({ name: "Heldout" });
    const a = m.addObjectType({ name: "Person", kind: "entity", referenceMode: "person_id" });
    const b = m.addObjectType({ name: "Employee", kind: "entity", referenceMode: "employee_id" });
    return { m, a, b };
  };
  const built = (config = {}) => {
    const { m, a, b } = twoTypes();
    // A copy, so a run that edits its input in place cannot edit the fixture
    // the case later compares against (Copilot, PR #662).
    return m.addSubtypeFact({ subtypeId: b.id, supertypeId: a.id, ...structuredClone(config) });
  };
  const RULE = {
    kind: "derived",
    storage: "derived_and_stored",
    expression: "each Employee is a Person who is employed",
    isFormal: true,
  };
  /** A defining rule's four fields, compared with what was given. */
  const sameRule = (r, want) =>
    r !== undefined && r.kind === want.kind && r.expression === want.expression
    && r.storage === want.storage && r.isFormal === want.isFormal;
  const isRecord = (sf) =>
    Object.getPrototypeOf(sf) === Object.prototype && Object.isFrozen(sf)
    // Every own key, not only the enumerable ones: a derived name or a method
    // hidden with defineProperty is still on the record (Copilot, PR #662).
    && Reflect.ownKeys(sf).every((k) => FIELDS.has(k));
  const subtypeDelta = (a, b) =>
    diffModels(load(a), load(b)).deltas.find((d) => d.elementType === "subtype_fact");
  // Endpoint ids come from the model each case builds, so the generated
  // configs carry placeholders swapped for that model's ids.
  const withIds = (config, a, b) => {
    const out = { ...config };
    if (out.subtypeId === "@sub") out.subtypeId = b.id;
    if (out.supertypeId === "@super") out.supertypeId = a.id;
    return out;
  };
  const generated = () => {
    const opts = {
      base: {
        subtype_fact: { subtypeId: "@sub", supertypeId: "@super" },
        "subtype_fact.defining_rule": { kind: "derived", expression: "e" },
      },
    };
    const refused = refusals(schema, "subtype_fact", SUBTYPE_FACT_KEYS, {
      ...opts,
      codeOptional: ["subtype_fact.id"],
    }).map(({ path, why, config }) => [
      `code refuses what a file refuses: ${path} ${why}`,
      () => {
        const { m, a, b } = twoTypes();
        return throws(() => m.addSubtypeFact(withIds(config, a, b)));
      },
    ]);
    const kept = preservations(schema, "subtype_fact", SUBTYPE_FACT_KEYS, {
      ...opts,
      fromBase: ["subtype_fact.subtype", "subtype_fact.supertype"],
    }).map(({ path, value, config }) => [
      `code keeps what it was given, through a save and a load: ${path} = ${JSON.stringify(value)}`,
      () => {
        const { m, a, b } = twoTypes();
        const given = withIds(config, a, b);
        const absent = {
          "definingRule.storage": "derive_on_request",
          "definingRule.isFormal": false,
        };
        // A copy: `given` is the expected value, and a constructor that
        // deletes from its input would otherwise delete from it too.
        const sf = m.addSubtypeFact(structuredClone(given));
        // Exact on the record; the serializer's omissions apply only after a
        // save and a load (Copilot, PR #662).
        return keeps(sf, given)
          && keeps(yaml.deserialize(yaml.serialize(m)).subtypeFacts[0], given, absent);
      },
    ]);
    return [...refused, ...kept];
  };

  return [
    [
      "a subtype fact built in code is a plain, frozen record of its fields",
      // With a rule and without: a conversion that freezes only one path is
      // not sealed (Copilot, PR #662).
      () => isRecord(built({ definingRule: RULE })) && isRecord(built()),
    ],
    [
      "a subtype fact loaded from a file is a plain, frozen record of its fields",
      () =>
        isRecord(load({ defining_rule: { kind: "derived", expression: "e" } }).subtypeFacts[0])
        && isRecord(load().subtypeFacts[0]),
    ],
    // Its values first: `Object.isFrozen(undefined)` is true, so a freeze
    // check alone passes a run that drops the rule (Copilot, PR #662).
    [
      "a subtype fact's defining rule is kept and frozen, from code and from a file",
      () => {
        const fileRule = {
          kind: "derived",
          expression: "e",
          storage: "derived_and_stored",
          is_formal: true,
        };
        const fromFile = {
          kind: "derived",
          expression: "e",
          storage: "derived_and_stored",
          isFormal: true,
        };
        const keptFrozen = (r, want) => sameRule(r, want) && Object.isFrozen(r);
        return keptFrozen(built({ definingRule: RULE }).definingRule, RULE)
          && keptFrozen(load({ defining_rule: fileRule }).subtypeFacts[0].definingRule, fromFile);
      },
    ],
    [
      "a subtype fact without a defining rule carries no definingRule key",
      () => !("definingRule" in built()) && !("definingRule" in load().subtypeFacts[0]),
    ],
    ["defaults: provides identification, not exclusive, not exhaustive", () => {
      const fromCode = built();
      const fromFile = load().subtypeFacts[0];
      return [fromCode, fromFile].every((sf) =>
        sf.providesIdentification === true && sf.isExclusive === false
        && sf.isExhaustive === false
      );
    }],
    [
      "an explicit id is kept, and one is made when absent",
      () =>
        built({ id: "sf-9" }).id === "sf-9" && typeof built().id === "string"
        && built().id.length > 0,
    ],
    ["construction refuses a subtype of itself", () => {
      const { m, a } = twoTypes();
      return throws(() => m.addSubtypeFact({ subtypeId: a.id, supertypeId: a.id }));
    }],
    ["construction refuses a subtype fact naming an absent type", () => {
      const { m, a } = twoTypes();
      return throws(() => m.addSubtypeFact({ subtypeId: "missing", supertypeId: a.id }));
    }],
    ["construction refuses a duplicate subtype fact", () => {
      const { m, a, b } = twoTypes();
      m.addSubtypeFact({ subtypeId: b.id, supertypeId: a.id });
      return throws(() => m.addSubtypeFact({ subtypeId: b.id, supertypeId: a.id }));
    }],
    // A subtype relation is between entity types; the base refuses a value
    // type at either end, and the task keeps the refusals (Copilot, PR #662).
    ["construction refuses a value type as the subtype", () => {
      const { m, a } = twoTypes();
      const v = m.addObjectType({ name: "Code", kind: "value" });
      return throws(() => m.addSubtypeFact({ subtypeId: v.id, supertypeId: a.id }));
    }],
    ["construction refuses a value type as the supertype", () => {
      const { m, a } = twoTypes();
      const v = m.addObjectType({ name: "Code", kind: "value" });
      return throws(() => m.addSubtypeFact({ subtypeId: a.id, supertypeId: v.id }));
    }],
    // Text, unlike T1's values: the task keeps the YAML layout, so a file
    // written before the conversion must come back exactly as it was.
    ["a subtype fact with every field survives a save and a load unchanged", () => {
      const text = yaml.serialize(load({
        provides_identification: false,
        is_exclusive: true,
        is_exhaustive: true,
        defining_rule: { kind: "semiderived", expression: "e", storage: "derived_and_stored" },
      }));
      const back = yaml.deserialize(text).subtypeFacts[0];
      return yaml.serialize(yaml.deserialize(text)) === text
        && back.providesIdentification === false
        && back.isExclusive === true && back.isExhaustive === true
        && back.definingRule?.storage === "derived_and_stored";
    }],
    // The layout itself, which the round trip above cannot see: a run that
    // reorders or renames keys agrees with itself. Both arm heads write
    // exactly this (2026-10-15); G2's layout test covers object types only.
    ["a subtype fact is written as the base writes it", () => {
      const text = yaml.serialize(load({
        provides_identification: false,
        is_exclusive: true,
        is_exhaustive: true,
        defining_rule: { kind: "semiderived", expression: "e", storage: "derived_and_stored" },
      }));
      return text.slice(text.lastIndexOf("subtype_facts:")) === BASE_SUBTYPE_YAML;
    }],
    ["a file's subtype of itself is refused", () => throws(() => load({ supertype: "ot-b" }))],
    [
      "the diff reports a changed subtype fact",
      () => subtypeDelta({}, { is_exclusive: true })?.kind === "modified",
    ],
    [
      "the diff reports nothing for an unchanged subtype fact",
      () => subtypeDelta({ is_exclusive: true }, { is_exclusive: true })?.kind === "unchanged",
    ],
    // Generated from the file schema (scripts/lib/schema-cases.mjs): the one
    // rule the task adds -- code refuses what a file refuses -- one case per
    // constraint, and what code was given kept through a save and a load,
    // one case per value. A hand list of each fell behind the schema at every
    // review of PR #662.
    ...generated(),
  ];
}

const HELD_OUT = { t1: t1Cases, t2: t2Cases };

// -- usage -----------------------------------------------------------------

/**
 * What a run cost in input, read from its transcript.
 *
 * The harness reports one token figure per agent, and the pilot recorded it
 * as D3's measure. It is not the run's cost: it equals the agent's final
 * context, about 129,400 against a reported 130,146 for main-trial run
 * plain-t1-m1, while the same run's turns read 4.09 million input tokens
 * between them. And it is cumulative, so summing it over rounds -- as WS3
 * said to -- counts the first round twice.
 *
 * Each assistant turn's usage record carries the input it read (uncached,
 * cache read, cache written), which is known before the turn generates and
 * so is complete. Output counts are not: they are captured when the stream
 * starts, a few tokens per turn, and are left out rather than reported short.
 * A turn split across several records shares one message id and is counted
 * once.
 *
 * `--turns` adds the three input counters of every counted turn, in order.
 * The transcript itself is not committable -- it holds the prompts, the
 * tool output and the served model -- so the per-turn counts are what lets a
 * reader recompute inputProcessed without it.
 *
 * A run sent back for another round receives that feedback with
 * `origin.kind` "coordinator", in one of two records: a user record when
 * the run had stopped, or a `queued_command` attachment when it was still
 * busy (a background job of its own running), which carries the origin on
 * the attachment. Each starts a new round. Reading only the first form
 * folded effect-t1-r3's two rounds into one. The
 * per-round totals are reported because a reading that drops a round (the
 * primer check's adjusted D3) cannot be recomputed from the totals alone,
 * and the harness's per-round figure is the final context, not the input
 * the round read (Copilot, PR #659). The marker is the record's structure,
 * not the feedback's wording, so rewording the feedback cannot move it.
 */
function usage(args) {
  const withTurns = args.includes("--turns");
  const [file, ...extra] = args.filter((a) => a !== "--turns");
  if (!file) refuse("usage needs a transcript: usage <transcript.jsonl> [--turns].");
  if (extra.length > 0) refuse(`usage takes one transcript, not ${extra.length + 1}.`);
  if (!existsSync(file)) refuse(`no transcript at ${file}.`);
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    refuse(`could not read ${file}: ${error?.message ?? error}`);
  }
  // A record that does not parse is refused, not skipped: a truncated last
  // line would otherwise drop that turn and report a smaller total as a
  // reading (Copilot, PR #654). Blank lines carry nothing and are skipped.
  const turns = new Map();
  let round = 1;
  let turnsThisRound = 0;
  for (const [index, line] of text.split("\n").entries()) {
    if (line.trim() === "") continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      refuse(`${file}:${index + 1} is not a JSON record; the transcript may be truncated.`);
    }
    const message = entry?.message;
    // Feedback before the round has any turn (none so far) is not a new
    // round: there is nothing yet to close.
    const fromCoordinator = (message?.role === "user" && entry?.origin?.kind === "coordinator")
      || (entry?.type === "attachment" && entry.attachment?.type === "queued_command"
        && entry.attachment.origin?.kind === "coordinator");
    if (fromCoordinator && turnsThisRound > 0) {
      round += 1;
      turnsThisRound = 0;
      continue;
    }
    if (message?.role !== "assistant" || !message.usage) continue;
    // A counter that is missing, a string or negative would add a wrong
    // number to the total and still exit 0 (Copilot, PR #654): refused.
    const u = message.usage;
    const counter = (name, required) => {
      const value = u[name];
      if (value === undefined && !required) return;
      if (!Number.isInteger(value) || value < 0) {
        refuse(`${file}:${index + 1}: ${name} is ${JSON.stringify(value)}, not a count of tokens.`);
      }
    };
    counter("input_tokens", true);
    counter("cache_read_input_tokens", false);
    counter("cache_creation_input_tokens", false);
    const id = message.id ?? `line-${turns.size}`;
    if (!turns.has(id)) {
      turns.set(id, { u, round });
      turnsThisRound += 1;
    }
  }
  if (turns.size === 0) refuse(`${file} holds no assistant turn with a usage record.`);
  const contextOf = (u) =>
    (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  const counted = [...turns.values()];
  const contexts = counted.map(({ u }) => contextOf(u));
  const rounds = [];
  for (const [i, { round: r }] of counted.entries()) {
    const last = rounds.at(-1);
    if (last?.round === r) {
      last.turns += 1;
      last.inputProcessed += contexts[i];
    } else rounds.push({ round: r, turns: 1, inputProcessed: contexts[i] });
  }
  const result = {
    file,
    turns: turns.size,
    inputProcessed: contexts.reduce((a, b) => a + b, 0),
    finalContext: contexts.at(-1),
    rounds,
  };
  if (withTurns) {
    result.perTurn = counted.map(({ u, round: r }) => ({
      round: r,
      input: u.input_tokens,
      cacheRead: u.cache_read_input_tokens ?? 0,
      cacheCreation: u.cache_creation_input_tokens ?? 0,
    }));
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

const [command, ...rest] = process.argv.slice(2);
const commands = {
  startup,
  typecheck,
  bundles,
  malformed,
  corpus,
  diff,
  trial,
  heldout,
  usage,
};
if (!commands[command]) {
  refuse(`unknown subcommand ${command ?? "(none)"}; one of ${Object.keys(commands).join(", ")}.`);
}
process.exit(await commands[command](rest));
