#!/usr/bin/env node
// Architecture triage (read-only): a reflexion snapshot and a
// VCS-history hotspot/coupling ranking for the architecture-analysis
// program (docs/specs/architecture-analysis.spec.md, WS2).
//
// It answers two questions without touching production code or CI:
//   1. Reflexion -- does the actual import graph match the intended
//      one-way graph, and is core free of I/O / clocks / randomness?
//      (Maps to scenarios S-ORTH-1..3 and S-DET-1..3.)
//   2. Hotspots -- which files concentrate change (git history) and
//      size, and which files in different packages change together
//      (temporal coupling, an orthogonality smell)?
//
// No npm dependencies: the gate tool (dependency-cruiser) is decided in
// WS4. The one local require is the package graph itself
// (lib/intended.cjs), so this snapshot cannot drift from the gate.
//
// Usage: node barwise/scripts/arch-triage.mjs [--base <ref>]
//
// --base <ref> limits the hotspot/coupling window to commits after the
// given ref (e.g. the last release tag), so a review at a release
// boundary ranks only the changes since that release rather than all
// history (REPO_REVIEW-2026-06-23 item 3).

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";

const gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const pkgRoot = join(gitRoot, "barwise", "packages");

// The intended one-way graph, from its one home (scripts/lib/intended.cjs);
// this snapshot diffs reality against it.
const INTENDED = createRequire(import.meta.url)("./lib/intended.cjs");

const PACKAGES = Object.keys(INTENDED);

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
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

function srcFiles(pkg) {
  return walk(join(pkgRoot, pkg, "src"));
}

// ---- 1a. Dependency-direction reflexion (S-ORTH-1..3) ----

const IMPORT_RE = /(?:from|import|export[^;]*from|import\()\s*['"]@barwise\/([a-z-]+)['"]/g;

function actualDeps(pkg) {
  const deps = new Map(); // target -> example file:line
  for (const file of srcFiles(pkg)) {
    const text = readFileSync(file, "utf8");
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      let m;
      const re = new RegExp(IMPORT_RE.source, "g");
      while ((m = re.exec(line))) {
        const target = m[1];
        if (target === pkg) continue;
        if (!deps.has(target)) {
          deps.set(target, `${relative(gitRoot, file)}:${i + 1}`);
        }
      }
    });
  }
  return deps;
}

const directionDivergences = [];
for (const pkg of PACKAGES) {
  const allowed = new Set(INTENDED[pkg]);
  const actual = actualDeps(pkg);
  for (const [target, where] of actual) {
    if (!allowed.has(target)) {
      directionDivergences.push({ pkg, target, where });
    }
  }
}

// ---- 1b. Core-purity reflexion (S-DET-1..3) ----

