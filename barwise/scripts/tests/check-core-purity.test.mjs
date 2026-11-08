/**
 * check-core-purity (docs/specs/purity-and-model-boundary.spec.md, WS1),
 * end to end on a git fixture. Each case stages one file at
 * `barwise/packages/core/src/x.ts` in a throwaway repository -- staged,
 * because the gate reads `git ls-files` and an untracked file is invisible
 * to it -- and runs the gate there.
 *
 * The red cases are the forms barwise-ym8.iyw and the plan review measured
 * the line-pattern gate missing; the green ones are the forms that stay
 * allowed, and the comment and string cases are what reading tokens rather
 * than lines buys.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
// Importing the gate must not run it: arch-triage imports it for its rules,
// and a main that ran here would exit this test process.
import { PURITY_RULES, purityFindings } from "../check-core-purity.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "check-core-purity.mjs");
const CORE_FILE = "barwise/packages/core/src/x.ts";

/** Run the gate in a fresh repository holding `files` ({ path: text }), staged. */
function purityIn(files) {
  const dir = mkdtempSync(join(tmpdir(), "barwise-purity-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), text);
      execFileSync("git", ["add", "--", name], { cwd: dir });
    }
    return spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const RED = [
  {
    what: "a violation after a block comment on the same line",
    text:
      '/* c8 ignore */ import { readFileSync } from "node:fs";\nexport const r = readFileSync;\n',
    rule: /S-DET-1 node:fs/,
    line: 1,
  },
  {
    what: "a named import from node:process",
    text: 'import { env } from "node:process";\nexport const e = env;\n',
    rule: /ambient runtime module/,
    line: 1,
  },
  {
    what: "createRequire from node:module",
    text: 'import { createRequire } from "node:module";\nexport const r = createRequire;\n',
    rule: /ambient runtime module/,
    line: 1,
  },
  {
    what: "return import(...)",
    text: 'export function load() {\n  return import("x");\n}\n',
    rule: /runtime import\(\)/,
    line: 2,
  },
  {
    what: "import(...) inside Promise.all",
    text: 'export const all = Promise.all([import("a")]);\n',
    rule: /runtime import\(\)/,
    line: 1,
  },
  {
    what: "import(...).then",
    text: 'export const p = import("a").then((m) => m);\n',
    rule: /runtime import\(\)/,
    line: 1,
  },
  {
    what: "process.cwd()",
    text: "export const here = process.cwd();\n",
    rule: /S-DET-3 process/,
    line: 1,
  },
  {
    what: "process destructured",
    text: "const { cwd } = process;\nexport { cwd };\n",
    rule: /S-DET-3 process/,
    line: 1,
  },
  {
    what: "process inside a template substitution",
    text: "export const s = `home ${process.env.HOME}`;\n",
    rule: /S-DET-3 process/,
    line: 1,
  },
  {
    what: "fetch(u)",
    text: "export const get = (u: string) => fetch(u);\n",
    rule: /network call/,
    line: 1,
  },
  {
    what: "performance.now()",
    text: "export const t = performance.now();\n",
    rule: /S-DET-3 clock/,
    line: 1,
  },
  {
    what: "randomUUID imported from node:crypto",
    text: 'import { randomUUID } from "node:crypto";\nexport const id = randomUUID();\n',
    rule: /randomness/,
    line: 1,
  },
  {
    what: "randomFillSync imported from node:crypto",
    text: 'import { randomFillSync } from "node:crypto";\nexport const f = randomFillSync;\n',
    rule: /randomness/,
    line: 1,
  },
  {
    what: "randomFill imported from crypto",
    text: 'import { randomFill } from "crypto";\nexport const f = randomFill;\n',
    rule: /randomness/,
    line: 1,
  },
  {
    what: "generateKey imported from node:crypto",
    text: 'import { generateKey } from "node:crypto";\nexport const f = generateKey;\n',
    rule: /randomness/,
    line: 1,
  },
  {
    what: "webcrypto imported from node:crypto",
    text: 'import { webcrypto } from "node:crypto";\nexport const w = webcrypto;\n',
    rule: /randomness/,
    line: 1,
  },
  {
    what: "a renamed random import (randomFillSync as h)",
    text: 'import { randomFillSync as h } from "node:crypto";\nexport const f = h;\n',
    rule: /randomness/,
    line: 1,
  },
  {
    what: "a namespace import of node:crypto",
    text: 'import * as c from "node:crypto";\nexport const h = c;\n',
    rule: /randomness/,
    line: 1,
  },
  {
    what: "a default import of node:crypto under an alias",
    text: 'import c from "node:crypto";\nexport const h = c;\n',
    rule: /randomness/,
    line: 1,
  },
  {
    what: "export { randomFillSync } from node:crypto",
    text: 'export { randomFillSync } from "node:crypto";\n',
    rule: /randomness/,
    line: 1,
  },
  {
    what: "export * from node:crypto",
    text: 'export * from "node:crypto";\n',
    rule: /randomness/,
    line: 1,
  },
  {
    what: "import c = require(node:crypto)",
    text: 'import c = require("node:crypto");\nexport const h = c;\n',
    rule: /randomness/,
    line: 1,
  },
  {
    what: "a destructuring require of randomFillSync",
    text: 'const { randomFillSync } = require("node:crypto");\nexport const f = randomFillSync;\n',
    rule: /randomness/,
    line: 1,
  },
  {
    what: "a destructuring require beside createHash",
    text:
      'const { createHash, randomFillSync } = require("node:crypto");\nexport const f = [createHash, randomFillSync];\n',
    rule: /randomness/,
    line: 1,
  },
  {
    what: "a whole-module require of node:crypto",
    text: 'const c = require("node:crypto");\nexport const h = c;\n',
    rule: /randomness/,
    line: 1,
  },
  {
    what: "a bare localeCompare",
    text: "export const by = (a: string, b: string) => a.localeCompare(b);\n",
    rule: /process locale/,
    line: 1,
  },
  {
    what: "Intl.Collator()",
    text: "export const c = new Intl.Collator();\n",
    rule: /process locale/,
    line: 1,
  },
  {
    what: "new Date()",
    text: "export const d = new Date();\n",
    rule: /S-DET-3 clock/,
    line: 1,
  },
  {
    what: "Date.now()",
    text: "export const n = Date.now();\n",
    rule: /S-DET-3 clock/,
    line: 1,
  },
  {
    what: "Math.random()",
    text: "export const r = Math.random();\n",
    rule: /S-DET-2 randomness/,
    line: 1,
  },
  {
    what: "global crypto.*",
    text: "export const g = crypto.getRandomValues;\n",
    rule: /global crypto/,
    line: 1,
  },
  {
    what: "a model SDK subpath",
    text: 'import type { Message } from "@anthropic-ai/sdk/resources";\nexport type M = Message;\n',
    rule: /model SDK/,
    line: 1,
  },
  {
    what: "require of child_process",
    text: 'const cp = require("child_process");\nexport { cp };\n',
    rule: /node:child_process/,
    line: 1,
  },
  // The holes a token scanner left (code review of bb3cd348). Each one is a
  // place where reading tokens without grammar guessed wrong.
  {
    what: "process after a regex holding a backtick, following if (a)",
    text: "export function f(a: boolean, x: string) {\n  if (a) /`/.test(x);\n  return 1;\n}\n"
      + "export const e = process.env.HOME;\n",
    rule: /S-DET-3 process/,
    line: 5,
  },
  {
    what: "process after a division by a variable named of",
    text: "let of = 4;\nexport const h = of / 2; process;\n",
    rule: /S-DET-3 process/,
    line: 2,
  },
  {
    what: "process after a division following a type argument",
    text: "declare const x: number[];\nexport const n = x as Array<number>\n/ 2; process;\n",
    rule: /S-DET-3 process/,
    line: 3,
  },
  {
    what: "import(...).foo in value position",
    text: 'export const m = import("./p.js").foo;\n',
    rule: /runtime import\(\)/,
    line: 1,
  },
  {
    what: "typeof import(...) in value position",
    text: 'export const k = typeof import("./x.js");\n',
    rule: /runtime import\(\)/,
    line: 1,
  },
  {
    what: "Date() called without new",
    text: "export const now = Date();\n",
    rule: /S-DET-3 clock/,
    line: 1,
  },
  {
    what: "new globalThis.Date()",
    text: "export const now = new globalThis.Date();\n",
    rule: /S-DET-3 clock/,
    line: 1,
  },
  {
    what: "globalThis.fetch(u)",
    text: "export const get = (u: string) => globalThis.fetch(u);\n",
    rule: /network call/,
    line: 1,
  },
  {
    what: 'globalThis["process"]',
    text: 'export const p = globalThis["process"];\n',
    rule: /S-DET-3 process/,
    line: 1,
  },
  {
    what: "a .mjs file under core/src importing fs",
    file: "barwise/packages/core/src/x.mjs",
    text: 'import { readFileSync } from "node:fs";\nexport const r = readFileSync;\n',
    rule: /S-DET-1 node:fs/,
    line: 1,
  },
];

for (const c of RED) {
  test(`core purity refuses ${c.what} [adr:determinism-in-core#pure-ops]`, () => {
    const file = c.file ?? CORE_FILE;
    const r = purityIn({ [file]: c.text });
    assert.equal(r.status, 1, `expected a finding (1), got ${r.status}:\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, c.rule);
    assert.match(r.stderr, new RegExp(`${file}:${c.line}\\b`));
    assert.match(r.stderr, /fix: /);
  });
}

const GREEN = [
  {
    what: "createHash imported from node:crypto",
    text: 'import { createHash } from "node:crypto";\nexport const h = createHash;\n',
  },
  {
    what: "createHash renamed on import",
    text: 'import { createHash as h } from "node:crypto";\nexport const x = h;\n',
  },
  {
    what: "import type { Hash } from node:crypto",
    text: 'import type { Hash } from "node:crypto";\nexport type H = Hash;\n',
  },
  {
    what: "import { type Hash, createHash } from node:crypto",
    text:
      'import { type Hash, createHash } from "node:crypto";\nexport const h: Hash = createHash("sha256");\n',
  },
  {
    what: "import type * as c from node:crypto",
    text: 'import type * as c from "node:crypto";\nexport type H = c.Hash;\n',
  },
  {
    what: "a destructuring require of createHash",
    text: 'const { createHash } = require("node:crypto");\nexport const h = createHash;\n',
  },
  { what: "import(...).T in a type", text: 'export type T = import("x").T;\n' },
  { what: "typeof import(...)", text: 'export type M = typeof import("x");\n' },
  {
    what: "a string naming fetch, process and Intl",
    text: 'export const s = "fetch process Intl";\n',
  },
  {
    what: "comments mentioning process.env",
    text: "// reads process.env.HOME\n/** Date.now() and fetch */\nexport const a = 1;\n",
  },
  {
    what: "a regex literal holding a quote and a banned name",
    text: 'export const re = /process"/;\nexport const n = 1 / 2;\n',
  },
  { what: "a template literal naming process", text: "export const t = `process ${1} fetch`;\n" },
  // Names that are not the global: a property key, a member, a type.
  { what: "a property key named process", text: "export const o = { process: 1 };\n" },
  {
    what: "members named process and fetch",
    text:
      "declare const o: { process: number; fetch(): void; };\nexport const p = o.process;\no.fetch();\n",
  },
  { what: "a Date type annotation", text: "declare const x: Date;\nexport const d: Date = x;\n" },
  {
    what: "typeof import(...) in a type alias",
    text: 'export type T = typeof import("./x.js");\n',
  },
  { what: "import(...).T in an annotation", text: 'export let t: import("x").T;\n' },
];

for (const c of GREEN) {
  test(`core purity allows ${c.what} [adr:determinism-in-core#pure-ops]`, () => {
    const r = purityIn({ [CORE_FILE]: c.text });
    assert.equal(r.status, 0, `expected OK (0), got ${r.status}:\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /core purity: OK -- 1 file\(s\)/);
  });
}

test("core purity refuses with exit 2 when there is no tracked core source [adr:gate-refusal-contract#refuse-not-find]", () => {
  // A test file is excluded, so this tree has a core/src and nothing in it
  // to read: the shape that printed OK over zero files before.
  const r = purityIn({
    "README.md": "x\n",
    "barwise/packages/core/src/x.test.ts": "export const d = Date.now();\n",
  });
  assert.equal(r.status, 2, `expected refusal (2), got ${r.status}:\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /no tracked source files/);
  assert.doesNotMatch(`${r.stdout}${r.stderr}`, /core purity: OK/);
});

test("purityFindings reads a .tsx file as JSX and reports each rule it exports", () => {
  const findings = purityFindings(
    'export const C = () => <div title="process">{fetch}</div>;\n',
    "C.tsx",
  );
  assert.deepEqual(findings.map((f) => f.rule), ["S-DET-1 network call"]);
  for (const f of findings) {
    assert.ok(PURITY_RULES.some((r) => f.rule === `${r.id} ${r.name}`), f.rule);
  }
});
