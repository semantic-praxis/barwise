/**
 * An artifact's import_flags reach the import command as given, and the
 * CLI, not the trial, decides whether they are valid
 * (reference-inference.spec.md, workstream 2).
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runCli } from "../lib/exec.mjs";
import { importCommand } from "../lib/steps.mjs";

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
