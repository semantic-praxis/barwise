/**
 * A directory artifact's hash has to change when its contents change.
 * Every directory used to record the literal string "dir", so a dbt
 * project and a code repo with entirely different contents hashed the
 * same, and editing a file inside one left the manifest untouched --
 * a hash that cannot change is not evidence of anything.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { hashTree } from "../lib/run.mjs";

const tree = (files) => {
  const root = mkdtempSync(join(tmpdir(), "trial-hash-"));
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
};

test("hashTree: identical trees agree, and any change to contents or layout moves the hash", () => {
  const a = tree({ "models/x.sql": "select 1", "dbt_project.yml": "name: x" });
  const same = tree({ "models/x.sql": "select 1", "dbt_project.yml": "name: x" });
  assert.equal(hashTree(a), hashTree(same));

  // A changed file body.
  const edited = tree({ "models/x.sql": "select 2", "dbt_project.yml": "name: x" });
  assert.notEqual(hashTree(a), hashTree(edited));

  // The same bodies under a different name: the path is part of the hash,
  // so a rename is a change too.
  const renamed = tree({ "models/y.sql": "select 1", "dbt_project.yml": "name: x" });
  assert.notEqual(hashTree(a), hashTree(renamed));

  // An added file.
  const extra = tree({
    "models/x.sql": "select 1",
    "dbt_project.yml": "name: x",
    "models/z.sql": "select 3",
  });
  assert.notEqual(hashTree(a), hashTree(extra));
});

test("hashTree: the walk is deterministic and does not depend on creation order", () => {
  const first = tree({ "a.sql": "1", "b.sql": "2", "c.sql": "3" });
  const reversed = tree({ "c.sql": "3", "b.sql": "2", "a.sql": "1" });
  assert.equal(hashTree(first), hashTree(reversed));
});