const FORBIDDEN = [
  { name: "node:fs", re: /from\s+['"](node:)?fs(\/promises)?['"]|require\(\s*['"](node:)?fs['"]/ },
  { name: "node:child_process", re: /from\s+['"](node:)?child_process['"]/ },
  { name: "node:os", re: /from\s+['"](node:)?os['"]/ },
  { name: "network", re: /from\s+['"](node:)?(net|http|https|tls|dgram|http2)['"]/ },
  { name: "process.env", re: /\bprocess\.env\b/ },
  { name: "new Date()", re: /\bnew\s+Date\s*\(/ },
  { name: "Date.now()", re: /\bDate\.now\s*\(/ },
  { name: "Math.random()", re: /\bMath\.random\s*\(/ },
  { name: "global crypto.*", re: /(?<!node:)\bcrypto\.\w/ },
  { name: "@anthropic-ai/sdk", re: /from\s+['"]@anthropic-ai\/sdk['"]/ },
  { name: "openai", re: /from\s+['"]openai['"]/ },
];

const purityViolations = [];
for (const file of srcFiles("core")) {
  const text = readFileSync(file, "utf8");
  text.split("\n").forEach((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return; // skip comment lines
    for (const f of FORBIDDEN) {
      if (f.re.test(line)) {
        purityViolations.push({
          rule: f.name,
          where: `${relative(gitRoot, file)}:${i + 1}`,
          text: line.trim().slice(0, 80),
        });
      }
    }
  });
}

// ---- 2. Hotspots and temporal coupling (git history) ----

const MARK = "__C__";

// Optional --base <ref>: rank hotspots over `<ref>..HEAD` only.
const baseIdx = process.argv.indexOf("--base");
const baseRef = baseIdx >= 0 ? process.argv[baseIdx + 1] : undefined;
if (baseIdx >= 0 && !baseRef) {
  console.error("error: --base requires a ref (e.g. --base v1.6.0)");
  process.exit(1);
}
if (baseRef) {
  // Fail fast on an unknown ref instead of silently ranking nothing.
  try {
    execFileSync("git", ["rev-parse", "--verify", `${baseRef}^{commit}`], {
      stdio: "ignore",
    });
  } catch {
    console.error(
      `error: unknown ref "${baseRef}" (fetch tags first: git fetch --tags)`,
    );
    process.exit(1);
  }
  console.log(`Hotspot window: ${baseRef}..HEAD\n`);
}

const log = execFileSync("git", [
  "log",
  "--no-merges",
  "--numstat",
  `--format=${MARK}%H`,
  ...(baseRef ? [`${baseRef}..HEAD`] : []),
  "--",
  "barwise/packages",
], { cwd: gitRoot, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

const freq = new Map(); // path -> commits touching it
const coCount = new Map(); // JSON.stringify([a, b]) -> co-changes
let commits = 0;
let curFiles = [];

function flush() {
  if (curFiles.length === 0) return;
  commits++;
  for (const f of curFiles) freq.set(f, (freq.get(f) ?? 0) + 1);
  // Cap to avoid sweeping commits dominating the coupling signal.
  if (curFiles.length <= 25) {
    for (let a = 0; a < curFiles.length; a++) {
      for (let b = a + 1; b < curFiles.length; b++) {
        const key = JSON.stringify([curFiles[a], curFiles[b]].sort());
        coCount.set(key, (coCount.get(key) ?? 0) + 1);
      }
    }
  }
}

for (const raw of log.split("\n")) {
  if (raw.startsWith(MARK)) {
    flush();
    curFiles = [];
    continue;
  }
  const parts = raw.split("\t");
  if (parts.length === 3) {
    const path = parts[2];
    if (/^barwise\/packages\/[^/]+\/src\/.*\.(ts|tsx)$/.test(path) && !/\.d\.ts$/.test(path)) {
      curFiles.push(path);
    }
  }
}
flush();

function pkgOf(path) {
  const m = path.match(/^barwise\/packages\/([^/]+)\//);
  return m ? m[1] : "?";
}

function lineCount(path) {
  try {
    const abs = join(gitRoot, path);
    statSync(abs);
    return readFileSync(abs, "utf8").split("\n").length;
  } catch {
    return 0; // deleted/renamed since
  }
}

// Hotspots: still-present files ranked by frequency x size.
const hotspots = [...freq.entries()]
  .map(([path, commits]) => ({ path, commits, lines: lineCount(path) }))
  .filter((h) => h.lines > 0)
  .map((h) => ({ ...h, score: h.commits * h.lines }))
  .sort((a, b) => b.score - a.score || b.commits - a.commits)
  .slice(0, 15);

// Cross-package temporal coupling, ranked by coupling degree.
const coupling = [...coCount.entries()]
  .map(([key, co]) => {
    const [a, b] = JSON.parse(key);
    return { a, b, co, fa: freq.get(a) ?? 0, fb: freq.get(b) ?? 0 };
  })
  .filter((c) => pkgOf(c.a) !== pkgOf(c.b) && c.co >= 3)
  .map((c) => ({ ...c, degree: c.co / Math.min(c.fa, c.fb) }))
  .sort((a, b) => b.degree - a.degree || b.co - a.co)
  .slice(0, 15);

// ---- Report ----

const L = [];
L.push("# Architecture triage report");
L.push("");
L.push(`Commits analyzed (non-merge, touching packages/): ${commits}`);
L.push("");
L.push("## Reflexion: dependency direction (S-ORTH-1..3)");
L.push("");
if (directionDivergences.length === 0) {
  L.push("No divergences. Every package imports only within its intended set.");
} else {
  for (const d of directionDivergences) {
    L.push(`- DIVERGENCE: ${d.pkg} -> @barwise/${d.target}  (${d.where})`);
  }
}
L.push("");
L.push("## Reflexion: core purity (S-DET-1..3)");
L.push("");
if (purityViolations.length === 0) {
  L.push("No violations. core/src imports no I/O, clock, randomness, or LLM SDK.");
} else {
  for (const v of purityViolations) {
    L.push(`- ${v.rule}: ${v.where}  | ${v.text}`);
  }
}
L.push("");
L.push("## Hotspots (change frequency x current size)");
L.push("");
L.push("| Rank | Commits | Lines | Score | File |");
L.push("| ---- | ------- | ----- | ----- | ---- |");
hotspots.forEach((h, i) => {
  L.push(`| ${i + 1} | ${h.commits} | ${h.lines} | ${h.score} | ${h.path} |`);
});
L.push("");
L.push("## Cross-package temporal coupling (orthogonality smell)");
L.push("");
L.push("Files in different packages that change together. Degree = co-changes / min(freq).");
L.push("");
L.push("| Co | Degree | A | B |");
L.push("| -- | ------ | - | - |");
coupling.forEach((c) => {
  L.push(`| ${c.co} | ${c.degree.toFixed(2)} | ${c.a} | ${c.b} |`);
});
L.push("");

process.stdout.write(L.join("\n"));
