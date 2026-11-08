/**
 * check-source-sites (docs/specs/adr-batch9-enforcers.spec.md, WS3): the
 * two rules' scanners on single files, the allowlist comparison, and the
 * gate end to end in a throwaway repository.
 *
 * The model-sdk-boundary rule ports every case of the vitest it replaced
 * (llm/tests/modelSdkBoundary.test.ts, barwise-wrr), each tagged with the
 * decision it holds. Its end-to-end base also stages a source file in each
 * of cli, mcp and vscode and one package.json, because the rule refuses
 * without them.
 *
 * The end-to-end base copies the real files ORM_VERSION_WRITERS lists into
 * the fixture, so the fixture is green for the reason the repository is,
 * and each plant is red for one reason only. Files are staged, because the
 * gate reads `git ls-files` and an untracked file is invisible to it.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
// Importing the gate must not run it.
import {
  allowlistProblems,
  manifestSdks,
  modelSdkImports,
  ORM_VERSION_WRITERS,
  ormVersionSites,
  ossieSchemaRefs,
  writerFindings,
} from "../check-source-sites.mjs";

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(SCRIPTS, "check-source-sites.mjs");
const REPO = join(SCRIPTS, "..", "..");

const sites = (text) => ormVersionSites(text, "x.ts").map((s) => `${s.fn} ${s.form} ${s.line}`);
const refs = (text) => ossieSchemaRefs(text, "x.ts").map((r) => `${r.form} ${r.line}`);

// --- orm-version-writers: what counts as a site ---

test("orm-version-writers finds each form that sets orm_version, by enclosing function", () => {
  const text = [
    'const a = { orm_version: "4.0" };', // 1: identifier key, module
    'const b = { "orm_version": "4.0" };', // 2: string key
    'const c = { ["orm_version"]: "4.0" };', // 3: computed key that is one string
    "function shorthand(orm_version: string) { return { orm_version }; }", // 4
    'function assign(d: any) { d.orm_version = "4.0"; d["orm_version"] ??= "4.0"; }', // 5 x2
    'export const yaml = `orm_version: "${V}"\\nmodel: {}`;', // 6: template text
    'const s = "orm_version:  4.0";', // 7: string text
    'const o = { migrate: (d: any) => ({ ...d, orm_version: "1.1" }) };', // 8: bound arrow
    'class K { write() { return [1].map(() => ({ orm_version: "4.0" })); } }', // 9: callback
  ].join("\n");
  assert.deepEqual(sites(text), [
    "(module) key 1",
    "(module) key 2",
    "(module) key 3",
    "shorthand key 4",
    "assign assign 5",
    "assign assign 5",
    "(module) text 6",
    "(module) text 7",
    "migrate key 8",
    "write key 9",
  ]);
});

test("orm-version-writers finds a quoted key in text and a class field initializer (code review)", () => {
  assert.deepEqual(sites('function j() { return `{"orm_version":${"4.0"}}`; }'), ["j text 1"]);
  assert.deepEqual(sites('function q() { return "{\\"orm_version\\": \\"3.0\\"}"; }'), [
    "q text 1",
  ]);
  assert.deepEqual(sites('class K {\n  orm_version = "3.0";\n}'), ["(module) key 2"]);
  assert.deepEqual(sites("class T { orm_version: string; }"), [], "a declared type is not a write");
});

test("orm-version-writers ignores types, reads, comments, regexes and a bare key name", () => {
  const text = [
    "type D = { orm_version: string };",
    'interface E { orm_version: "4.0"; }',
    "const v = doc.orm_version;",
    "const { orm_version } = doc;",
    '// orm_version: "4.0" in a comment',
    "/* const x = { orm_version: 1 } */",
    "const r = /^orm_version\\s*:/m;",
    'const field = "orm_version";',
    'if (doc.orm_version === "4.0") {}',
  ].join("\n");
  assert.deepEqual(sites(text), []);
});

// --- ossie-schema-refs: what counts as a reference ---

test("ossie-schema-refs finds every module reference form and a plain string", () => {
  const text = [
    'import a from "../../schemas/ossie/ontology.json" with { type: "json" };',
    'export * from "../schemas/ossie/x.js";',
    'const b = require("../schemas/ossie/ossie-schema.json");',
    'const c = import("../schemas/ossie/ontology.json");',
    'type T = typeof import("../schemas/ossie/ontology.json");',
    'const path = "packages/formats/schemas/ossie/ontology.json";',
    "const t = `${root}/schemas/ossie/${name}`;",
  ].join("\n");
  assert.deepEqual(refs(text), [
    "module 1",
    "module 2",
    "module 3",
    "module 4",
    "module 5",
    "string 6",
    "string 7",
  ]);
});

