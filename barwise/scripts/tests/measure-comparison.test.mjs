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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { combine, lostKeys, scoreDocument } from "../lib/malformed-score.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "measure-comparison.mjs");

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
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
