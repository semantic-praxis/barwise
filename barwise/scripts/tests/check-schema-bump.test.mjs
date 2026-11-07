/**
 * check-schema-bump (docs/specs/adr-batch9-enforcers.spec.md, WS7): the
 * comparison on stated facts, and the gate end to end in throwaway
 * repositories with `v*` tags. Each repository holds just the two files the
 * gate reads, at the paths it reads them.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
// Importing the gate must not run it.
import {
  bumpFinding,
  currentVersionOf,
  normalizeSchema,
  SCHEMA_PATH,
  VERSION_PATH,
} from "../check-schema-bump.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "check-schema-bump.mjs");

const versionFile = (v) => `export const CURRENT_ORM_VERSION = "${v}";\n`;
const schemaFile = (extra = {}, description = "d") =>
  `${
    JSON.stringify({
      description,
      properties: { orm_version: { const: "x" }, ...extra },
    })
  }\n`;

const git = (dir, ...args) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });

function write(dir, path, text) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), text);
}

function commit(dir, { schema, version }, message) {
  write(dir, SCHEMA_PATH, schema);
  write(dir, VERSION_PATH, versionFile(version));
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "--allow-empty", "-m", message);
}

function tempRepo() {
  const dir = mkdtempSync(join(tmpdir(), "barwise-bump-"));
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "gate@test");
  git(dir, "config", "user.name", "gate");
  return dir;
}

const run = (dir) => spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: "utf8" });

/** Release tagged v1.0.0 at version 1.1, then the work in `after` on top of it. */
function released(after) {
  const dir = tempRepo();
  commit(dir, { schema: schemaFile(), version: "1.1" }, "release");
  git(dir, "tag", "v1.0.0");
  if (after !== undefined) commit(dir, after, "work");
  return dir;
}

function inRepo(dir, body) {
  try {
    body();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- the comparison ---

test("normalizeSchema drops string annotations only, and ignores key order", () => {
  const a = { title: "t", $comment: "c", description: "d", b: 1, a: { description: "x" } };
  const b = { a: {}, b: 1 };
  assert.deepEqual(normalizeSchema(a), normalizeSchema(b));
  // A property NAMED description is a schema, not prose, and stays.
  assert.deepEqual(normalizeSchema({ properties: { description: { type: "string" } } }), {
    properties: { description: { type: "string" } },
  });
});

test("currentVersionOf reads the literal, with or without a type annotation", () => {
  assert.equal(currentVersionOf(versionFile("4.0")), "4.0");
  assert.equal(currentVersionOf('export const CURRENT_ORM_VERSION: string = "1.2";'), "1.2");
  assert.equal(currentVersionOf("export const CURRENT_ORM_VERSION = compute();"), undefined);
});

test("bumpFinding: a schema change under an equal version is the only finding", () => {
  const base = { tag: "v1", tagSchema: { a: 1 }, tagVersion: "1.1" };
  assert.match(
    bumpFinding({ ...base, schema: { a: 2 }, version: "1.1" }),
    /still "1\.1".*v1 wrote/s,
  );
  assert.equal(bumpFinding({ ...base, schema: { a: 2 }, version: "1.2" }), undefined, "bumped");
  assert.equal(bumpFinding({ ...base, schema: { a: 1 }, version: "1.1" }), undefined, "unchanged");
  assert.equal(
    bumpFinding({ ...base, schema: { a: 1, description: "new prose" }, version: "1.1" }),
    undefined,
    "prose only",
  );
});

// --- the gate, end to end ---

test("check-schema-bump fails when the schema changed and the version equals the tag's", () => {
  const dir = released({ schema: schemaFile({ added: { type: "string" } }), version: "1.1" });
  inRepo(dir, () => {
    const r = run(dir);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /differs from v1\.0\.0's/);
    assert.doesNotMatch(r.stdout, /OK/);
  });
});

test("check-schema-bump passes on a bump, an unchanged schema, and a prose-only edit", () => {
  for (
    const after of [
      { schema: schemaFile({ added: { type: "string" } }), version: "1.2" },
      { schema: schemaFile(), version: "1.1" },
      { schema: schemaFile({}, "reworded"), version: "1.1" },
    ]
  ) {
    const dir = released(after);
    inRepo(dir, () => {
      const r = run(dir);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stdout, /against v1\.0\.0 \(wrote 1\.1; now /);
    });
  }
});

test("check-schema-bump compares with the LATEST reachable v* tag, not an earlier one", () => {
  const dir = released({ schema: schemaFile({ added: { type: "string" } }), version: "1.2" });
  inRepo(dir, () => {
    git(dir, "tag", "v1.1.0");
    git(dir, "tag", "edge"); // not a v* tag: never the baseline
    // Against v1.0.0 (wrote 1.1) a change under 1.2 passes; against v1.1.0
    // (wrote 1.2) it is the finding, so only the latest tag gives exit 1.
    commit(dir, { schema: schemaFile({ added: { type: "number" } }), version: "1.2" }, "more");
    const r = run(dir);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /differs from v1\.1\.0's/);
  });
});

test("check-schema-bump refuses when no v* tag is reachable", () => {
  const dir = tempRepo();
  inRepo(dir, () => {
    commit(dir, { schema: schemaFile(), version: "1.1" }, "work");
    git(dir, "tag", "edge");
    const r = run(dir);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /no v\* tag is reachable/);
    assert.doesNotMatch(r.stdout, /OK/);
  });
});

test("check-schema-bump refuses a shallow clone, tag or no tag", () => {
  const origin = released({ schema: schemaFile({ added: { type: "string" } }), version: "1.1" });
  const parent = mkdtempSync(join(tmpdir(), "barwise-bump-clone-"));
  inRepo(origin, () => {
    try {
      const clone = join(parent, "c");
      git(parent, "clone", "-q", "--depth", "1", `file://${origin}`, clone);
      const r = run(clone);
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.match(r.stderr, /shallow clone/);
      assert.doesNotMatch(r.stdout, /OK/);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

test("check-schema-bump refuses when the tag does not hold the files", () => {
  const dir = tempRepo();
  inRepo(dir, () => {
    write(dir, "README.md", "x\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "empty release");
    git(dir, "tag", "v0.1.0");
    commit(dir, { schema: schemaFile(), version: "1.1" }, "files arrive");
    const r = run(dir);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /git show v0\.1\.0:.* failed/);
  });
});

test("check-schema-bump refuses when the working tree lacks the schema", () => {
  const dir = released();
  inRepo(dir, () => {
    rmSync(join(dir, SCHEMA_PATH));
    const r = run(dir);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /could not read/);
  });
});

test("check-schema-bump reads the working tree, so an uncommitted version edit is seen", () => {
  const dir = released({ schema: schemaFile({ added: { type: "string" } }), version: "1.2" });
  inRepo(dir, () => {
    assert.equal(run(dir).status, 0);
    write(dir, VERSION_PATH, versionFile("1.1"));
    assert.equal(run(dir).status, 1);
  });
});