test("ossie-schema-refs ignores comments and other schemas", () => {
  const text = [
    "// reads ../schemas/ossie/ontology.json",
    'import s from "../../schemas/orm-model.schema.json";',
    'const o = "schemas/ossie-like";',
  ].join("\n");
  assert.deepEqual(refs(text), []);
});

// --- the allowlist comparison ---

const ROW = { file: "core/src/a.ts", fn: "f", form: "key", count: 2, reason: "r" };
const site = (line, over = {}) => ({ file: "core/src/a.ts", fn: "f", form: "key", line, ...over });

test("writerFindings: a group at its count passes", () => {
  assert.deepEqual(writerFindings([site(1), site(2)], [ROW]), []);
});

test("writerFindings: an extra site in a listed group is a finding naming every site", () => {
  const [f, ...rest] = writerFindings([site(1), site(2), site(3)], [ROW]);
  assert.deepEqual(rest, []);
  assert.match(
    f,
    /3 sites, 2 listed -- core\/src\/a\.ts:1, core\/src\/a\.ts:2, core\/src\/a\.ts:3/,
  );
});

test("writerFindings: a row with fewer sites than listed is stale", () => {
  const [f, ...rest] = writerFindings([site(1)], [ROW]);
  assert.deepEqual(rest, []);
  assert.match(f, /1 site\(s\), 2 listed\. The row is stale/);
});

test("writerFindings: the same file in another function or form is unlisted", () => {
  const found = writerFindings(
    [site(1), site(2), site(3, { fn: "g" }), site(4, { form: "text" })],
    [
      ROW,
    ],
  );
  assert.equal(found.length, 2);
  assert.match(found[0], /\(g, key\): sets orm_version and is not listed -- core\/src\/a\.ts:3/);
  assert.match(found[1], /\(f, text\): sets orm_version and is not listed/);
});

test("the real allowlist has unique keys and positive counts, and a bad one is named", () => {
  assert.deepEqual(allowlistProblems(), []);
  assert.deepEqual(allowlistProblems([ROW, { ...ROW, count: 0 }]), [
    "repeated row core/src/a.ts f key",
    "row core/src/a.ts f key: count 0",
  ]);
});

// --- end to end ---

/**
 * Run the gate in a fresh repository holding the real listed writers plus
 * `files` ({ path: text, or null to leave a listed file out }), staged.
 */
function gateIn(files, { base = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "barwise-source-sites-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    const all = {};
    if (base) {
      for (const { file } of ORM_VERSION_WRITERS) {
        const path = `barwise/packages/${file}`;
        all[path] = readFileSync(join(REPO, path), "utf8");
      }
    }
    if (base) {
      // What model-sdk-boundary needs to see before it will answer.
      for (const pkg of ["cli", "mcp", "vscode"]) {
        all[`barwise/packages/${pkg}/src/stub.ts`] = "export const stub = 1;\n";
      }
      all["barwise/packages/cli/package.json"] = '{ "name": "@barwise/cli" }\n';
    }
    Object.assign(all, files);
    for (const [name, text] of Object.entries(all)) {
      if (text === null) continue;
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), text);
      execFileSync("git", ["add", "--", name], { cwd: dir });
    }
    return spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const output = (r) => `${r.stdout}${r.stderr}`;

test("end to end: the listed writers alone pass, with the counts in the OK line", () => {
  const r = gateIn({});
  assert.equal(r.status, 0, output(r));
  assert.match(r.stderr, /orm-version-writers: 11 site\(s\) in 9 listed group\(s\)/);
});

test("end to end: an unlisted orm_version write in cli/src exits 1", () => {
  const r = gateIn({
    "barwise/packages/cli/src/commands/verbalize.ts":
      'export const doc = { orm_version: "3.0", model: {} };\n',
  });
  assert.equal(r.status, 1, output(r));
  assert.match(r.stderr, /cli\/src\/commands\/verbalize\.ts \(\(module\), key\): sets orm_version/);
  assert.equal((r.stderr.match(/orm-version-writers {2}/g) ?? []).length, 1, r.stderr);
});

test("end to end: a second assignment in document30 exits 1 (count 2, expected 1)", () => {
  const path = "barwise/packages/formats/src/ossie/verifyOssie.ts";
  const text = readFileSync(join(REPO, path), "utf8");
  const planted = text.replace(
    '  doc.orm_version = "3.0";',
    '  doc.orm_version = "3.0";\n  doc.orm_version = "3.0";',
  );
  assert.notEqual(planted, text, "the plant's anchor is gone from verifyOssie.ts");
  const r = gateIn({ [path]: planted });
  assert.equal(r.status, 1, output(r));
  assert.match(r.stderr, /verifyOssie\.ts \(document30, assign\): 2 sites, 1 listed/);
});

