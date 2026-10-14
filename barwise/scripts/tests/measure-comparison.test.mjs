/**
 * The instruments of docs/specs/effect-comparison.spec.md measure what they
 * claim to.
 *
 * The malformed-input scorer measures rather than asserts, so the only
 * thing that can go wrong silently is the scorer itself: a loss it fails to
 * see, or a message credited to the wrong object type. These tests plant
 * each and check the reading.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { ambiguityReport, combine, lostKeys, scoreDocument } from "../lib/malformed-score.mjs";
import { median } from "../lib/median.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "measure-comparison.mjs");
const FIXTURES = join(HERE, "..", "..", "packages", "core", "tests", "fixtures", "malformed");

const DOC = `orm_version: "2.0"
model:
  name: M
  object_types:
    - id: ot-supplier
      name: Supplier
      kind: entity
      reference_mode: supplier_id
      data_type:
        name: integer
`;
const SUPPLIER = { id: "ot-supplier", name: "Supplier", field: "data_type", index: 0 };

test("a loader that drops a field is scored as a silent loss, not a success", () => {
  const dropping = {
    deserialize: (yaml) => yaml,
    serialize: (yaml) => yaml.replace(/\n {6}data_type:\n {8}name: integer/, ""),
  };
  const r = scoreDocument(DOC, [SUPPLIER], dropping);
  assert.equal(r.outcome, "loaded");
  assert.deepEqual(r.silentLosses, [{ id: "ot-supplier", key: "data_type" }]);
  assert.equal(r.problems[0].reported, false);
});

test("a loader that refuses with the element and field named is credited with both", () => {
  const refusing = {
    deserialize: () => {
      throw Object.assign(new Error("2 problems"), {
        problems: [{ message: 'Entity type "Supplier" cannot have data_type.' }],
      });
    },
    serialize: () => "",
  };
  const r = scoreDocument(DOC, [SUPPLIER], refusing);
  assert.equal(r.outcome, "refused");
  assert.deepEqual(r.problems, [{
    id: "ot-supplier",
    field: "data_type",
    reported: true,
    namesElement: true,
  }]);
});

test("a schema path credits only the object type at that index", () => {
  const cases = [
    { file: "a", id: "ot-a", name: "Alpha", field: "data_type" },
    { file: "b", id: "ot-b", name: "Beta", field: "data_type" },
  ];
  const read = (f) =>
    `orm_version: "2.0"\nmodel:\n  name: M\n  object_types:\n    - id: ot-${f}\n      name: X\n      kind: value\n`;
  const { problems } = combine(cases, read);
  assert.deepEqual(problems.map((p) => p.index), [0, 1]);
  const schemaFailure = {
    deserialize: () => {
      throw Object.assign(new Error("schema"), {
        validationResult: {
          errors: [{ path: "/model/object_types/1/data_type/name", message: "must be one of" }],
        },
      });
    },
    serialize: () => "",
  };
  const r = scoreDocument("unused", problems, schemaFailure);
  assert.deepEqual(r.problems.map((p) => [p.id, p.reported, p.namesElement]), [
    ["ot-a", false, false],
    ["ot-b", true, false],
  ]);
});

test("one message listing several problems is flagged, not credited to each", () => {
  // Effect Schema's default formatter reports every problem in one block of
  // text. Read as one message, it would name each field and each object
  // type somewhere, and every problem would be credited.
  const cases = [
    { file: "a", field: "data_type" },
    { file: "b", field: "reference_mode" },
  ];
  const read = (f) =>
    `orm_version: "2.0"\nmodel:\n  name: M\n  object_types:\n    - id: ot-${f}\n      name: Type${f.toUpperCase()}\n      kind: value\n`;
  const { problems } = combine(cases, read);
  const blob = {
    deserialize: () => {
      throw new Error(
        'Malformed\n└─ ["object_types"]\n   ├─ TypeA: reference_mode is not allowed\n   └─ TypeB: data_type is not allowed',
      );
    },
    serialize: () => "",
  };
  const r = scoreDocument("unused", problems, blob);
  assert.deepEqual(r.ambiguous.map((a) => a.ids), [["ot-a", "ot-b"]]);
  assert.match(ambiguityReport([r]), /\[ot-a, ot-b\] Malformed/);
});

test("a bracketed path credits the object type at that index, as a JSON pointer does", () => {
  const cases = [
    { file: "a", field: "data_type" },
    { file: "b", field: "data_type" },
  ];
  const read = (f) =>
    `orm_version: "2.0"\nmodel:\n  name: M\n  object_types:\n    - id: ot-${f}\n      name: X\n      kind: value\n`;
  const { problems } = combine(cases, read);
  const effectStyle = {
    deserialize: () => {
      throw Object.assign(new Error("schema"), {
        problems: ['["model"]["object_types"][1]["data_type"]["name"]: Expected a known type'],
      });
    },
    serialize: () => "",
  };
  const r = scoreDocument("unused", problems, effectStyle);
  assert.deepEqual(r.problems.map((p) => [p.id, p.reported]), [["ot-a", false], ["ot-b", true]]);
  assert.deepEqual(r.ambiguous, []);
});

test("today's loader reports one problem per message, so its reading is not refused", () => {
  // The six messages today's loader gives for the combined file, as
  // recorded by `measure-comparison malformed --json` on 78b52f5b. Held as
  // text because script tests run before the build in CI, so @barwise/core
  // cannot be loaded here.
  const messages = [
    "/model/object_types/1: must have required property 'reference_mode'",
    '/model/object_types/1: must match "then" schema',
    "/model/object_types/6/cardinality/min: must be >= 0",
    "/model/object_types/7/value_constraint/values: must NOT have fewer than 1 items",
    "/model/object_types/9/data_type/name: must be equal to one of the allowed values",
    "/model/object_types/10: must NOT have additional properties",
  ];
  const { cases } = JSON.parse(readFileSync(join(FIXTURES, "cases.json"), "utf8"));
  const { problems } = combine(cases, (f) => readFileSync(join(FIXTURES, f), "utf8"));
  const todays = {
    deserialize: () => {
      throw Object.assign(new Error("schema"), {
        validationResult: {
          errors: messages.map((m) => ({
            path: m.split(": ")[0],
            message: m.split(": ").slice(1).join(": "),
          })),
        },
      });
    },
    serialize: () => "",
  };
  const r = scoreDocument("unused", problems, todays);
  assert.equal(ambiguityReport([r]), null);
  assert.equal(r.problems.filter((p) => p.reported).length, 4);
});

test("an object type missing after the round trip is reported field by field", () => {
  assert.deepEqual(lostKeys(DOC, "model:\n  object_types: []\n").map((l) => l.key), [
    "id",
    "name",
    "kind",
    "reference_mode",
    "data_type",
  ]);
});

test("an unknown subcommand and an unresolvable ref are refusals, not readings", () => {
  assert.equal(spawnSync(process.execPath, [SCRIPT, "nonesuch"]).status, 2);
  assert.equal(spawnSync(process.execPath, [SCRIPT, "diff", "no-such-ref-anywhere"]).status, 2);
});

test("heldout refuses rather than reads when it has no task, no tree, or no built core", () => {
  // A run whose core was never built must not read as eight failed cases:
  // that would charge the agent for the scorer's own missing step.
  const run = (...args) =>
    spawnSync(process.execPath, [SCRIPT, "heldout", ...args], { encoding: "utf8" });
  assert.equal(run("--path", "/").status, 2, "no --task");
  assert.equal(run("--task", "t1").status, 2, "no --path");
  const empty = mkdtempSync(join(tmpdir(), "heldout-"));
  try {
    const r = run("--task", "t1", "--path", empty);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /no built core/);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

/**
 * A stand-in for a run's built core: just the surface the held-out cases
 * use, small enough to read, so the cases themselves are under test rather
 * than a real build. JSON stands in for YAML, which it is a subset of.
 * Each way an empty unit arrives is set apart: `fileEmpty` and `codeEmpty`
 * are "refuse" or "accept", `diffBlind` diffs it as if absent, and
 * `lossySave` drops a falsy unit when saving. Pilot run p1 accepted it both
 * ways and diffed it blind.
 */
