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
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import {
  ambiguityReport,
  combine,
  lostKeys,
  namesField,
  scoreDocument,
} from "../lib/malformed-score.mjs";
import { median } from "../lib/median.mjs";

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
  // The six messages today's loader gave for the combined file's object
  // types, as recorded by `measure-comparison malformed --json` on
  // 78b52f5b, before fact type cases joined it. Held as text because script
  // tests run before the build in CI, so @barwise/core cannot be loaded
  // here.
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
  assert.deepEqual(lostKeys(DOC, "model:\n  name: M\n  object_types: []\n").map((l) => l.key), [
    "id",
    "name",
    "kind",
    "reference_mode",
    "data_type",
  ]);
});

const FT_OTS =
  `  object_types:\n    - id: ot-person\n      name: Person\n      kind: entity\n      reference_mode: person_id\n`;
const ftDoc = (tag, constraints = "") =>
  `orm_version: "2.0"\nmodel:\n  name: M\n${FT_OTS}  fact_types:\n    - id: ft-${tag}\n      name: ${tag} knows Person\n      roles:\n        - id: r-${tag}-1\n          player: ot-person\n          role_name: knows\n        - id: r-${tag}-2\n          player: ot-person\n          role_name: is known by\n      readings:\n        - "{0} knows {1}"\n${constraints}`;

test("a fact type path credits the fact type at that index, never the object type there", () => {
  // Stand-in defect: a scorer that read every position as an object type
  // would credit ot-a for a fact type's problem at the same index.
  const files = {
    a: `orm_version: "2.0"\nmodel:\n  name: M\n  object_types:\n    - id: ot-a\n      name: Alpha\n      kind: value\n`,
    b: ftDoc("Bravo"),
  };
  const cases = [
    { file: "a", field: "roles" },
    { file: "b", kind: "fact_type", field: "roles" },
  ];
  const { problems } = combine(cases, (f) => files[f]);
  assert.deepEqual(problems.map((p) => [p.kind, p.index]), [["object_type", 0], ["fact_type", 0]]);
  const ftFailure = {
    deserialize: () => {
      throw Object.assign(new Error("schema"), {
        validationResult: { errors: [{ path: "/model/fact_types/0/roles", message: "too few" }] },
      });
    },
    serialize: () => "",
  };
  const r = scoreDocument("unused", problems, ftFailure);
  assert.deepEqual(r.problems.map((p) => [p.id, p.reported]), [["ot-a", false], [
    "ft-Bravo",
    true,
  ]]);
});

test("the combined file carries every fact type and each supporting object type once", () => {
  // Stand-in defect: a combine that copied only object_types would drop
  // every fact type case from the combined reading.
  const files = { b: ftDoc("Bravo"), c: ftDoc("Charlie") };
  const cases = [
    { file: "b", kind: "fact_type", field: "roles" },
    { file: "c", kind: "fact_type", field: "roles" },
  ];
  const { yaml, problems } = combine(cases, (f) => files[f]);
  const model = parse(yaml).model;
  assert.deepEqual(model.fact_types.map((ft) => ft.id), ["ft-Bravo", "ft-Charlie"]);
  assert.deepEqual(model.object_types.map((ot) => ot.id), ["ot-person"]);
  assert.deepEqual(problems.map((p) => p.index), [0, 1]);
  const clash = {
    ...files,
    c: files.c.replace("reference_mode: person_id", "reference_mode: code"),
  };
  assert.throws(() => combine(cases, (f) => clash[f]), /ot-person differs/);
});

test("a field lost inside a constraint is reported at its path; a reordered list is not a loss", () => {
  // Stand-in defect: a lostKeys that compared only top-level fields would
  // see the constraint still there and report nothing.
  const doc = ftDoc(
    "Bravo",
    "      constraints:\n        - type: ring\n          role_1: r-Bravo-1\n          role_2: r-Bravo-2\n          ring_type: irreflexive\n",
  );
  const dropsRingType = doc.replace(/\n {10}ring_type: irreflexive/, "");
  assert.deepEqual(lostKeys(doc, dropsRingType), [{
    id: "ft-Bravo",
    key: "constraints.0.ring_type",
  }]);
  const reordered = doc.replace(
    /( {8}- id: r-Bravo-1\n.*\n.*\n)( {8}- id: r-Bravo-2\n.*\n.*\n)/,
    "$2$1",
  );
  assert.notEqual(reordered, doc);
  assert.deepEqual(lostKeys(doc, reordered), []);
});

test("a problem inside a constraint is credited for naming that constraint, not another", () => {
  const doc = ftDoc(
    "Bravo",
    "      constraints:\n        - type: mandatory\n          role: r-Bravo-1\n        - id: c-ring\n          type: ring\n          role_1: r-Bravo-1\n          role_2: r-Bravo-2\n          ring_type: sideways\n",
  );
  const cases = [{ file: "b", kind: "fact_type", field: "ring_type", constraint: 1 }];
  const { problems } = combine(cases, () => doc);
  assert.deepEqual(problems[0].constraint, { index: 1, id: "c-ring" });
  const failing = (path) => ({
    deserialize: () => {
      throw Object.assign(new Error("schema"), {
        validationResult: { errors: [{ path, message: "unknown ring_type" }] },
      });
    },
    serialize: () => "",
  });
  const at = (path) => scoreDocument("unused", problems, failing(path)).problems[0].namesConstraint;
  // The constraint has an id, so only the id names it.
  assert.equal(at("/model/fact_types/0/constraints/1/ring_type (c-ring)"), true);
  assert.equal(at("/model/fact_types/0/constraints/1/ring_type"), false);

  // Without one, its position does, in either path spelling.
  const anonymous = doc.replace(
    "        - id: c-ring\n          type: ring",
    "        - type: ring",
  );
  const { problems: positional } = combine(cases, () => anonymous);
  const atPos = (path) =>
    scoreDocument("unused", positional, failing(path)).problems[0].namesConstraint;
  assert.equal(atPos("/model/fact_types/0/constraints/1/ring_type"), true);
  assert.equal(atPos("/model/fact_types/0/constraints/0/ring_type"), false);
  assert.equal(atPos('["fact_types"][0]["constraints"][1]["ring_type"]'), true);
});

test("a field is named only as a whole word, not inside a longer one", () => {
  // Stand-in defect: a substring match found `type` in every `fact_types`
  // path, so a message naming no field was credited with the case's field.
  assert.equal(
    namesField("/model/fact_types/6/constraints/0: invalid constraint on Permit has Age", "type"),
    false,
  );
  assert.equal(namesField("must have required property 'roles'", "role"), false);
  assert.equal(
    namesField("/model/fact_types/6/constraints/0/type: must be equal to constant", "type"),
    true,
  );
  assert.equal(namesField("Entity type Customer needs a referenceMode.", "reference_mode"), true);
  assert.equal(namesField("the reference mode is missing", "reference_mode"), true);
  assert.equal(namesField("ring_type: must be one of", "ring_type"), true);
  // A whole word is still not the field when it completes an element label.
  assert.equal(
    namesField('Fact type "Permit has Age", constraints[0]: invalid constraint', "type"),
    false,
  );
  assert.equal(namesField('Entity type "Customer" needs one', "type"), false);
  assert.equal(namesField("constraints[0].type: unknown kind", "type"), true);
  assert.equal(namesField("value_type is not allowed", "value_type"), true);
});

