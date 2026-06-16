#!/usr/bin/env node
// Core-determinism gate -- WS5 of docs/specs/architecture-analysis.spec.md.
//
// Enforces "determinism in core": packages/core/src must be free of I/O,
// clocks, randomness, and the LLM SDKs (scenarios S-DET-1..3). This is a
// code-pattern check, not an import-graph one, so it lives here rather
// than in .dependency-cruiser.cjs -- dependency-cruiser sees imports but
// not process.env / Date.now / Math.random usage.
//
// Exits non-zero on any violation. Gating in CI.
//
// Usage: node barwise/scripts/check-core-purity.mjs

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const coreSrc = join(gitRoot, "barwise", "packages", "core", "src");

const RULES = [
  { id: "S-DET-1", name: "node:fs", re: /from\s+['"](node:)?fs(\/promises)?['"]/ },
  { id: "S-DET-1", name: "node:child_process", re: /from\s+['"](node:)?child_process['"]/ },
  { id: "S-DET-1", name: "node:os", re: /from\s+['"](node:)?os['"]/ },
  {
    id: "S-DET-1",
    name: "network module",
    re: /from\s+['"](node:)?(net|http|https|tls|dgram|http2)['"]/,
  },
  { id: "S-DET-3", name: "process.env", re: /\bprocess\.env\b/ },
  { id: "S-DET-3", name: "new Date()", re: /\bnew\s+Date\s*\(/ },
  { id: "S-DET-3", name: "Date.now()", re: /\bDate\.now\s*\(/ },
  { id: "S-DET-2", name: "Math.random()", re: /\bMath\.random\s*\(/ },
  { id: "S-DET-2", name: "global crypto.*", re: /(?<!node:)\bcrypto\.\w/ },
  { id: "S-DET-1", name: "@anthropic-ai/sdk", re: /from\s+['"]@anthropic-ai\/sdk['"]/ },
  { id: "S-DET-1", name: "openai SDK", re: /from\s+['"]openai['"]/ },
];

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const violations = [];
for (const file of walk(coreSrc)) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // skip comment lines
    for (const r of RULES) {
      if (r.re.test(line)) {
        violations.push({
          rule: `${r.id} ${r.name}`,
          where: `${relative(gitRoot, file)}:${i + 1}`,
          text: line.trim().slice(0, 90),
        });
      }
    }
  });
}

if (violations.length === 0) {
  console.warn("core purity: OK -- no I/O, clock, randomness, or LLM SDK in core/src.");
  process.exit(0);
}

console.error(`core purity: ${violations.length} violation(s) in packages/core/src:`);
for (const v of violations) {
  console.error(`  ${v.rule}  ${v.where}\n    ${v.text}`);
}
console.error("\nDeterminism in core is a primary pillar. Move this to an outer");
console.error("package (cli/mcp/vscode) or a connector, or pass the value in.");
process.exit(1);
