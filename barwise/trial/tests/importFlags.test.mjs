/**
 * An artifact's import_flags reach the import command as given, and the
 * CLI, not the trial, decides whether they are valid
 * (reference-inference.spec.md, workstream 2).
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runCli } from "../lib/exec.mjs";
import { importCommand, sprint1Brownfield } from "../lib/steps.mjs";

test("an artifact's import_flags are appended to its import command", () => {
  assert.deepEqual(importCommand("sql", "a.sql", "bigquery", ["--infer-references"]), [
    "import",
    "sql",
    "a.sql",
    "--dialect",
    "bigquery",
    "--infer-references",
  ]);
  assert.deepEqual(importCommand("ddl", "a.sql"), ["import", "model", "a.sql", "--format", "ddl"]);
});

test("a flag the CLI refuses fails the import, with the CLI's own message", () => {
  const dir = mkdtempSync(join(tmpdir(), "trial-import-flags-"));
  const api = join(dir, "api.json");
  writeFileSync(api, `{"openapi":"3.0.0","info":{"title":"t","version":"1"},"paths":{}}`);
  const r = runCli([...importCommand("openapi", api, undefined, ["--infer-references"])]);
  assert.notEqual(r.exit, 0);
  assert.match(r.stderr, /--infer-references applies to --format ddl/);
});

test("sprint 1 forwards an artifact's import_flags to the import it runs", () => {
  // The cases above call importCommand directly, so they pass whether or
  // not the sprint passes art.import_flags on, and CI runs no full trial
  // (PR #628 review). A flag the CLI refuses for this format makes the
  // forwarding visible in the step's own record.
  const dir = mkdtempSync(join(tmpdir(), "trial-import-flags-sprint-"));
  const gen = join(dir, "generated", "small");
  mkdirSync(gen, { recursive: true });
  writeFileSync(
    join(gen, "api.json"),
    `{"openapi":"3.0.0","info":{"title":"t","version":"1"},"paths":{}}`,
  );
  writeFileSync(join(gen, "api.manifest.json"), JSON.stringify({ path: "api.json" }));
  const rows = [];
  sprint1Brownfield(
    { dir, artifacts: [{ id: "api", importer: "openapi", import_flags: ["--infer-references"] }] },
    "small",
    (row) => rows.push(row),
  );
  const step = rows.find((r) => r.step === "import:api");
  assert.ok(step, JSON.stringify(rows));
  assert.notEqual(step.exit, 0);
  assert.match(step.stderr, /--infer-references applies to --format ddl/);
});
