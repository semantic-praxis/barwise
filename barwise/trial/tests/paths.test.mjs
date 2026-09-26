/**
 * staleBundles: a present bundle is not a current one. The offline lane
 * refuses to grade a bundle older than any package source, because on
 * 2026-09-26 it graded a stale CLI and reported 28 fixed rows as still
 * open (barwise-lh9).
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { staleBundles } from "../lib/paths.mjs";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "trial-bundles-"));
  const src = join(dir, "pkg", "src", "nested");
  mkdirSync(src, { recursive: true });
  const bundle = join(dir, "bundle.cjs");
  const source = join(src, "file.ts");
  writeFileSync(bundle, "");
  writeFileSync(source, "");
  const at = (path, seconds) => utimesSync(path, seconds, seconds);
  return { dir, bundle, source, root: join(dir, "pkg", "src"), at };
}

test("a bundle newer than every source is current", () => {
  const f = fixture();
  f.at(f.source, 1_000);
  f.at(f.bundle, 2_000);
  assert.deepEqual(staleBundles({ bundles: [f.bundle], roots: [f.root] }), []);
});

test("a source newer than the bundle, however deep, makes it stale and is named", () => {
  const f = fixture();
  f.at(f.bundle, 1_000);
  f.at(f.source, 2_000);
  assert.deepEqual(staleBundles({ bundles: [f.bundle], roots: [f.root] }), [
    { bundle: f.bundle, newerSource: f.source },
  ]);
});

test("a missing source root is skipped, not an error", () => {
  const f = fixture();
  assert.deepEqual(
    staleBundles({ bundles: [f.bundle], roots: [join(f.dir, "no-such-package", "src")] }),
    [],
  );
});