test("end to end: a listed writer that is gone leaves a stale row, exit 1", () => {
  const r = gateIn({ "barwise/packages/vscode/src/commands/projectScaffold.ts": null });
  assert.equal(r.status, 1, output(r));
  assert.match(r.stderr, /projectScaffold\.ts \(\(module\), text\): 0 site\(s\), 1 listed/);
});

test("end to end: a vendored-schema import outside the descriptor exits 1", () => {
  const r = gateIn({
    "barwise/packages/mcp/src/tools/x.ts":
      'import o from "../../../formats/schemas/ossie/ontology.json" with { type: "json" };\n'
      + "export default o;\n",
    "barwise/packages/formats/src/sql/x.ts": 'import "../../schemas/ossie/ontology.json";\n',
  });
  assert.equal(r.status, 1, output(r));
  assert.match(r.stderr, /ossie-schema-refs {2}mcp\/src\/tools\/x\.ts:1 \(module\)/);
  assert.match(r.stderr, /ossie-schema-refs {2}formats\/src\/sql\/x\.ts:1 \(module\)/);
});

test("end to end: the descriptor itself, and package tests, may name the vendored schema", () => {
  const r = gateIn({
    "barwise/packages/formats/src/ossie/x.ts": 'import "../../schemas/ossie/ontology.json";\n',
    "barwise/packages/formats/tests/x.test.ts": 'import "../schemas/ossie/ontology.json";\n',
    "barwise/packages/cli/src/x.test.ts": 'const d = { orm_version: "1.0" };\n',
  });
  assert.equal(r.status, 0, output(r));
});

test("end to end: no tracked package source is a refusal, never OK", () => {
  const r = gateIn({ "barwise/packages/core/README.md": "# core\n" }, { base: false });
  assert.equal(r.status, 2, output(r));
  assert.match(r.stderr, /no tracked source files/);
  assert.doesNotMatch(output(r), /source sites: OK/);
});

// --- model-sdk-boundary (determinism-in-core#one-layer-out) ---

const ADR = "[adr:determinism-in-core#one-layer-out]";
const CLI_FILE = "barwise/packages/cli/src/x.ts";

test(`model-sdk-boundary sees every import form and subpath ${ADR}`, () => {
  const positives = [
    `import OpenAI from "openai";`,
    `import Anthropic from "@anthropic-ai/sdk";`,
    `import type { Message } from "@anthropic-ai/sdk/resources/messages";`,
    `import "openai/resources/chat";`,
    `const m = await import("openai");`,
    `const m = require("openai");`,
    `export { default } from "openai";`,
    `/// <reference types="openai" />`,
  ];
  for (const code of positives) {
    assert.notDeepEqual(modelSdkImports(code), [], code);
  }
  assert.deepEqual(
    modelSdkImports('import type { Message } from "@anthropic-ai/sdk/resources/messages";'),
    ["@anthropic-ai/sdk/resources/messages"],
  );
});

test(`model-sdk-boundary ignores the word in a string or comment, and openai-compat ${ADR}`, () => {
  const negatives = [
    `const provider = z.enum(["anthropic", "openai", "ollama"]);`,
    `// import OpenAI from "openai";`,
    `/* const m = require("@anthropic-ai/sdk"); */`,
    `import compat from "openai-compat";`,
    `import x from "@anthropic-ai/sdk-extras";`,
  ];
  for (const code of negatives) {
    assert.deepEqual(modelSdkImports(code), [], code);
  }
});

test(`model-sdk-boundary reads the four dependency fields and nothing else ${ADR}`, () => {
  for (
    const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]
  ) {
    assert.deepEqual(manifestSdks({ [field]: { openai: "^4" } }), [`${field} lists openai`]);
  }
  assert.deepEqual(
    manifestSdks({
      dependencies: { "openai-compat": "1", "@barwise/llm": "*" },
      scripts: { a: "openai" },
    }),
    [],
  );
  assert.deepEqual(manifestSdks(null), []);
});

test(`end to end: an SDK import in cli/src exits 1, naming the file and the rule ${ADR}`, () => {
  const r = gateIn({
    [CLI_FILE]: 'import Anthropic from "@anthropic-ai/sdk";\nexport default Anthropic;\n',
  });
  assert.equal(r.status, 1, output(r));
  assert.match(r.stderr, /model-sdk-boundary {2}cli\/src\/x\.ts: imports @anthropic-ai\/sdk /);
});

