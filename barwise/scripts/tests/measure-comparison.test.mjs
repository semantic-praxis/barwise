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
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { ambiguityReport, combine, lostKeys, scoreDocument } from "../lib/malformed-score.mjs";

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

    // A file the trial added and never committed is a change too.
    g("checkout", "-q", "--", ".");
    writeFileSync(join(laws, "new.law.test.ts"), "added\n");
    const added = spawnSync(process.execPath, [SCRIPT, "trial", "--base", "HEAD", "--path", repo], {
      cwd: repo,
    });
    assert.equal(added.status, 1, added.stderr.toString());
    assert.match(added.stdout.toString(), /new\.law\.test\.ts/);
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