function fakeCore(
  {
    fileEmpty = "refuse",
    codeEmpty = "refuse",
    diffBlind = false,
    lossySave = false,
    diffThrows = false,
  } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "heldout-core-"));
  const core = join(dir, "barwise", "packages", "core");
  mkdirSync(join(core, "dist", "diff"), { recursive: true });
  writeFileSync(join(core, "package.json"), JSON.stringify({ type: "module" }));
  const refuseFile = JSON.stringify(fileEmpty === "refuse");
  const refuseCode = JSON.stringify(codeEmpty === "refuse");
  writeFileSync(
    join(core, "dist", "index.js"),
    `
const refuseEntityUnit = (o) => {
  if (o.kind === "entity" && "unit" in o) throw new Error("an entity type cannot have a unit");
};
export class OrmYamlSerializer {
  deserialize(text) {
    const doc = JSON.parse(text);
    return {
      name: doc.model.name,
      objectTypes: doc.model.object_types.map((o) => {
        refuseEntityUnit(o);
        if (o.unit === "" && ${refuseFile}) throw new Error("empty unit");
        const r = { id: o.id, name: o.name, kind: o.kind };
        if (o.unit !== undefined) r.unit = o.unit;
        return r;
      }),
    };
  }
  serialize(m) {
    const objectTypes = m.objectTypes.map((o) => {
      if (!${JSON.stringify(lossySave)}) return o;
      const { unit, ...rest } = o;
      return unit ? { ...rest, unit } : rest;
    });
    return JSON.stringify({ orm_version: "2.0", model: { name: m.name, object_types: objectTypes } });
  }
}
export class SchemaValidator {
  validateModel(doc) {
    return { valid: !doc.model.object_types.some((o) => o.kind === "entity" && "unit" in o) };
  }
}
export class OrmModel {
  constructor(config) { this.name = config.name; this.objectTypes = []; }
  addObjectType(config) {
    refuseEntityUnit(config);
    if (config.unit === "" && ${refuseCode}) throw new Error("empty unit");
    const r = { ...config };
    this.objectTypes.push(r);
    return r;
  }
}
`,
  );
  const same = diffBlind ? "(a, b) => (a ?? '') === (b ?? '')" : "(a, b) => a === b";
  writeFileSync(
    join(core, "dist", "diff", "index.js"),
    `
const same = ${same};
export function diffModels(a, b) {
  if (${diffThrows}) throw new Error("diff exploded");
  return {
    deltas: a.objectTypes.map((ot, i) => ({
      elementType: "object_type",
      kind: same(ot.unit, b.objectTypes[i].unit) ? "unchanged" : "modified",
    })),
  };
}
`,
  );
  return dir;
}