test("typecheck reads tsc's own totals and reports them, and refuses what it cannot read", () => {
  // A stand-in tsc in a throwaway tree, because the instrument has to read
  // the tree it is run in (barwise-jsi) and a real tsc cannot be made to
  // print a chosen time.
  const repo = mkdtempSync(join(tmpdir(), "measure-typecheck-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: repo });
    const run = () =>
      spawnSync(process.execPath, [SCRIPT, "typecheck", "--runs", "1"], {
        cwd: repo,
        encoding: "utf8",
      });
    assert.match(run().stderr, /typescript.*missing/);
    assert.equal(run().status, 2, "no tsc in this tree");

    mkdirSync(join(repo, "barwise/packages/core"), { recursive: true });
    writeFileSync(join(repo, "barwise/packages/core/tsconfig.json"), "{}\n");
    const bin = join(repo, "barwise/node_modules/typescript/bin");
    mkdirSync(bin, { recursive: true });
    const tsc = (body) => writeFileSync(join(bin, "tsc"), body);

    tsc('console.log("Instantiations:    25382\\nTotal time:    2.41s");');
    // A reading names its commit; a tree with none is refused, not read.
    execFileSync(
      "git",
      [
        "-c",
        "user.email=t@example.com",
        "-c",
        "user.name=t",
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        "x",
      ],
      { cwd: repo },
    );
    const ok = run();
    assert.equal(ok.status, 0, ok.stderr);
    assert.deepEqual(
      (({ medianMs, instantiations }) => ({ medianMs, instantiations }))(
        JSON.parse(ok.stdout),
      ),
      { medianMs: 2410, instantiations: 25382 },
    );

    // S6 is a measure: a slow reading is reported, not failed.
    tsc('console.log("Instantiations:    90000\\nTotal time:    12.00s");');
    const slow = run();
    assert.equal(slow.status, 0, "a slow reading is reported, not failed");
    assert.equal(JSON.parse(slow.stdout).medianMs, 12000);

    tsc('console.log("Files: 1");');
    assert.equal(run().status, 2, "no totals printed");

    tsc('console.log("error TS2322"); process.exit(2);');
    const broken = run();
    assert.equal(broken.status, 2, "a tree that does not compile has no time");
    assert.match(broken.stderr, /does not type-check/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("an unknown subcommand and an unresolvable ref are refusals, not readings", () => {
  assert.equal(spawnSync(process.execPath, [SCRIPT, "nonesuch"]).status, 2);
  assert.equal(spawnSync(process.execPath, [SCRIPT, "diff", "no-such-ref-anywhere"]).status, 2);
});

test("heldout refuses rather than reads when it has no task, no tree, or no built core", () => {
  // A run whose core was never built must not read as eight failed cases:
  // that would charge the agent for the scorer's own missing step.
  const run = (...args) =>
    spawnSync(process.execPath, [SCRIPT, "heldout", ...args], { encoding: "utf8" });
  assert.equal(run("--path", "/").status, 2, "no --task");
  assert.equal(run("--task", "t1").status, 2, "no --path");
  const empty = mkdtempSync(join(tmpdir(), "heldout-"));
  try {
    const r = run("--task", "t1", "--path", empty);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /no built core/);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

/**
 * A stand-in for a run's built core: just the surface the held-out cases
 * use, small enough to read, so the cases themselves are under test rather
 * than a real build. JSON stands in for YAML, which it is a subset of.
 * Each way an empty unit arrives is set apart: `fileEmpty` and `codeEmpty`
 * are "refuse" or "accept", `diffBlind` diffs it as if absent, and
 * `lossySave` drops a falsy unit when saving. Pilot run p1 accepted it both
 * ways and diffed it blind.
 */
function fakeCore(
  {
    fileEmpty = "refuse",
    codeEmpty = "refuse",
    diffBlind = false,
    lossySave = false,
    diffThrows = false,
  } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "heldout-core-"));
  const core = join(dir, "barwise", "packages", "core");
  mkdirSync(join(core, "dist", "diff"), { recursive: true });
  writeFileSync(join(core, "package.json"), JSON.stringify({ type: "module" }));
  const refuseFile = JSON.stringify(fileEmpty === "refuse");
  const refuseCode = JSON.stringify(codeEmpty === "refuse");
  writeFileSync(
    join(core, "dist", "index.js"),
    `
const refuseEntityUnit = (o) => {
  if (o.kind === "entity" && "unit" in o) throw new Error("an entity type cannot have a unit");
};
export class OrmYamlSerializer {
  deserialize(text) {
    const doc = JSON.parse(text);
    return {
      name: doc.model.name,
      objectTypes: doc.model.object_types.map((o) => {
        refuseEntityUnit(o);
        if (o.unit === "" && ${refuseFile}) throw new Error("empty unit");
        const r = { id: o.id, name: o.name, kind: o.kind };
        if (o.unit !== undefined) r.unit = o.unit;
        return r;
      }),
    };
  }
  serialize(m) {
    const objectTypes = m.objectTypes.map((o) => {
      if (!${JSON.stringify(lossySave)}) return o;
      const { unit, ...rest } = o;
      return unit ? { ...rest, unit } : rest;
    });
    return JSON.stringify({ orm_version: "2.0", model: { name: m.name, object_types: objectTypes } });
  }
}
export class SchemaValidator {
  validateModel(doc) {
    return { valid: !doc.model.object_types.some((o) => o.kind === "entity" && "unit" in o) };
  }
}
export class OrmModel {
  constructor(config) { this.name = config.name; this.objectTypes = []; }
  addObjectType(config) {
    refuseEntityUnit(config);
    if (config.unit === "" && ${refuseCode}) throw new Error("empty unit");
    const r = { ...config };
    this.objectTypes.push(r);
    return r;
  }
}
`,
  );
  const same = diffBlind ? "(a, b) => (a ?? '') === (b ?? '')" : "(a, b) => a === b";
  writeFileSync(
    join(core, "dist", "diff", "index.js"),
    `
const same = ${same};
export function diffModels(a, b) {
  if (${diffThrows}) throw new Error("diff exploded");
  return {
    deltas: a.objectTypes.map((ot, i) => ({
      elementType: "object_type",
      kind: same(ot.unit, b.objectTypes[i].unit) ? "unchanged" : "modified",
    })),
  };
}
`,
  );
  return dir;
}

function heldout(path, cwd) {
  const r = spawnSync(process.execPath, [SCRIPT, "heldout", "--task", "t1", "--path", path], {
    cwd,
    encoding: "utf8",
  });
  return {
    status: r.status,
    stderr: r.stderr,
    report: r.status === 2 ? null : JSON.parse(r.stdout),
  };
}

const EMPTY_IN_FILE = "an empty unit in a file is refused, or kept and diffed like any value";
const EMPTY_FROM_CODE = "an empty unit from code is refused, or kept and diffed like any value";
const failedNames = (r) => r.report.cases.filter((c) => !c.ok).map((c) => c.name);

test("heldout passes a correct core, case by case, with a relative --path", () => {
  const dir = fakeCore();
  try {
    // Relative to the caller's directory (which the script needs inside the
    // repository), not to the script's own: a `../` path from here reaches
    // the fixture only if it is resolved against cwd.
    const cwd = dirname(dirname(SCRIPT));
    const r = heldout(relative(cwd, dir), cwd);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.report.cases.length, 13);
    assert.deepEqual(r.report.cases.filter((c) => !c.ok), []);
    assert.equal(r.report.passed, 13);
    assert.equal(r.report.failed, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("heldout fails pilot run p1's defect: an empty unit accepted and diffed as absent", () => {
  const dir = fakeCore({ fileEmpty: "accept", codeEmpty: "accept", diffBlind: true });
  try {
    const r = heldout(dir);
    assert.equal(r.status, 1);
    assert.deepEqual(r.report.cases.filter((c) => !c.ok).map((c) => c.name), [
      EMPTY_IN_FILE,
      EMPTY_FROM_CODE,
    ]);
    assert.equal(r.report.failed, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("heldout fails an empty unit refused in a file but accepted from code and diffed as absent", () => {
  // Refusing it in a file proves nothing about the other way in.
  const dir = fakeCore({ fileEmpty: "refuse", codeEmpty: "accept", diffBlind: true });
  try {
    const r = heldout(dir);
    assert.equal(r.status, 1);
    assert.deepEqual(r.report.cases.filter((c) => !c.ok).map((c) => c.name), [EMPTY_FROM_CODE]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("heldout passes a core that accepts an empty unit and treats it as an ordinary value", () => {
  // Accepting is a legitimate answer; the rule must not quietly demand refusal.
  const dir = fakeCore({ fileEmpty: "accept", codeEmpty: "accept" });
  try {
    const r = heldout(dir);
    assert.equal(r.status, 0, JSON.stringify(failedNames(r)));
    assert.equal(r.report.passed, 13);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("heldout fails a core that accepts an empty unit and drops it on save", () => {
  const dir = fakeCore({ fileEmpty: "accept", codeEmpty: "accept", lossySave: true });
  try {
    const r = heldout(dir);
    assert.equal(r.status, 1);
    assert.deepEqual(failedNames(r), [EMPTY_IN_FILE, EMPTY_FROM_CODE]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("heldout counts a case that throws as failed, with the error, not as a crash", () => {
  const dir = fakeCore({ diffThrows: true });
  try {
    const r = heldout(dir);
    assert.equal(r.status, 1);
    const thrown = r.report.cases.filter((c) => c.error);
    assert.ok(thrown.length >= 4, "every diff case reports the throw");
    for (const c of thrown) {
      assert.equal(c.ok, false);
      assert.equal(c.error, "diff exploded");
    }
    assert.equal(r.report.failed, thrown.length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * A stand-in core for T2's cases: subtype facts only. `asClass` returns the
 * base's shape (a class instance carrying a derived name and an undefined
 * rule); `ruleUnchecked` accepts from code a defining rule the file refuses,
 * as the base does. `dropRule` loses a defining rule built in code, and
 * `mutableFileRule` leaves a loaded one unfrozen. `kindUnchecked` checks a
 * rule's storage and expression from code but not its kind, and
 * `valueEndpoint` lets a value type stand at either end. `swapEndpoints` and
 * `ignoreFlags` lose what code was given: the endpoints reversed, the flags
 * replaced by their defaults. `typesUnchecked` skips, from code only, the
 * type checks a file gets (expression a string, the flags booleans).
 * `dropDerivedOnSave` writes no derived rule, `dropFormal` loses a rule's
 * isFormal from code, and `idUnchecked` accepts from code an id a file
 * refuses. `rejectEmptyExpression` refuses from code an empty expression the
 * schema allows, and `dropDefaultStorage` drops `storage: derive_on_request`
 * at construction. `dropFalseFormal` drops an explicit `isFormal: false` from
 * code, and `hiddenName` keeps a derived name as a non-enumerable property.
 * `nullAsAbsent` reads a null flag from code as absent, and `unfrozenBare`
 * ("code" or "file") leaves a record with no defining rule unfrozen.
 * `rejectExplicitDefault` refuses from code a flag set to its own default.
 * `inPlace` makes `dropFormal` and `dropDefaultStorage` delete from the
 * caller's own rule object rather than from a copy.
 * With none, it is a correct conversion.
 */
function fakeSubtypeCore(
  {
    asClass = false,
    ruleUnchecked = false,
    dropRule = false,
    mutableFileRule = false,
    kindUnchecked = false,
    valueEndpoint = false,
    swapEndpoints = false,
    ignoreFlags = false,
    typesUnchecked = false,
    dropDerivedOnSave = false,
    dropFormal = false,
    idUnchecked = false,
    rejectEmptyExpression = false,
    dropDefaultStorage = false,
    dropFalseFormal = false,
    hiddenName = false,
    nullAsAbsent = false,
    rejectExplicitDefault = false,
    inPlace = false,
    unfrozenBare = false,
  } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "heldout-t2-"));
  const core = join(dir, "barwise", "packages", "core");
  mkdirSync(join(core, "dist", "diff"), { recursive: true });
  writeFileSync(join(core, "package.json"), JSON.stringify({ type: "module" }));
  writeFileSync(
    join(core, "dist", "index.js"),
    `
let next = 0;
const ruleOk = (r, checkKind = true) => r === undefined
  || (typeof r.expression === "string" && ["derive_on_request", "derived_and_stored", undefined].includes(r.storage)
    && (!checkKind || ["derived", "semiderived"].includes(r.kind))
    && [undefined, true, false].includes(r.isFormal));
const flagsOk = (c) => ["providesIdentification", "isExclusive", "isExhaustive"]
  .every((k) => [undefined, true, false].includes(c[k]));
class Legacy { constructor(c) { Object.assign(this, c); this._name = "subtype:" + c.subtypeId; } }
const make = (c, checkRule, fromFile = false) => {
  if (${rejectExplicitDefault} && !fromFile
    && (c.providesIdentification === true || c.isExclusive === false || c.isExhaustive === false)) {
    throw new Error("a flag set to its default");
  }
  if (${nullAsAbsent} && !fromFile) {
    c = { ...c };
    for (const k of ["providesIdentification", "isExclusive", "isExhaustive"]) if (c[k] === null) delete c[k];
  }
  if (c.subtypeId === c.supertypeId) throw new Error("subtype of itself");
  if (checkRule && !ruleOk(c.definingRule, fromFile || !${kindUnchecked})) throw new Error("bad defining rule");
  if ((fromFile || !${typesUnchecked}) && !flagsOk(c)) throw new Error("a flag is not a boolean");
  if (!fromFile && ${rejectEmptyExpression} && c.definingRule?.expression === "") {
    throw new Error("an empty expression");
  }
  if ((fromFile || !${idUnchecked}) && c.id !== undefined && !(typeof c.id === "string" && c.id.length > 0)) {
    throw new Error("an id is a non-empty string");
  }
  const r = {
    id: c.id ?? "sf-" + ++next,
    subtypeId: ${swapEndpoints} && !fromFile ? c.supertypeId : c.subtypeId,
    supertypeId: ${swapEndpoints} && !fromFile ? c.subtypeId : c.supertypeId,
    providesIdentification: (${ignoreFlags} && !fromFile ? undefined : c.providesIdentification) ?? true,
    isExclusive: (${ignoreFlags} && !fromFile ? undefined : c.isExclusive) ?? false,
    isExhaustive: (${ignoreFlags} && !fromFile ? undefined : c.isExhaustive) ?? false,
  };
  if (${asClass}) return new Legacy({ ...r, definingRule: c.definingRule });
  if (c.definingRule && !(${dropRule} && !fromFile)) {
    const rule = ${inPlace} && !fromFile ? c.definingRule : { ...c.definingRule };
    if (${dropFormal} && !fromFile) delete rule.isFormal;
    if (${dropFalseFormal} && !fromFile && rule.isFormal === false) delete rule.isFormal;
    if (${dropDefaultStorage} && !fromFile && rule.storage === "derive_on_request") delete rule.storage;
    r.definingRule = ${mutableFileRule} && fromFile ? rule : Object.freeze(rule);
  }
  if (${hiddenName} && !fromFile) {
    Object.defineProperty(r, "name", { get: () => "subtype:" + r.subtypeId, enumerable: false });
  }
  if (!r.definingRule && ${JSON.stringify(unfrozenBare)} === (fromFile ? "file" : "code")) return r;
  return Object.freeze(r);
};
export class OrmModel {
  constructor(c) { this.name = c.name; this.objectTypes = []; this.subtypeFacts = []; }
  addObjectType(c) { const o = { id: "ot-" + ++next, ...c }; this.objectTypes.push(o); return o; }
  addSubtypeFact(c) {
    const ids = this.objectTypes.map((o) => o.id);
    if (!ids.includes(c.subtypeId) || !ids.includes(c.supertypeId)) throw new Error("absent type");
    const kindOf = (id) => this.objectTypes.find((o) => o.id === id).kind;
    if (!${valueEndpoint} && (kindOf(c.subtypeId) === "value" || kindOf(c.supertypeId) === "value")) {
      throw new Error("a subtype fact relates entity types");
    }
    if (this.subtypeFacts.some((s) => s.subtypeId === c.subtypeId && s.supertypeId === c.supertypeId)) {
      throw new Error("duplicate");
    }
    const sf = make(c, !${ruleUnchecked});
    this.subtypeFacts.push(sf);
    return sf;
  }
}
export class OrmYamlSerializer {
  deserialize(text) {
    const d = JSON.parse(text.split("\\n#\\n")[0]).model;
    const m = new OrmModel({ name: d.name });
    m.objectTypes = d.object_types;
    m.subtypeFacts = (d.subtype_facts ?? []).map((s) => {
      const y = s.defining_rule;
      const r = y && Object.fromEntries(Object.entries({
        kind: y.kind, expression: y.expression, storage: y.storage, isFormal: y.is_formal,
      }).filter(([, v]) => v !== undefined));
      if (!ruleOk(r)) throw new Error("bad defining rule");
      return make({
        id: s.id, subtypeId: s.subtype, supertypeId: s.supertype,
        providesIdentification: s.provides_identification, isExclusive: s.is_exclusive,
        isExhaustive: s.is_exhaustive, definingRule: r,
      }, true, true);
    });
    return m;
  }
  serialize(m) {
    const subtype_facts = m.subtypeFacts.map((s) => ({
      id: s.id, subtype: s.subtypeId, supertype: s.supertypeId,
      ...(s.providesIdentification ? {} : { provides_identification: false }),
      ...(s.isExclusive ? { is_exclusive: true } : {}),
      ...(s.isExhaustive ? { is_exhaustive: true } : {}),
      ...(s.definingRule && !(${dropDerivedOnSave} && s.definingRule.kind === "derived")
        ? { defining_rule: Object.fromEntries(Object.entries({
          kind: s.definingRule.kind, expression: s.definingRule.expression,
          storage: s.definingRule.storage, is_formal: s.definingRule.isFormal,
        }).filter(([, v]) => v !== undefined)) }
        : {}),
    }));
    // JSON to load back, then the subtype facts as YAML lines, the part the
    // layout case reads.
    const lines = ["subtype_facts:"];
    for (const f of subtype_facts) {
      const { defining_rule, ...flat } = f;
      Object.entries(flat).forEach(([k, v], i) => lines.push((i === 0 ? "    - " : "      ") + k + ": " + v));
      if (defining_rule) {
        lines.push("      defining_rule:");
        for (const [k, v] of Object.entries(defining_rule)) lines.push("        " + k + ": " + v);
      }
    }
    return JSON.stringify({ orm_version: "2.0", model: { name: m.name, object_types: m.objectTypes, subtype_facts } })
      + "\\n#\\n" + lines.join("\\n") + "\\n";
  }
}
`,
  );
  writeFileSync(
    join(core, "dist", "diff", "index.js"),
    `
export function diffModels(a, b) {
  return {
    deltas: a.subtypeFacts.map((s, i) => ({
      elementType: "subtype_fact",
      kind: JSON.stringify(s) === JSON.stringify(b.subtypeFacts[i]) ? "unchanged" : "modified",
    })),
  };
}
`,
  );
  return dir;
}

test("heldout t2 passes a converted SubtypeFact and fails each defect on exactly its own cases", () => {
  const run = (dir) => {
    const r = spawnSync(process.execPath, [SCRIPT, "heldout", "--task", "t2", "--path", dir], {
      encoding: "utf8",
    });
    return { status: r.status, stderr: r.stderr, report: JSON.parse(r.stdout) };
  };
  // Generated case names: a refusal per schema constraint, a preservation
  // per value (scripts/lib/schema-cases.mjs).
  const R = "code refuses what a file refuses: subtype_fact.";
  const K = "code keeps what it was given, through a save and a load: subtype_fact";
  // Each stand-in defect, and the cases that must catch it -- no more. The
  // generated cases carry every input the hand list had (storage, kind,
  // expression, isFormal, the flags, ids, a derived rule lost on save), so
  // each defect a review of PR #662 found is still caught, now by the case
  // the schema yields rather than one written for it.
  const DEFECTS = [
    [{ asClass: true }, [
      "a subtype fact built in code is a plain, frozen record of its fields",
      "a subtype fact loaded from a file is a plain, frozen record of its fields",
      "a subtype fact's defining rule is kept and frozen, from code and from a file",
      "a subtype fact without a defining rule carries no definingRule key",
    ]],
    [{ ruleUnchecked: true }, [
      R + "defining_rule is null",
      R + "defining_rule is not an object",
      R + "defining_rule.expression is missing",
      R + "defining_rule.expression is null",
      R + "defining_rule.expression is not a string",
      R + "defining_rule.is_formal is null",
      R + "defining_rule.is_formal is not a boolean",
      R + "defining_rule.kind is missing",
      R + "defining_rule.kind is null",
      R + "defining_rule.kind is not a string",
      R + "defining_rule.kind is outside its enum",
      R + "defining_rule.storage is null",
      R + "defining_rule.storage is not a string",
      R + "defining_rule.storage is outside its enum",
    ]],
    [{ dropRule: true }, [
      "a subtype fact's defining rule is kept and frozen, from code and from a file",
      K + '.defining_rule = {"kind":"derived","expression":"e"}',
      K + '.defining_rule.expression = "kept expression"',
      K + '.defining_rule.expression = ""',
      K + ".defining_rule.is_formal = true",
      K + ".defining_rule.is_formal = false",
      K + '.defining_rule.kind = "derived"',
      K + '.defining_rule.kind = "semiderived"',
      K + '.defining_rule.storage = "derive_on_request"',
      K + '.defining_rule.storage = "derived_and_stored"',
    ]],
    [{ mutableFileRule: true }, [
      "a subtype fact's defining rule is kept and frozen, from code and from a file",
    ]],
    [{ kindUnchecked: true }, [
      R + "defining_rule.kind is missing",
      R + "defining_rule.kind is null",
      R + "defining_rule.kind is not a string",
      R + "defining_rule.kind is outside its enum",
    ]],
    [{ valueEndpoint: true }, [
      "construction refuses a value type as the subtype",
      "construction refuses a value type as the supertype",
    ]],
    [{ swapEndpoints: true }, [
      "construction refuses a duplicate subtype fact",
      K + ' = "(the base config)"',
      K + '.defining_rule = {"kind":"derived","expression":"e"}',
      K + '.defining_rule.expression = "kept expression"',
      K + '.defining_rule.expression = ""',
      K + ".defining_rule.is_formal = true",
      K + ".defining_rule.is_formal = false",
      K + '.defining_rule.kind = "derived"',
      K + '.defining_rule.kind = "semiderived"',
      K + '.defining_rule.storage = "derive_on_request"',
      K + '.defining_rule.storage = "derived_and_stored"',
      K + '.id = "kept id"',
      K + ".is_exclusive = true",
      K + ".is_exclusive = false",
      K + ".is_exhaustive = true",
      K + ".is_exhaustive = false",
      K + ".provides_identification = true",
      K + ".provides_identification = false",
    ]],
    [{ ignoreFlags: true }, [
      K + ".is_exclusive = true",
      K + ".is_exhaustive = true",
      K + ".provides_identification = false",
    ]],
    [{ typesUnchecked: true }, [
      R + "is_exclusive is null",
      R + "is_exclusive is not a boolean",
      R + "is_exhaustive is null",
      R + "is_exhaustive is not a boolean",
      R + "provides_identification is null",
      R + "provides_identification is not a boolean",
    ]],
    [{ dropDerivedOnSave: true }, [
      K + '.defining_rule = {"kind":"derived","expression":"e"}',
      K + '.defining_rule.expression = "kept expression"',
      K + '.defining_rule.expression = ""',
      K + ".defining_rule.is_formal = true",
      K + ".defining_rule.is_formal = false",
      K + '.defining_rule.kind = "derived"',
      K + '.defining_rule.storage = "derive_on_request"',
      K + '.defining_rule.storage = "derived_and_stored"',
    ]],
    [{ dropFormal: true }, [
      "a subtype fact's defining rule is kept and frozen, from code and from a file",
      K + ".defining_rule.is_formal = true",
      K + ".defining_rule.is_formal = false",
    ]],
    [{ dropFormal: true, inPlace: true }, [
      "a subtype fact's defining rule is kept and frozen, from code and from a file",
      K + ".defining_rule.is_formal = true",
      K + ".defining_rule.is_formal = false",
    ]],
    [{ dropFalseFormal: true }, [
      K + ".defining_rule.is_formal = false",
    ]],
    [{ hiddenName: true }, [
      "a subtype fact built in code is a plain, frozen record of its fields",
    ]],
    [{ nullAsAbsent: true }, [
      R + "is_exclusive is null",
      R + "is_exhaustive is null",
      R + "provides_identification is null",
    ]],
    [{ rejectExplicitDefault: true }, [
      K + ".is_exclusive = false",
      K + ".is_exhaustive = false",
      K + ".provides_identification = true",
    ]],
    [{ unfrozenBare: "code" }, [
      "a subtype fact built in code is a plain, frozen record of its fields",
    ]],
    [{ unfrozenBare: "file" }, [
      "a subtype fact loaded from a file is a plain, frozen record of its fields",
    ]],
    [{ idUnchecked: true }, [
      R + "id is null",
      R + "id is not a string",
      R + "id is empty",
    ]],
    [{ rejectEmptyExpression: true }, [
      K + '.defining_rule.expression = ""',
    ]],
    [{ dropDefaultStorage: true }, [
      K + '.defining_rule.storage = "derive_on_request"',
    ]],
    [{ dropDefaultStorage: true, inPlace: true }, [
      K + '.defining_rule.storage = "derive_on_request"',
    ]],
  ];
  const good = fakeSubtypeCore();
  const dirs = [good];
  try {
    const r = run(good);
    assert.equal(r.status, 0, JSON.stringify(failedNames(r)));
    assert.equal(r.report.cases.length, 64);
    for (const [defect, expected] of DEFECTS) {
      const dir = fakeSubtypeCore(defect);
      dirs.push(dir);
      const got = run(dir);
      assert.equal(got.status, 1, JSON.stringify(defect));
      assert.deepEqual(failedNames(got), expected, JSON.stringify(defect));
    }
    // The schema is the scorer's own, whatever the cwd: run from inside a
    // checkout whose schema drops a required field, the case list is the
    // same (Copilot, PR #662).
    const other = mkdtempSync(join(tmpdir(), "heldout-cwd-"));
    dirs.push(other);
    spawnSync("git", ["init", "-q", other]);
    const schemaPath = join(SCRIPT, "../../packages/core/schemas/orm-model-2.0.schema.json");
    const edited = JSON.parse(readFileSync(schemaPath, "utf8"));
    edited.definitions.subtype_fact.required = edited.definitions.subtype_fact.required
      .filter((k) => k !== "subtype");
    mkdirSync(join(other, "barwise/packages/core/schemas"), { recursive: true });
    writeFileSync(
      join(other, "barwise/packages/core/schemas/orm-model-2.0.schema.json"),
      JSON.stringify(edited),
    );
    const fromOther = spawnSync(
      process.execPath,
      [SCRIPT, "heldout", "--task", "t2", "--path", good],
      { cwd: other, encoding: "utf8" },
    );
    assert.equal(fromOther.status, 0, fromOther.stderr);
    assert.deepEqual(
      JSON.parse(fromOther.stdout).cases.map((c) => c.name),
      r.report.cases.map((c) => c.name),
    );
    // A task with no cases is refused, not read as zero cases passed -- and
    // so is an inherited name, which a plain lookup would accept.
    for (const task of ["t3", "toString", "constructor"]) {
      const none = spawnSync(
        process.execPath,
        [SCRIPT, "heldout", "--task", task, "--path", good],
        {
          encoding: "utf8",
        },
      );
      assert.equal(none.status, 2, task + ": " + none.stdout);
      assert.match(none.stderr, /t1 or t2/);
    }
  } finally {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  }
});

test("the trial prompt names every scripts/lib module the scorer protects", () => {
  // The prompt's list is a copy of the scorer's INSTRUMENT_LIBS -- every lib
  // module it imports, and the hook it loads by path -- so a module added to
  // one and not the other is a protected file a run is not told about
  // (Copilot, PR #662). Read both the way the scorer does.
  const source = readFileSync(SCRIPT, "utf8");
  const protectedLibs = new Set([
    ...[...source.matchAll(/from "\.\/lib\/([\w-]+\.mjs)"/g)].map((m) => m[1]),
    "module-count-hook.mjs",
  ]);
  assert.match(source, /scripts\/lib\/module-count-hook\.mjs/, "the hook the scorer loads by path");
  const spec = readFileSync(
    join(dirname(SCRIPT), "../docs/specs/effect-comparison.spec.md"),
    "utf8",
  );
  const prompt = spec.slice(spec.indexOf("## Appendix D"), spec.indexOf("The two style lines"));
  const listed = prompt.slice(
    prompt.indexOf("under `barwise/scripts/lib/`:"),
    prompt.indexOf(". Read"),
  );
  const named = new Set([...listed.matchAll(/`([\w-]+\.mjs)`/g)].map((m) => m[1]));
  assert.deepEqual([...named].sort(), [...protectedLibs].sort());
});

test("the schema case generator refuses a schema it cannot account for", async () => {
  const { refusals, preservations, keeps } = await import("../lib/schema-cases.mjs");
  const schema = (prop) => ({
    definitions: {
      thing: {
        type: "object",
        required: ["name"],
        additionalProperties: false,
        properties: { name: { type: "string", minLength: 1 }, flag: prop },
      },
    },
  });
  const KEYS = { name: "name", flag: "flag" };
  const base = { thing: { name: "n" } };
  // A constraint no case is made for throws, rather than yielding fewer cases.
  assert.throws(
    () => refusals(schema({ type: "string", pattern: "^x" }), "thing", KEYS, { base }),
    /pattern/,
  );
  // An object definition must be one: a nullable reference would make the
  // null refusal wrong (Copilot, PR #662).
  const nullable = {
    definitions: {
      thing: { type: "object", properties: { inner: { $ref: "#/definitions/inner" } } },
      inner: { type: ["object", "null"], properties: {} },
    },
  };
  for (const gen of [refusals, preservations]) {
    assert.throws(
      () =>
        gen(nullable, "thing", { inner: ["inner", {}] }, {
          base: { thing: {}, "thing.inner": {} },
        }),
      /thing\.inner has type/,
    );
  }
  // So does a handled keyword whose value no case is made for: a type with
  // no sample, or a minLength the samples would break (Copilot, PR #662).
  for (const gen of [refusals, preservations]) {
    assert.throws(() => gen(schema({ type: "integer" }), "thing", KEYS, { base }), /type integer/);
    assert.throws(
      () => gen(schema({ type: "string", minLength: 8 }), "thing", KEYS, { base }),
      /minLength 8/,
    );
  }
  // An enum refusal uses a value of the field's own type outside the enum:
  // not one the enum admits, and not one the type check already refuses.
  const outside = (prop) =>
    refusals(schema(prop), "thing", KEYS, { base }).find((c) => c.why === "is outside its enum")
      .config.flag;
  assert.equal(outside({ type: "string", enum: ["nope", "nope!"] }), "nope!!");
  assert.equal(outside({ type: "boolean", enum: [true] }), false);
  assert.throws(
    () => refusals(schema({ type: "boolean", enum: [true, false] }), "thing", KEYS, { base }),
    /every boolean/,
  );
  // A key map that names a property the schema lacks, or misses one, throws.
  assert.throws(
    () => refusals(schema({ type: "boolean" }), "thing", { name: "name" }, { base }),
    /key map/,
  );
  assert.throws(
    () =>
      preservations(schema({ type: "boolean" }), "thing", { ...KEYS, extra: "extra" }, { base }),
    /key map/,
  );
  // One refusal per constraint, and none for a field code may omit.
  const r = refusals(schema({ type: "boolean", default: false }), "thing", KEYS, { base });
  assert.deepEqual(r.map((c) => `${c.path} ${c.why}`), [
    "thing.flag is null",
    "thing.flag is not a boolean",
    "thing.name is missing",
    "thing.name is null",
    "thing.name is not a string",
    "thing.name is empty",
  ]);
  assert.deepEqual(
    refusals(schema({ type: "boolean" }), "thing", KEYS, { base, codeOptional: ["thing.name"] })
      .map((c) => c.why),
    ["is null", "is not a boolean", "is null", "is not a string", "is empty"],
  );
  // A required nested object is a constraint too: making one required adds
  // a "missing" case rather than nothing (Copilot, PR #662).
  const nested = {
    definitions: {
      thing: {
        type: "object",
        required: ["inner"],
        properties: { inner: { $ref: "#/definitions/inner" } },
      },
      inner: { type: "object", properties: { v: { type: "string" } } },
    },
  };
  assert.deepEqual(
    refusals(nested, "thing", { inner: ["inner", { v: "v" }] }, {
      base: { thing: { inner: {} }, "thing.inner": {} },
    }).map((c) => `${c.path} ${c.why}`),
    [
      "thing.inner is missing",
      "thing.inner is null",
      "thing.inner is not an object",
      "thing.inner.v is null",
      "thing.inner.v is not a string",
    ],
  );
  // A string with no minLength is kept empty as well as not.
  assert.deepEqual(
    preservations(nested, "thing", { inner: ["inner", { v: "v" }] }, {
      base: { thing: { inner: {} }, "thing.inner": {} },
    }).map((c) => c.value),
    ["(the base config)", {}, "kept v", ""],
  );
  // A boolean is kept at both values, its default included.
  const p = preservations(schema({ type: "boolean", default: false }), "thing", KEYS, { base });
  assert.deepEqual(p.map((c) => c.config), [
    { name: "n" },
    { name: "n", flag: true },
    { name: "n", flag: false },
    { name: "kept name" },
  ]);
  // So is one with no default.
  assert.deepEqual(
    preservations(schema({ type: "boolean" }), "thing", KEYS, { base }).map((c) => c.value),
    ["(the base config)", true, false, "kept name"],
  );
  // keeps: nested values, and a value the serializer writes as absent.
  assert.equal(keeps({ a: { b: 1 } }, { a: { b: 1 } }), true);
  assert.equal(keeps({ a: {} }, { a: { b: 1 } }), false);
  assert.equal(keeps({ a: {} }, { a: { b: 1 } }, { "a.b": 1 }), true);
  assert.equal(keeps(undefined, { a: 1 }), false);
});

test("usage sums each turn's input once, and reports the last turn's context", () => {
  // Two records share one message id, as a turn streamed in parts does; a
  // tool result carries no usage and a blank line nothing, so both are skipped.
  const dir = mkdtempSync(join(tmpdir(), "usage-"));
  const file = join(dir, "run.jsonl");
  const turn = (id, input, read, create) =>
    JSON.stringify({
      message: {
        role: "assistant",
        id,
        usage: {
          input_tokens: input,
          cache_read_input_tokens: read,
          cache_creation_input_tokens: create,
          output_tokens: 7,
        },
      },
    });
  writeFileSync(
    file,
    [
      turn("m1", 10, 0, 1000),
      turn("m1", 10, 0, 1000),
      JSON.stringify({ message: { role: "user", content: [{ type: "tool_result" }] } }),
      "",
      turn("m2", 5, 1000, 200),
    ].join("\n"),
  );
  try {
    const r = spawnSync(process.execPath, [SCRIPT, "usage", file], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const got = JSON.parse(r.stdout);
    assert.equal(got.turns, 2);
    assert.equal(got.inputProcessed, 1010 + 1205);
    assert.equal(got.finalContext, 1205);
    assert.equal(got.perTurn, undefined, "per-turn counts only when asked");
    // --turns adds each counted turn's counters and nothing that identifies
    // the run's content: they sum back to inputProcessed.
    const withTurns = spawnSync(process.execPath, [SCRIPT, "usage", "--turns", file], {
      encoding: "utf8",
    });
    assert.equal(withTurns.status, 0, withTurns.stderr);
    const perTurn = JSON.parse(withTurns.stdout).perTurn;
    assert.deepEqual(perTurn, [
      { round: 1, input: 10, cacheRead: 0, cacheCreation: 1000 },
      { round: 1, input: 5, cacheRead: 1000, cacheCreation: 200 },
    ]);
    assert.deepEqual(got.rounds, [{ round: 1, turns: 2, inputProcessed: 2215 }]);
    // Feedback from the coordinator starts a new round; one that arrives
    // before any turn closes nothing, and feedback in words alone (a user
    // record with no coordinator origin) is not a round marker.
    const coordinator = JSON.stringify({
      origin: { kind: "coordinator" },
      message: { role: "user", content: "Scoring found failures" },
    });
    writeFileSync(
      file,
      [
        coordinator,
        turn("m1", 10, 0, 1000),
        JSON.stringify({ message: { role: "user", content: "Scoring found failures" } }),
        turn("m2", 5, 1000, 200),
        coordinator,
        turn("m3", 1, 2000, 0),
      ].join("\n"),
    );
    const split = JSON.parse(
      spawnSync(process.execPath, [SCRIPT, "usage", "--turns", file], { encoding: "utf8" }).stdout,
    );
    assert.deepEqual(split.rounds, [
      { round: 1, turns: 2, inputProcessed: 2215 },
      { round: 2, turns: 1, inputProcessed: 2001 },
    ]);
    assert.equal(split.inputProcessed, 2215 + 2001, "rounds sum to the run's total");
    assert.deepEqual(split.perTurn.map((p) => p.round), [1, 1, 2]);
    assert.equal(
      perTurn.reduce((n, p) => n + p.input + p.cacheRead + p.cacheCreation, 0),
      got.inputProcessed,
    );
    // Feedback that reaches a run still busy arrives as a queued attachment
    // carrying the same origin; it starts a round too. A queued attachment
    // from anyone else does not.
    const queued = (kind) =>
      JSON.stringify({
        type: "attachment",
        attachment: {
          type: "queued_command",
          prompt: "Scoring found failures",
          ...(kind ? { origin: { kind } } : {}),
        },
      });
    writeFileSync(
      file,
      [
        turn("m1", 10, 0, 1000),
        queued(undefined),
        turn("m2", 5, 1000, 200),
        queued("coordinator"),
        turn("m3", 1, 2000, 0),
      ].join("\n"),
    );
    assert.deepEqual(
      JSON.parse(spawnSync(process.execPath, [SCRIPT, "usage", file], { encoding: "utf8" }).stdout)
        .rounds,
      [
        { round: 1, turns: 2, inputProcessed: 2215 },
        { round: 2, turns: 1, inputProcessed: 2001 },
      ],
    );
    const two = spawnSync(process.execPath, [SCRIPT, "usage", file, file]);
    assert.equal(two.status, 2, "two transcripts");

    assert.equal(spawnSync(process.execPath, [SCRIPT, "usage"]).status, 2, "no file");
    assert.equal(spawnSync(process.execPath, [SCRIPT, "usage", dir]).status, 2, "a directory");
    // A complete turn and then a truncated one: refused, not a smaller total.
    writeFileSync(
      file,
      [turn("m1", 10, 0, 1000), turn("m2", 5, 1000, 200).slice(0, 40)].join("\n"),
    );
    const truncated = spawnSync(process.execPath, [SCRIPT, "usage", file], { encoding: "utf8" });
    assert.equal(truncated.status, 2, truncated.stdout);
    assert.match(truncated.stderr, /run\.jsonl:2 is not a JSON record/);
    // Valid JSON with a counter that is not a count: refused, not summed.
    const bad = (usage) => {
      writeFileSync(file, JSON.stringify({ message: { role: "assistant", id: "m1", usage } }));
      return spawnSync(process.execPath, [SCRIPT, "usage", file], { encoding: "utf8" });
    };
    const missing = bad({ cache_read_input_tokens: 10 });
    assert.equal(missing.status, 2, missing.stdout);
    assert.match(missing.stderr, /input_tokens is undefined/);
    const text = bad({ input_tokens: "5", cache_read_input_tokens: 10 });
    assert.equal(text.status, 2, text.stdout);
    assert.match(text.stderr, /input_tokens is "5"/);
    assert.equal(bad({ input_tokens: 5, cache_read_input_tokens: -1 }).status, 2, "negative");
    writeFileSync(file, "{}\n");
    assert.equal(spawnSync(process.execPath, [SCRIPT, "usage", file]).status, 2, "no turns");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
    const instruments = join(repo, "barwise/scripts/tests");
    mkdirSync(instruments, { recursive: true });
    writeFileSync(join(instruments, "measure-comparison.test.mjs"), "a\n");
    const diagramLaws = join(repo, "barwise/packages/diagram/tests/laws");
    mkdirSync(diagramLaws, { recursive: true });
    writeFileSync(join(diagramLaws, "layout.law.test.ts"), "a\n");
    // Every scripts/lib module the script imports, read from its source the
    // way the script reads it, plus the hook it loads by path.
    const libs = [
      ...[...readFileSync(SCRIPT, "utf8").matchAll(/from "\.\/lib\/([\w-]+\.mjs)"/g)].map((m) =>
        m[1]
      ),
      "module-count-hook.mjs",
    ];
    assert.ok(libs.includes("median.mjs") && libs.includes("malformed-score.mjs"));
    const lib = join(repo, "barwise/scripts/lib");
    mkdirSync(lib, { recursive: true });
    for (const f of libs) writeFileSync(join(lib, f), "a\n");
    const goldens = join(repo, "barwise/packages/llm/tests/fixtures/prompts");
    mkdirSync(goldens, { recursive: true });
    writeFileSync(join(goldens, "review-default.golden.txt"), "a\n");
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

    // The WS0 instruments and every golden are oracle too, not only the
    // CLI's golden directory.
    for (
      const f of [
        join(instruments, "measure-comparison.test.mjs"),
        join(goldens, "review-default.golden.txt"),
        join(diagramLaws, "layout.law.test.ts"),
        ...libs.map((f) => join(lib, f)),
      ]
    ) {
      g("checkout", "-q", "--", ".");
      writeFileSync(f, "b\n");
      const r = spawnSync(process.execPath, [SCRIPT, "trial", "--base", "HEAD", "--path", repo], {
        cwd: repo,
      });
      assert.equal(r.status, 1, `${f}: ${r.stderr}`);
    }

    // A file the trial added and never committed is a change too.
    g("checkout", "-q", "--", ".");
    writeFileSync(join(laws, "new.law.test.ts"), "added\n");
    const added = spawnSync(process.execPath, [SCRIPT, "trial", "--base", "HEAD", "--path", repo], {
      cwd: repo,
    });
    assert.equal(added.status, 1, added.stderr.toString());
    assert.match(added.stdout.toString(), /new\.law\.test\.ts/);

    // So is one the trial COMMITTED on top of the base, with a clean tree.
    rmSync(join(laws, "new.law.test.ts"));
    const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
    writeFileSync(join(laws, "x.law.test.ts"), "committed\n");
    g("commit", "-q", "-am", "trial work");
    const committed = spawnSync(
      process.execPath,
      [SCRIPT, "trial", "--base", base, "--path", repo],
      { cwd: repo },
    );
    assert.equal(committed.status, 1, committed.stderr.toString());
    assert.match(committed.stdout.toString(), /x\.law\.test\.ts/);

    // And it stays touched when the working tree puts the base contents
    // back: the commit still changed it. The old listing (working tree
    // against the base) saw nothing here and passed.
    writeFileSync(join(laws, "x.law.test.ts"), "a\n");
    const restored = spawnSync(
      process.execPath,
      [SCRIPT, "trial", "--base", base, "--path", repo],
      { cwd: repo },
    );
    assert.equal(restored.status, 1, restored.stderr.toString());
    assert.match(restored.stdout.toString(), /x\.law\.test\.ts/);
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

test("a flag given with no value is refused, not read as absent", () => {
  // Before, `--path` with no value measured the repository root silently.
  const r = spawnSync(process.execPath, [SCRIPT, "trial", "--base", "HEAD", "--path"]);
  assert.equal(r.status, 2, r.stderr.toString());
  assert.match(r.stderr.toString(), /--path needs a value/);
  assert.equal(spawnSync(process.execPath, [SCRIPT, "trial", "--base", "--path", "x"]).status, 2);
});

test("the median of an even count is the mean of the middle two", () => {
  assert.equal(median([400, 380, 420]), 400);
  assert.equal(median([380, 400, 420, 900]), 410);
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

const CASE_COLLECTION = {
  object_type: "object_types",
  fact_type: "fact_types",
  constraint: "constraints",
  subtype_fact: "subtype_facts",
  objectified: "objectified_fact_types",
  population: "populations",
  definition: "definitions",
  diagram: "diagrams",
};

for (const set of ["", "3.0"]) {
  test(`each malformed case${set ? ` at ${set}` : ""} declares the field its fixture actually gets wrong`, () => {
    const dir = join(FIXTURES, set);
    const { cases, orm_version = "2.0" } = JSON.parse(
      readFileSync(join(dir, "cases.json"), "utf8"),
    );
    assert.ok(cases.some((c) => !c.kind) && cases.some((c) => c.kind === "fact_type"));
    for (const c of cases) {
      const doc = parse(readFileSync(join(dir, c.file), "utf8"));
      assert.equal(doc.orm_version, orm_version, `${c.file} is written at ${orm_version}`);
      const model = doc?.model ?? {};
      const kind = c.kind ?? "object_type";
      const header = Object.fromEntries(
        Object.entries(model).filter(([k]) => !Object.values(CASE_COLLECTION).includes(k)),
      );
      const elements = kind === "header" ? [header] : (model[CASE_COLLECTION[kind]] ?? []);
      assert.equal(elements.length, 1, `${c.file} holds one ${kind}`);
      // `at` is the field's path inside the element, for a field below its
      // top level (`constraints.0.ring_type`); the field itself otherwise.
      const path = (c.at ?? c.field).split(".");
      const parent = path.slice(0, -1).reduce((o, k) => o?.[k], elements[0]);
      assert.equal(path.at(-1), c.field, `${c.file}: at ends in the field`);
      assert.equal(
        parent !== undefined && c.field in parent,
        !c.absent,
        `${c.file}: ${c.at ?? c.field} is ${c.absent ? "absent" : "present"}`,
      );
      if (c.constraint !== undefined) {
        assert.equal(
          path[0],
          "constraints",
          `${c.file}: a constraint case points into constraints`,
        );
        assert.equal(Number(path[1]), c.constraint, `${c.file}: at names the declared constraint`);
      }
    }
  });
}

test("a model-level constraint and a fact type's constraint at one position are different elements", () => {
  // Stand-in defect: an unanchored `constraints/0` credits a fact type's
  // constraint 0 to the model's constraint 0, and the reverse.
  const doc = ftDoc("Bravo").replace('orm_version: "2.0"', 'orm_version: "3.0"')
    + "  constraints:\n    - id: c-model\n      type: exclusion\n      roles:\n        - r-Bravo-1\n";
  const [{ problem }] = [caseCombine(doc)];
  assert.equal(problem.kind, "constraint");
  const failing = (path) => ({
    deserialize: () => {
      throw Object.assign(new Error("schema"), {
        validationResult: { errors: [{ path, message: "too few" }] },
      });
    },
    serialize: () => "",
  });
  const credited = (path) =>
    scoreDocument("unused", [problem, { ...problem, id: "other" }], failing(path)).problems[0]
      .reported;
  assert.equal(credited("/model/constraints/0/roles"), true);
  assert.equal(credited('["model"]["constraints"][0]["roles"]'), true);
  assert.equal(credited("/model/fact_types/0/constraints/0/roles"), false);
});

function caseCombine(doc) {
  const { problems } = combine(
    [{ file: "c", kind: "constraint", field: "roles" }],
    () => doc,
    "3.0",
  );
  return { problem: problems[0] };
}

test("a fact type's constraint is not named by the model's constraint at its position", () => {
  const doc = ftDoc(
    "Bravo",
    "      constraints:\n        - type: ring\n          role_1: r-Bravo-1\n          role_2: r-Bravo-2\n          ring_type: sideways\n",
  );
  const { problems } = combine([{
    file: "b",
    kind: "fact_type",
    field: "ring_type",
    constraint: 0,
  }], () => doc);
  const failing = (path) => ({
    deserialize: () => {
      throw Object.assign(new Error("schema"), {
        validationResult: { errors: [{ path, message: "unknown ring_type" }] },
      });
    },
    serialize: () => "",
  });
  const at = (path) => scoreDocument("unused", problems, failing(path)).problems[0].namesConstraint;
  assert.equal(at("/model/fact_types/0/constraints/0/ring_type"), true);
  assert.equal(at("/model/constraints/0/ring_type"), false);
});

test("the combined 3.0 file carries what a model-level case spans, and leaves header cases out", () => {
  // Stand-in defects: a combine that carried only object types would drop
  // the fact type and subtype facts a model-level constraint names; one
  // that took a header case would write a second, conflicting header.
  const files = {
    c: ftDoc("Bravo").replace('orm_version: "2.0"', 'orm_version: "3.0"')
      + "  constraints:\n    - id: c-x\n      type: exclusion\n      roles:\n        - r-Bravo-1\n        - r-Bravo-2\n"
      + "  subtype_facts:\n    - id: sf-a\n      subtype: ot-person\n      supertype: ot-person\n",
    h: 'orm_version: "3.0"\nmodel:\n  namespace: bad\n',
  };
  const cases = [{ file: "c", kind: "constraint", field: "roles" }, {
    file: "h",
    kind: "header",
    field: "namespace",
  }];
  const { yaml, problems } = combine(cases, (f) => files[f], "3.0");
  const doc = parse(yaml);
  assert.equal(doc.orm_version, "3.0");
  assert.equal(doc.model.name, "Malformed");
  assert.equal("namespace" in doc.model, false);
  assert.deepEqual(doc.model.constraints.map((c) => c.id), ["c-x"]);
  assert.deepEqual(doc.model.fact_types.map((f) => f.id), ["ft-Bravo"]);
  assert.deepEqual(doc.model.subtype_facts.map((f) => f.id), ["sf-a"]);
  assert.deepEqual(problems.map((p) => p.kind), ["constraint"]);
});

test("a field lost from any collection, or from the header, is a silent loss", () => {
  // Stand-in defect: a lostKeys that walked only object_types and
  // fact_types would see none of these.
  const doc = 'orm_version: "3.0"\nmodel:\n  name: M\n  namespace: https://e.com/m/\n'
    + "  constraints:\n    - id: c-x\n      type: exclusion\n      modality: deontic\n"
    + "  definitions:\n    - term: Person\n      definition: A human.\n"
    + "  diagrams:\n    - name: Overview\n      elements: []\n";
  const dropped = 'orm_version: "3.0"\nmodel:\n  name: M\n'
    + "  constraints:\n    - id: c-x\n      type: exclusion\n"
    + "  definitions:\n    - term: Person\n"
    + "  diagrams:\n    - name: Overview\n";
  assert.deepEqual(lostKeys(doc, dropped), [
    { id: "model", key: "namespace" },
    { id: "c-x", key: "modality" },
    { id: "Person", key: "definition" },
    { id: "Overview", key: "elements" },
  ]);
});

test("the corpus listing changes when a loader drops a field, and names a refusal by mode", async () => {
  // Stand-in defect: S1 read on one head cannot fail, because a decoder
  // that drops a field agrees with itself. Two loaders over one text must
  // give different lines when one of them drops a field.
  const { corpusListing } = await import("../lib/corpus-listing.mjs");
  const texts = new Map([["m.orm.yaml", DOC]]);
  const keeps = { deserialize: (t) => t, serialize: (m) => m };
  const drops = {
    deserialize: (t) => t.replace(/\n {6}data_type:\n {8}name: integer/, ""),
    serialize: (m) => m,
  };
  const strictOnly = {
    deserialize: (t, o) => {
      if (!o?.lenient) throw new Error("refused");
      return t;
    },
    serialize: (m) => m,
  };
  const [a, b, c] = [keeps, drops, strictOnly].map((l) => corpusListing(texts, l));
  assert.equal(a.length, 2);
  assert.notDeepEqual(a, b);
  assert.deepEqual(
    c.map((l) => l.split("\t").slice(1).join(" ")).map((l) => l.split(" ")[1] === "refused"),
    [true, false],
  );
  const written = new Map();
  corpusListing(texts, keeps, written);
  assert.deepEqual([...written.keys()], ["m.orm.yaml"]);
});
