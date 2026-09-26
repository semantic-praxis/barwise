/**
 * staleBundles: a present bundle is not a current one. The offline lane
 * refuses to grade a bundle older than any of its package inputs, because
 * on 2026-09-26 it graded a stale CLI and reported 28 fixed rows as still
 * open (barwise-lh9).
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { staleBundles } from "../lib/paths.mjs";

/**
 * A package directory with src/nested/file.ts, schemas/model.json,
 * package.json and a bundle, every mtime pinned to `old` so a test moves
 * exactly the one it names.
 */
function fixture(old = 1_000) {
  const dir = mkdtempSync(join(tmpdir(), "trial-bundles-"));
  const pkg = join(dir, "pkg");
  const nested = join(pkg, "src", "nested");
  mkdirSync(nested, { recursive: true });
  mkdirSync(join(pkg, "schemas"));
  const f = {
    pkg,
    nested,
    source: join(nested, "file.ts"),
    schema: join(pkg, "schemas", "model.json"),
    manifest: join(pkg, "package.json"),
    bundle: join(dir, "bundle.cjs"),
  };
  for (const file of [f.source, f.schema, f.manifest, f.bundle]) writeFileSync(file, "");
  f.at = (path, seconds) => utimesSync(path, seconds, seconds);
  for (
    const p of [f.source, f.schema, f.manifest, nested, join(pkg, "src"), join(pkg, "schemas"), pkg]
  ) {
    f.at(p, old);
  }
  f.check = () => staleBundles({ bundles: [f.bundle], roots: [pkg] });
  return f;
}

test("a bundle newer than every input is current", () => {
  const f = fixture();
  f.at(f.bundle, 2_000);
  assert.deepEqual(f.check(), []);
});

test("a source newer than the bundle, however deep, makes it stale and is named", () => {
  const f = fixture();
  f.at(f.bundle, 2_000);
  f.at(f.source, 3_000);
  assert.deepEqual(f.check(), [{ bundle: f.bundle, newerSource: f.source }]);
});

test("a deleted source makes the bundle stale through its directory's mtime", () => {
  // PR #572 review: the walk saw only files that still exist.
  const f = fixture();
  f.at(f.bundle, 2_000);
  rmSync(f.source);
  f.at(f.nested, 3_000); // what the deletion does to the parent, pinned
  assert.deepEqual(f.check(), [{ bundle: f.bundle, newerSource: f.nested }]);
});

test("an input outside src/ counts: a schema and package.json", () => {
  // PR #572 review: the MCP bundle embeds core's schemas/, and the CLI
  // bundle script reads package.json for its version.
  const f = fixture();
  f.at(f.bundle, 2_000);
  f.at(f.schema, 3_000);
  assert.deepEqual(f.check(), [{ bundle: f.bundle, newerSource: f.schema }]);
  f.at(f.schema, 1_000);
  f.at(f.manifest, 3_000);
  assert.deepEqual(f.check(), [{ bundle: f.bundle, newerSource: f.manifest }]);
});

test("runtime state and build output are not inputs: hidden dirs, dist, tests, and the package root's own mtime", () => {
  const f = fixture();
  f.at(f.bundle, 2_000);
  for (const d of [".barwise", "dist", "tests", "coverage", "node_modules"]) {
    mkdirSync(join(f.pkg, d));
    writeFileSync(join(f.pkg, d, "x"), "");
    f.at(join(f.pkg, d, "x"), 3_000);
    f.at(join(f.pkg, d), 3_000);
  }
  f.at(f.pkg, 3_000); // creating those entries moved the root's mtime
  assert.deepEqual(f.check(), []);
});

test("a missing package directory is skipped, not an error", () => {
  const f = fixture();
  f.at(f.bundle, 2_000);
  assert.deepEqual(staleBundles({ bundles: [f.bundle], roots: [join(f.pkg, "..", "nope")] }), []);
});
