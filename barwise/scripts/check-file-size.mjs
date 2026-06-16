#!/usr/bin/env node
// File-size smell report -- WS6 of docs/specs/architecture-analysis.spec.md.
//
// Warn-only (never gates). Large files are a smell, not a rule -- a
// cohesive generated file can be legitimately long, so this reports
// candidates for the god-file work tracked under REPO_REVIEW A1 and
// scenario S-ORTH-5, and leaves the judgment to a human. Drive splits
// from this list together with the hotspot ranking in arch-triage.mjs.
//
// Exits 0 always. Run in CI as a non-blocking step.
//
// Usage: node barwise/scripts/check-file-size.mjs [threshold]

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const THRESHOLD = Number(process.argv[2] ?? 600);

const gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const packages = join(gitRoot, "barwise", "packages");

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "dist") continue;
      out.push(...walk(p));
    } else if (/\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

const big = [];
for (const pkg of readdirSync(packages)) {
  const src = join(packages, pkg, "src");
  for (const file of walk(src)) {
    const lines = readFileSync(file, "utf8").split("\n").length;
    if (lines > THRESHOLD) big.push({ file: relative(gitRoot, file), lines });
  }
}

big.sort((a, b) => b.lines - a.lines);

if (big.length === 0) {
  console.warn(`file-size: OK -- no source file over ${THRESHOLD} lines.`);
  process.exit(0);
}

console.warn(`file-size: ${big.length} file(s) over ${THRESHOLD} lines (warn-only smell):`);
for (const b of big) {
  console.warn(`  ${String(b.lines).padStart(5)}  ${b.file}`);
}
process.exit(0);
