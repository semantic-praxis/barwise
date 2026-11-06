/**
 * The ADR governance reader alone (scripts/lib/adr-facts.mjs;
 * docs/specs/adr-gate-reader-split.spec.md): an input is read only when a
 * rule first asks for it and at most once, an unreadable one is one refusal
 * in the order it was asked for, "cannot read" is null and never empty, and
 * a step is found by its full command. The two gates' own tests show the
 * same properties end to end; these pin the reader the conformance model
 * will judge.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createGovernanceReader, readTestReports, repoFile } from "../lib/adr-facts.mjs";
import { scriptVerdict } from "../lib/adr-judge.mjs";
import { build, RULES } from "../lib/adr-population.mjs";

function tree(files) {
  const dir = mkdtempSync(join(tmpdir(), "barwise-adr-facts-"));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}
const CI = "name: CI\non: push\njobs:\n  ci:\n    runs-on: ubuntu-latest\n"
  + "    defaults:\n      run:\n        working-directory: barwise\n    steps:\n"
  + "      - run: npm run audit:y\n"
  + "      - run: npm run audit:y -- --check\n";
const PKG = JSON.stringify({ scripts: { "audit:y": "node y.mjs" } });
const TRACKER = '{"id":"barwise-a","status":"open","title":"a"}\n';

test("adr-facts: each input is read only when asked for, and at most once", async () => {
  const dir = tree({});
  try {
    const refusals = [];
    const reader = await createGovernanceReader(dir, { needsWorkflow: true, refusals });
    // Nothing is missing until a rule asks for it.
    assert.deepEqual(refusals, []);
    assert.equal(reader.scripts(), null);
    assert.equal(reader.scripts(), null);
    assert.equal(refusals.length, 1, "a second ask reads nothing and refuses nothing more");
    assert.match(refusals[0], /^barwise\/package\.json: /);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // A read that succeeded is not repeated either: the file can go and the
  // answer stays.
  const ok = tree({ "barwise/package.json": PKG, ".beads/issues.jsonl": TRACKER });
  try {
    const refusals = [];
    const reader = await createGovernanceReader(ok, { needsWorkflow: false, refusals });
    const first = reader.scripts();
    const tracker = reader.issues();
    rmSync(join(ok, "barwise", "package.json"));
    rmSync(join(ok, ".beads", "issues.jsonl"));
    assert.equal(reader.scripts(), first);
    assert.equal(reader.issues(), tracker);
    assert.deepEqual(refusals, []);
  } finally {
    rmSync(ok, { recursive: true, force: true });
  }
});

test("adr-facts: refusals are listed in the order the inputs are asked for", async () => {
  const dir = tree({});
  try {
    const refusals = [];
    const reader = await createGovernanceReader(dir, { needsWorkflow: true, refusals });
    assert.equal(reader.issues(), null);
    assert.equal(reader.steps("npm run audit:y"), null);
    assert.equal(reader.scripts(), null);
    assert.deepEqual(
      refusals.map((r) => r.split(":")[0]),
      [".beads/issues.jsonl", ".github/workflows/ci.yml", "barwise/package.json"],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("adr-facts: the workflow reader's import refusal comes first, and keeps its label", async () => {
  const dir = tree({ "barwise/package.json": "{ not json" });
  try {
    const refusals = [];
    const reader = await createGovernanceReader(dir, {
      needsWorkflow: true,
      refusals,
      importCiOccurrences: async () => {
        throw new Error("Cannot find package 'yaml'");
      },
    });
    reader.scripts();
    assert.equal(reader.steps("npm run audit:y"), null);
    assert.equal(refusals.length, 3);
    assert.equal(refusals[0], "scripts/lib/ci-occurrences.mjs: Cannot find package 'yaml'");
    assert.match(refusals[1], /^barwise\/package\.json: /);
    assert.equal(refusals[2], ".github/workflows/ci.yml: its reader could not be loaded");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("adr-facts: a tree that declares no npm entry imports no workflow reader", async () => {
  const dir = tree({ ".github/workflows/ci.yml": CI });
  try {
    const refusals = [];
    let imported = false;
    await createGovernanceReader(dir, {
      needsWorkflow: false,
      refusals,
      importCiOccurrences: async () => {
        imported = true;
        return {};
      },
    });
    assert.equal(imported, false);
    assert.deepEqual(refusals, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("adr-facts: a step is found by its full command, and the answers are what the files say", async () => {
  const dir = tree({
    ".github/workflows/ci.yml": CI,
    "barwise/package.json": PKG,
    ".beads/issues.jsonl": TRACKER,
  });
  try {
    const refusals = [];
    const reader = await createGovernanceReader(dir, { needsWorkflow: true, refusals });
    assert.deepEqual(reader.steps("npm run audit:y").map((s) => s.run), ["npm run audit:y"]);
    assert.deepEqual(
      reader.steps("npm run audit:y -- --check").map((s) => s.run),
      ["npm run audit:y -- --check"],
    );
    // A command no step runs is an empty list: the workflow was read.
    assert.deepEqual(reader.steps("npm run audit:z"), []);
    assert.deepEqual(Object.keys(reader.scripts()), ["audit:y"]);
    assert.equal(reader.issues().get("barwise-a").status, "open");
    assert.deepEqual(refusals, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("adr-facts: the reports' unread count is fixed when they are read", () => {
  // The judge appends its refusals after these and must not recount them;
  // that half is pinned end to end in check-adr-tests.test.mjs.
  const dir = tree({
    "barwise/packages/core/package.json": JSON.stringify({
      scripts: { "test:coverage": "vitest" },
    }),
    "barwise/scripts/tests/expected-counts.json": JSON.stringify({ counts: { "g.test.mjs": 1 } }),
    "barwise/test-results/script-tests/g.test.jsonl":
      '{"name":"t","status":"passed","type":"test","file":"f"}\n',
  });
  try {
    const r = readTestReports(dir);
    assert.equal(r.expected.length, 3);
    assert.deepEqual(r.ran.map((t) => t.title), ["t"]);
    // The vitest and trial reports are missing: two refusals, counted now.
    assert.equal(r.unreadable, 2);
    assert.equal(r.refusals.length, 2);
    assert.match(r.refusals[0], /vitest\.json: missing/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("adr-facts: a report's source path is kept from the report's own directory on", () => {
  const core = "barwise/packages/core/";
  // Another checkout's prefix, and one that itself passes through a
  // packages/core/ directory: the last occurrence is the report's own.
  assert.equal(
    repoFile("/tmp/wt/packages/core/x/barwise/packages/core/tests/a.test.ts", core),
    "barwise/packages/core/tests/a.test.ts",
  );
  assert.equal(
    repoFile("C:\\src\\barwise\\scripts\\tests\\g.test.mjs", "barwise/scripts/tests/"),
    "barwise/scripts/tests/g.test.mjs",
  );
  // A sibling package whose name ends the same is not this one.
  assert.equal(repoFile("/r/barwise/packages/xcore/tests/a.test.ts", core), null);
  for (const abs of [null, undefined, "", "f", "/r/barwise/packages/core/"]) {
    assert.equal(repoFile(abs, core), null, String(abs));
  }
});

test("adr-facts: a report list that cannot be built throws, for the gate to report", () => {
  const dir = tree({ "barwise/packages/core/package.json": "{}" });
  try {
    assert.throws(() => readTestReports(dir), /expected-counts\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The shared verdict that decides which scripts are looked up at all
// (docs/specs/adr-conformance-model.spec.md): the judge reports it, and the
// governance schema's builder writes a "names script" fact only for a
// script it lets through, so a script it rejects is never also reported as
// missing from package.json.
test("adr-judge: scriptVerdict is the gate-name and meta-gate check, and a rejected script is no fact", () => {
  const entry = (script) => ({ script, text: `npm run ${script} (one)` });
  assert.equal(scriptVerdict(entry("check:x"), "a"), null);
  assert.match(scriptVerdict(entry("build"), "a"), /build is not a gate name/);
  assert.match(
    scriptVerdict(entry("check:architecture"), "a"),
    /check:architecture checks other gates and cannot vouch for this ADR/,
  );
  assert.equal(scriptVerdict(entry("check:architecture"), "package-graph-authority"), null);
  const { pops } = build(
    [{
      f: "barwise/docs/adr/a.md",
      text: "# a\n\nEnforced-by: npm run build (one), npm run check:architecture (two)\n\n"
        + "## Decision\n\n1. **D** {#one}. T.\n2. **E** {#two}. T.\n",
    }],
    { scripts: () => ({}), steps: () => [], issues: () => new Map() },
  );
  assert.equal(pops.Entry_names_Script, undefined, "neither rejected script is named");
});

// The schema and RULES state the same rules, and the builder
// writes only fact types and roles the schema has. Neither needs core, so
// both run on every tree test:scripts runs on, before the build
// (docs/specs/adr-conformance-model.spec.md, WS3).
test("adr-model schema: its rule constraints are RULES, and every role the builder writes is in it", async () => {
  const YAML = (await import("yaml")).default;
  const { ROLES } = await import("../lib/adr-population.mjs");
  const here = dirname(fileURLToPath(import.meta.url));
  const doc = YAML.parse(
    readFileSync(join(here, "..", "..", "docs", "adr", "governance.orm.yaml"), "utf8"),
  );
  assert.equal(doc.orm_version, "4.0", "a 3.x file would rename every constraint on load");
  // The model's own constraints are exactly the rules; every other one is
  // a fact type's uniqueness, the structure a valid schema needs.
  assert.deepEqual(doc.model.constraints.map((c) => c.id).sort(), RULES.map((r) => r.id).sort());
  for (const c of doc.model.constraints) assert.equal(c.type, "subset", `${c.id} is a subset`);
  for (const ft of doc.model.fact_types) {
    for (const c of ft.constraints ?? []) {
      assert.equal(c.type, "internal_uniqueness", `${ft.id}: ${c.id}`);
    }
  }
  const roles = new Map(
    doc.model.fact_types.map((ft) => [ft.id, new Set(ft.roles.map((r) => r.id))]),
  );
  for (const [kind, [ft, a, b]] of Object.entries(ROLES)) {
    assert.ok(roles.has(ft), `${kind}: fact type ${ft} is not in the schema`);
    assert.ok(
      roles.get(ft).has(a) && roles.get(ft).has(b),
      `${kind}: ${a} or ${b} is not a role of ${ft}`,
    );
  }
});

test("check:adr-model: a core that will not load is a refusal, exit 2, never the finding code", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const r = spawnSync(
    process.execPath,
    [
      join(here, "..", "check-adr-model.mjs"),
      "--core",
      join(tmpdir(), "barwise-no-core", "index.js"),
    ],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /check:adr-model: cannot answer: a dependency would not load/);
});
