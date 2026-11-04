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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { createGovernanceReader, readTestReports } from "../lib/adr-facts.mjs";

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

test("adr-facts: the reports are counted unread before anything is judged", () => {
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

test("adr-facts: a report list that cannot be built throws, for the gate to report", () => {
  const dir = tree({ "barwise/packages/core/package.json": "{}" });
  try {
    assert.throws(() => readTestReports(dir), /expected-counts\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