test(`end to end: a subpath type import, a re-export, a require and a dynamic import each exit 1 ${ADR}`, () => {
  const forms = {
    subpath: 'import type { M } from "@anthropic-ai/sdk/resources/messages";\nexport type T = M;\n',
    reexport: 'export { default } from "openai";\n',
    require: 'export const o = require("openai");\n',
    dynamic: 'export const o = () => import("openai");\n',
  };
  for (const [what, text] of Object.entries(forms)) {
    const r = gateIn({ [CLI_FILE]: text });
    assert.equal(r.status, 1, `${what}: ${output(r)}`);
    assert.match(r.stderr, /model-sdk-boundary {2}cli\/src\/x\.ts: imports /, what);
  }
});

test(`end to end: a .mjs file and a test file under src are read too ${ADR}`, () => {
  const r = gateIn({
    "barwise/packages/mcp/src/x.mjs": 'import OpenAI from "openai";\nexport default OpenAI;\n',
    "barwise/packages/vscode/src/y.test.ts": 'import Anthropic from "@anthropic-ai/sdk";\n',
  });
  assert.equal(r.status, 1, output(r));
  assert.match(r.stderr, /model-sdk-boundary {2}mcp\/src\/x\.mjs: imports openai /);
  assert.match(
    r.stderr,
    /model-sdk-boundary {2}vscode\/src\/y\.test\.ts: imports @anthropic-ai\/sdk /,
  );
});

test(`end to end: an SDK in any of four package.json fields exits 1 ${ADR}`, () => {
  for (
    const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]
  ) {
    const r = gateIn({
      "barwise/packages/mcp/package.json": JSON.stringify({ name: "x", [field]: { openai: "^4" } }),
    });
    assert.equal(r.status, 1, `${field}: ${output(r)}`);
    assert.match(
      r.stderr,
      new RegExp(`model-sdk-boundary {2}mcp/package\\.json: ${field} lists openai `),
    );
  }
});

test(`end to end: llm itself, a string, a comment and openai-compat pass ${ADR}`, () => {
  const r = gateIn({
    "barwise/packages/llm/src/client.ts":
      'import Anthropic from "@anthropic-ai/sdk";\nexport default Anthropic;\n',
    "barwise/packages/llm/package.json":
      '{ "dependencies": { "@anthropic-ai/sdk": "^0.30.0", "openai": "^4" } }',
    [CLI_FILE]:
      'export const p = ["anthropic", "openai"];\n// import OpenAI from "openai";\nimport c from "openai-compat";\nexport default c;\n',
    "barwise/packages/mcp/package.json": '{ "dependencies": { "openai-compat": "1" } }',
  });
  assert.equal(r.status, 0, output(r));
  assert.match(
    r.stderr,
    /model-sdk-boundary: \d+ file\(s\) and 2 package\.json outside llm, no SDK/,
  );
});

test(`end to end: a surface with no source is a refusal, never OK ${ADR}`, () => {
  for (const pkg of ["cli", "mcp", "vscode"]) {
    // vscode also holds a listed writer, which the base stages: leave it out too.
    const gone = { [`barwise/packages/${pkg}/src/stub.ts`]: null };
    if (pkg === "vscode") gone["barwise/packages/vscode/src/commands/projectScaffold.ts"] = null;
    const r = gateIn(gone);
    assert.equal(r.status, 2, `${pkg}: ${output(r)}`);
    assert.match(
      r.stderr,
      new RegExp(`model-sdk-boundary: no tracked source file under barwise/packages/${pkg}/src`),
    );
    assert.doesNotMatch(output(r), /source sites: OK/);
  }
});

test(`end to end: no package.json outside llm is a refusal ${ADR}`, () => {
  const r = gateIn({
    "barwise/packages/cli/package.json": null,
    "barwise/packages/llm/package.json": '{ "dependencies": { "openai": "^4" } }',
  });
  assert.equal(r.status, 2, output(r));
  assert.match(r.stderr, /model-sdk-boundary: no package\.json outside llm/);
  assert.doesNotMatch(output(r), /source sites: OK/);
});

test(`end to end: an unparseable package.json is a refusal, not a skip ${ADR}`, () => {
  const r = gateIn({ "barwise/packages/mcp/package.json": '{ "dependencies": { "openai": ' });
  assert.equal(r.status, 2, output(r));
  assert.match(r.stderr, /mcp\/package\.json would not read or parse/);
  assert.doesNotMatch(output(r), /source sites: OK/);
});
