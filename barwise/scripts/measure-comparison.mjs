#!/usr/bin/env node
/**
 * The instruments for docs/specs/effect-comparison.spec.md, in one place.
 *
 *   startup   [--runs N] [--no-build]   G4: `barwise validate` on the reference
 *                                       model, npm build and release bundle
 *   bundles   [--no-build]              R2: vscode and CLI bundle sizes
 *   malformed [--json]                  D2: how the loader reports malformed
 *                                       object types
 *   diff      <base> [<head>]           D1, R1, R3: what a change touched
 *   trial     --base <ref> [--path P]   D3: a trial branch left the held-out
 *                                       oracle alone
 *   heldout   --task t1 --path P        D3: what the task asked for, checked
 *                                       against a run's built core
 *
 * Exit codes follow the gate-refusal contract
 * (docs/specs/gate-refusal-contract.spec.md): 0 measured (and, for
 * `startup` and `trial`, passed), 1 measured and failed, 2 could not
 * answer -- the build is missing, a ref does not resolve, git is absent.
 * `malformed`, `bundles` and `diff` report and never fail: what they
 * measure is compared in WS4, not judged here.
 *
 * Builds that feed a measurement run with `--force`: a cached rebuild
 * after a revert once left the vscode bundle holding reverted code
 * (barwise-r7j).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { committedPaths, uncommittedPaths } from "./lib/changed-class.mjs";
import {
  ambiguityReport,
  caseProblem,
  combine,
  scoreDocument,
  summarize,
} from "./lib/malformed-score.mjs";
import { median } from "./lib/median.mjs";
import { REPO_ROOT } from "./lib/tracked.mjs";

const BARWISE = join(REPO_ROOT, "barwise");
const CLI_DIST = join(BARWISE, "packages/cli/dist/index.js");
const CLI_BUNDLE = join(BARWISE, "packages/cli/dist/bundle/index.cjs");
const REFERENCE_MODEL = join(BARWISE, "examples/models/learning-design.orm.yaml");
const MALFORMED_DIR = join(BARWISE, "packages/core/tests/fixtures/malformed");
const COUNT_HOOK = join(BARWISE, "scripts/lib/module-count-hook.mjs");
/** G4: the limit, and why -- about where a wait starts to break a train of thought. */
const LIMIT_MS = 1000;

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

function startup(args) {
  const given = args.includes("--runs") ? flag(args, "--runs") : "15";
  // Exit 1 means a measurement over the limit, so a count that measures
  // nothing has to refuse rather than report a median of no samples.
  if (!/^[1-9][0-9]*$/.test(given ?? "")) {
    refuse(`--runs takes a positive integer, not ${given ?? "nothing"}.`);
  }
  const runs = Number(given);
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

async function malformed(args) {
  const manifestPath = join(MALFORMED_DIR, "cases.json");
  if (!existsSync(manifestPath)) refuse(`${manifestPath} is missing.`);
  let loader;
  try {
    const core = await import("@barwise/core");
    loader = new core.OrmYamlSerializer();
  } catch (error) {
    refuse(`@barwise/core could not be loaded (build it first): ${error.message.split("\n")[0]}`);
  }
  const { cases } = JSON.parse(readFileSync(manifestPath, "utf8"));
  const read = (file) => readFileSync(join(MALFORMED_DIR, file), "utf8");
  const results = cases.map((c) => ({
    file: c.file,
    ...scoreDocument(read(c.file), [caseProblem(c, read(c.file)).problem], loader),
  }));
  const all = combine(cases, read);
  const combined = scoreDocument(all.yaml, all.problems, loader);
  const ambiguity = ambiguityReport([...results, combined]);
  if (ambiguity) refuse(ambiguity);

  if (args.includes("--json")) {
    process.stdout.write(
      `${JSON.stringify({ environment: environment(), results, combined }, null, 2)}\n`,
    );
    return 0;
  }
  const one = (r) => {
    const s = summarize(r);
    return `${
      s.outcome.padEnd(8)
    } reported ${s.reported}/${s.problems}  named ${s.namesElement}  silent losses ${s.silentLosses}`;
  };
  for (const r of results) process.stdout.write(`${r.file.padEnd(40)} ${one(r)}\n`);
  process.stdout.write(`${"combined (every case in one file)".padEnd(40)} ${one(combined)}\n`);
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
  if (task !== "t1") refuse("heldout needs --task t1 (the only task with held-out cases).");
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
  const { OrmModel, OrmYamlSerializer, SchemaValidator } = core;
  const { diffModels } = diffModule;
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
  const throws = (fn) => {
    try {
      fn();
      return false;
    } catch {
      return true;
    }
  };

  /** Refused by `make`, or accepted and then kept by a save and a load and seen by the diff. */
  const emptyUnitIsRefusedOrOrdinary = (make) => {
    if (throws(() => make({ unit: "" }))) return true;
    const kept = yaml.deserialize(yaml.serialize(make({ unit: "" }))).objectTypes[0].unit === "";
    const kindOf = (a, b) =>
      diffModels(make(a), make(b)).deltas.find((d) => d.elementType === "object_type")?.kind;
    return kept && kindOf({}, { unit: "" }) === "modified"
      && kindOf({ unit: "" }, {}) === "modified";
  };

  const cases = [
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
  ].map(([name, check]) => {
    try {
      return { name, ok: check() === true };
    } catch (error) {
      return { name, ok: false, error: String(error?.message ?? error).split("\n")[0] };
    }
  });

  const failed = cases.filter((c) => !c.ok).length;
  process.stdout.write(
    `${JSON.stringify({ task, path, passed: cases.length - failed, failed, cases }, null, 2)}\n`,
  );
  return failed === 0 ? 0 : 1;
}

const [command, ...rest] = process.argv.slice(2);
const commands = { startup, bundles, malformed, diff, trial, heldout };
if (!commands[command]) {
  refuse(`unknown subcommand ${command ?? "(none)"}; one of ${Object.keys(commands).join(", ")}.`);
}
process.exit(await commands[command](rest));
