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
    rule: /new Date\(\)/,
    line: 1,
  },
  {
    what: "Date.now()",
    text: "export const n = Date.now();\n",
    rule: /Date\.now\(\)/,
    line: 1,
  },
  {
    what: "Math.random()",
    text: "export const r = Math.random();\n",
    rule: /Math\.random\(\)/,
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
];

for (const c of RED) {
  test(`core purity refuses ${c.what} [adr:determinism-in-core#pure-ops]`, () => {
    const r = purityIn({ [CORE_FILE]: c.text });
    assert.equal(r.status, 1, `expected a finding (1), got ${r.status}:\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, c.rule);
    assert.match(r.stderr, new RegExp(`${CORE_FILE}:${c.line}\\b`));
    assert.match(r.stderr, /fix: /);
  });
}

const GREEN = [
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
  assert.match(r.stderr, /no tracked \.ts\/\.tsx files/);
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