function heldout(path, cwd) {
  const r = spawnSync(process.execPath, [SCRIPT, "heldout", "--task", "t1", "--path", path], {
    cwd,
    encoding: "utf8",
  });
  return {
    status: r.status,
    stderr: r.stderr,
    report: r.status === 2 ? null : JSON.parse(r.stdout),
  };
}

const EMPTY_IN_FILE = "an empty unit in a file is refused, or kept and diffed like any value";
const EMPTY_FROM_CODE = "an empty unit from code is refused, or kept and diffed like any value";
const failedNames = (r) => r.report.cases.filter((c) => !c.ok).map((c) => c.name);

test("heldout passes a correct core, case by case, with a relative --path", () => {
  const dir = fakeCore();
  try {
    // Relative to the caller's directory (which the script needs inside the
    // repository), not to the script's own: a `../` path from here reaches
    // the fixture only if it is resolved against cwd.
    const cwd = dirname(dirname(SCRIPT));
    const r = heldout(relative(cwd, dir), cwd);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.report.cases.length, 13);
    assert.deepEqual(r.report.cases.filter((c) => !c.ok), []);
    assert.equal(r.report.passed, 13);
    assert.equal(r.report.failed, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("heldout fails pilot run p1's defect: an empty unit accepted and diffed as absent", () => {
  const dir = fakeCore({ fileEmpty: "accept", codeEmpty: "accept", diffBlind: true });
  try {
    const r = heldout(dir);
    assert.equal(r.status, 1);
    assert.deepEqual(r.report.cases.filter((c) => !c.ok).map((c) => c.name), [
      EMPTY_IN_FILE,
      EMPTY_FROM_CODE,
    ]);
    assert.equal(r.report.failed, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("heldout fails an empty unit refused in a file but accepted from code and diffed as absent", () => {
  // Refusing it in a file proves nothing about the other way in.
  const dir = fakeCore({ fileEmpty: "refuse", codeEmpty: "accept", diffBlind: true });
  try {
    const r = heldout(dir);
    assert.equal(r.status, 1);
    assert.deepEqual(r.report.cases.filter((c) => !c.ok).map((c) => c.name), [EMPTY_FROM_CODE]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("heldout passes a core that accepts an empty unit and treats it as an ordinary value", () => {
  // Accepting is a legitimate answer; the rule must not quietly demand refusal.
  const dir = fakeCore({ fileEmpty: "accept", codeEmpty: "accept" });
  try {
    const r = heldout(dir);
    assert.equal(r.status, 0, JSON.stringify(failedNames(r)));
    assert.equal(r.report.passed, 13);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("heldout fails a core that accepts an empty unit and drops it on save", () => {
  const dir = fakeCore({ fileEmpty: "accept", codeEmpty: "accept", lossySave: true });
  try {
    const r = heldout(dir);
    assert.equal(r.status, 1);
    assert.deepEqual(failedNames(r), [EMPTY_IN_FILE, EMPTY_FROM_CODE]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("heldout counts a case that throws as failed, with the error, not as a crash", () => {
  const dir = fakeCore({ diffThrows: true });
  try {
    const r = heldout(dir);
    assert.equal(r.status, 1);
    const thrown = r.report.cases.filter((c) => c.error);
    assert.ok(thrown.length >= 4, "every diff case reports the throw");
    for (const c of thrown) {
      assert.equal(c.ok, false);
      assert.equal(c.error, "diff exploded");
    }
    assert.equal(r.report.failed, thrown.length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("usage sums each turn's input once, and reports the last turn's context", () => {
  // Two records share one message id, as a turn streamed in parts does; a
  // tool result carries no usage and a blank line nothing, so both are skipped.
  const dir = mkdtempSync(join(tmpdir(), "usage-"));
  const file = join(dir, "run.jsonl");
  const turn = (id, input, read, create) =>
    JSON.stringify({
      message: {
        role: "assistant",
        id,
        usage: {
          input_tokens: input,
          cache_read_input_tokens: read,
          cache_creation_input_tokens: create,
          output_tokens: 7,
        },
      },
    });
  writeFileSync(
    file,
    [
      turn("m1", 10, 0, 1000),
      turn("m1", 10, 0, 1000),
      JSON.stringify({ message: { role: "user", content: [{ type: "tool_result" }] } }),
      "",
      turn("m2", 5, 1000, 200),
    ].join("\n"),
  );
  try {
    const r = spawnSync(process.execPath, [SCRIPT, "usage", file], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const got = JSON.parse(r.stdout);
    assert.equal(got.turns, 2);
    assert.equal(got.inputProcessed, 1010 + 1205);
    assert.equal(got.finalContext, 1205);
    assert.equal(got.perTurn, undefined, "per-turn counts only when asked");
    // --turns adds each counted turn's counters and nothing that identifies
    // the run's content: they sum back to inputProcessed.
    const withTurns = spawnSync(process.execPath, [SCRIPT, "usage", "--turns", file], {
      encoding: "utf8",
    });
    assert.equal(withTurns.status, 0, withTurns.stderr);
    const perTurn = JSON.parse(withTurns.stdout).perTurn;
    assert.deepEqual(perTurn, [
      { input: 10, cacheRead: 0, cacheCreation: 1000 },
      { input: 5, cacheRead: 1000, cacheCreation: 200 },
    ]);
    assert.equal(
      perTurn.reduce((n, p) => n + p.input + p.cacheRead + p.cacheCreation, 0),
      got.inputProcessed,
    );
    const two = spawnSync(process.execPath, [SCRIPT, "usage", file, file]);
    assert.equal(two.status, 2, "two transcripts");

    assert.equal(spawnSync(process.execPath, [SCRIPT, "usage"]).status, 2, "no file");
    assert.equal(spawnSync(process.execPath, [SCRIPT, "usage", dir]).status, 2, "a directory");
    // A complete turn and then a truncated one: refused, not a smaller total.
    writeFileSync(
      file,
      [turn("m1", 10, 0, 1000), turn("m2", 5, 1000, 200).slice(0, 40)].join("\n"),
    );
    const truncated = spawnSync(process.execPath, [SCRIPT, "usage", file], { encoding: "utf8" });
    assert.equal(truncated.status, 2, truncated.stdout);
    assert.match(truncated.stderr, /run\.jsonl:2 is not a JSON record/);
    // Valid JSON with a counter that is not a count: refused, not summed.
    const bad = (usage) => {
      writeFileSync(file, JSON.stringify({ message: { role: "assistant", id: "m1", usage } }));
      return spawnSync(process.execPath, [SCRIPT, "usage", file], { encoding: "utf8" });
    };
    const missing = bad({ cache_read_input_tokens: 10 });
    assert.equal(missing.status, 2, missing.stdout);
    assert.match(missing.stderr, /input_tokens is undefined/);
    const text = bad({ input_tokens: "5", cache_read_input_tokens: 10 });
    assert.equal(text.status, 2, text.stdout);
    assert.match(text.stderr, /input_tokens is "5"/);
    assert.equal(bad({ input_tokens: 5, cache_read_input_tokens: -1 }).status, 2, "negative");
    writeFileSync(file, "{}\n");
    assert.equal(spawnSync(process.execPath, [SCRIPT, "usage", file]).status, 2, "no turns");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("trial fails a branch that changed the held-out oracle and passes one that did not", () => {
  const repo = mkdtempSync(join(tmpdir(), "measure-trial-"));
  try {
    const g = (...a) =>
      execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...a], {
        cwd: repo,
        stdio: "ignore",
      });
    const laws = join(repo, "barwise/packages/core/tests/laws");
    mkdirSync(laws, { recursive: true });
    writeFileSync(join(laws, "x.law.test.ts"), "a\n");
    writeFileSync(join(repo, "README.md"), "a\n");
    const instruments = join(repo, "barwise/scripts/tests");
    mkdirSync(instruments, { recursive: true });
    writeFileSync(join(instruments, "measure-comparison.test.mjs"), "a\n");
    const diagramLaws = join(repo, "barwise/packages/diagram/tests/laws");
    mkdirSync(diagramLaws, { recursive: true });
    writeFileSync(join(diagramLaws, "layout.law.test.ts"), "a\n");
    // Every scripts/lib module the script imports, read from its source the
    // way the script reads it, plus the hook it loads by path.
    const libs = [
      ...[...readFileSync(SCRIPT, "utf8").matchAll(/from "\.\/lib\/([\w-]+\.mjs)"/g)].map((m) =>
        m[1]
      ),
      "module-count-hook.mjs",
    ];
    assert.ok(libs.includes("median.mjs") && libs.includes("malformed-score.mjs"));
    const lib = join(repo, "barwise/scripts/lib");
    mkdirSync(lib, { recursive: true });
    for (const f of libs) writeFileSync(join(lib, f), "a\n");
    const goldens = join(repo, "barwise/packages/llm/tests/fixtures/prompts");
    mkdirSync(goldens, { recursive: true });
    writeFileSync(join(goldens, "review-default.golden.txt"), "a\n");
    g("init", "-q");
    g("add", ".");
    g("commit", "-q", "-m", "base");

    writeFileSync(join(repo, "README.md"), "b\n");
    const clean = spawnSync(process.execPath, [SCRIPT, "trial", "--base", "HEAD", "--path", repo], {
      cwd: repo,
    });
    assert.equal(clean.status, 0, clean.stderr.toString());

    writeFileSync(join(laws, "x.law.test.ts"), "b\n");
    const touched = spawnSync(
      process.execPath,
      [SCRIPT, "trial", "--base", "HEAD", "--path", repo],
      { cwd: repo },
    );
    assert.equal(touched.status, 1, touched.stderr.toString());
    assert.match(touched.stdout.toString(), /x\.law\.test\.ts/);

    // The WS0 instruments and every golden are oracle too, not only the
    // CLI's golden directory.
    for (
      const f of [
        join(instruments, "measure-comparison.test.mjs"),
        join(goldens, "review-default.golden.txt"),
        join(diagramLaws, "layout.law.test.ts"),
        ...libs.map((f) => join(lib, f)),
      ]
    ) {
      g("checkout", "-q", "--", ".");
      writeFileSync(f, "b\n");
      const r = spawnSync(process.execPath, [SCRIPT, "trial", "--base", "HEAD", "--path", repo], {
        cwd: repo,
      });
      assert.equal(r.status, 1, `${f}: ${r.stderr}`);
    }

    // A file the trial added and never committed is a change too.
    g("checkout", "-q", "--", ".");
    writeFileSync(join(laws, "new.law.test.ts"), "added\n");
    const added = spawnSync(process.execPath, [SCRIPT, "trial", "--base", "HEAD", "--path", repo], {
      cwd: repo,
    });
    assert.equal(added.status, 1, added.stderr.toString());
    assert.match(added.stdout.toString(), /new\.law\.test\.ts/);

    // So is one the trial COMMITTED on top of the base, with a clean tree.
    rmSync(join(laws, "new.law.test.ts"));
    const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
    writeFileSync(join(laws, "x.law.test.ts"), "committed\n");
    g("commit", "-q", "-am", "trial work");
    const committed = spawnSync(
      process.execPath,
      [SCRIPT, "trial", "--base", base, "--path", repo],
      { cwd: repo },
    );
    assert.equal(committed.status, 1, committed.stderr.toString());
    assert.match(committed.stdout.toString(), /x\.law\.test\.ts/);

    // And it stays touched when the working tree puts the base contents
    // back: the commit still changed it. The old listing (working tree
    // against the base) saw nothing here and passed.
    writeFileSync(join(laws, "x.law.test.ts"), "a\n");
    const restored = spawnSync(
      process.execPath,
      [SCRIPT, "trial", "--base", base, "--path", repo],
      { cwd: repo },
    );
    assert.equal(restored.status, 1, restored.stderr.toString());
    assert.match(restored.stdout.toString(), /x\.law\.test\.ts/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("--runs that would measure nothing is refused, not reported as a failure", () => {
  for (const runs of ["0", "-1", "nope", "1.5"]) {
    const r = spawnSync(process.execPath, [SCRIPT, "startup", "--no-build", "--runs", runs]);
    assert.equal(r.status, 2, `--runs ${runs}: ${r.stderr}`);
  }
  assert.equal(spawnSync(process.execPath, [SCRIPT, "startup", "--no-build", "--runs"]).status, 2);
});

test("a flag given with no value is refused, not read as absent", () => {
  // Before, `--path` with no value measured the repository root silently.
  const r = spawnSync(process.execPath, [SCRIPT, "trial", "--base", "HEAD", "--path"]);
  assert.equal(r.status, 2, r.stderr.toString());
  assert.match(r.stderr.toString(), /--path needs a value/);
  assert.equal(spawnSync(process.execPath, [SCRIPT, "trial", "--base", "--path", "x"]).status, 2);
});

test("the median of an even count is the mean of the middle two", () => {
  assert.equal(median([400, 380, 420]), 400);
  assert.equal(median([380, 400, 420, 900]), 410);
});

test("a build tool that cannot start is a refusal, not a crash", () => {
  // git stays on PATH (the script needs it to find the repository); npx does not.
  const bin = mkdtempSync(join(tmpdir(), "measure-path-"));
  try {
    symlinkSync(execFileSync("which", ["git"], { encoding: "utf8" }).trim(), join(bin, "git"));
    const r = spawnSync(process.execPath, [SCRIPT, "startup", "--runs", "1"], {
      env: { PATH: bin },
    });
    assert.equal(r.status, 2, r.stderr.toString());
    assert.match(r.stderr.toString(), /could not be started/);
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
});

test("each malformed case declares the field its fixture actually gets wrong", () => {
  const { cases } = JSON.parse(readFileSync(join(FIXTURES, "cases.json"), "utf8"));
  assert.ok(cases.length > 0);
  for (const c of cases) {
    const ots = parse(readFileSync(join(FIXTURES, c.file), "utf8"))?.model?.object_types ?? [];
    assert.equal(ots.length, 1, `${c.file} holds one object type`);
    assert.equal(
      c.field in ots[0],
      !c.absent,
      `${c.file}: ${c.field} is ${c.absent ? "absent" : "present"}`,
    );
  }
});
