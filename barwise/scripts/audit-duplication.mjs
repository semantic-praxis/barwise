#!/usr/bin/env node
// audit-duplication.mjs -- the deterministic detection half of the
// logic-duplication sweep (drift-guards spec workstream 5,
// barwise-871; method: .claude/skills/duplication-audit/).
//
// Emits a candidate report: places where one decision MAY be stated
// more than once. Detection is mechanical and deterministic -- the
// same tree produces byte-identical output -- and it assigns no
// verdicts: classification against the rubric (guarded / benign
// parallel / drift-prone / diverged) is the auditor's job, recorded
// in audit-baseline.json.
//
//   node scripts/audit-duplication.mjs            print the report
//   node scripts/audit-duplication.mjs --check    diff against the baseline:
//     - a candidate absent from the baseline fails (new, unclassified
//       duplication: classify it -- share, derive, register in
//       parity.manifest.json, drift-test, or accept here);
//     - a baseline entry no longer detected fails (the finding was
//       resolved: remove the entry, close its issue).
//     Both directions loud, so the baseline's `tracked` entries always
//     enumerate exactly the detectable findings still open.
//
// Detectors (crisp only -- each keyed stably, never by line number):
//   literal    a double-quoted string literal of 28+ chars appearing
//              in 2+ source files
//   union      a re-statement site of a core string-literal union
//              (Record<U,...>, Set<U>, readonly U[]) outside the
//              union's own declaration file
//   prose      a doc/CLAUDE.md line carrying parity-claim vocabulary
//              ("keep in sync", "must match", "hand-maintained", ...)
//   generated  a generated source file, with whether any test file
//              mentions it by name (a guard candidate)
//
// Clone detection (jscpd) is deliberately NOT a detector here: it
// needs a dependency the repo does not carry, and its findings go
// quiet exactly when a pair drifts. Run it by hand during a full
// sweep per the duplication-audit skill.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = process.argv.includes("--check");

function sha(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

function* walk(dir, skip) {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (skip.has(entry)) continue;
      yield* walk(full, skip);
    } else {
      yield full;
    }
  }
}

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "tests", "test"]);

function sourceFiles() {
  const files = [];
  const pkgs = readdirSync(join(root, "packages")).sort();
  for (const pkg of pkgs) {
    const src = join(root, "packages", pkg, "src");
    try {
      statSync(src);
    } catch {
      continue;
    }
    for (const f of walk(src, SKIP_DIRS)) {
      if (!/\.(ts|tsx)$/.test(f)) continue;
      if (/\.generated\./.test(f)) continue;
      files.push(relative(root, f));
    }
  }
  return files;
}

// --- detector: literal -------------------------------------------------

function detectLiterals(files) {
  const byLiteral = new Map();
  for (const file of files) {
    const text = readFileSync(join(root, file), "utf8");
    const seen = new Set();
    for (const m of text.matchAll(/"((?:[^"\\\n]|\\.){28,})"/g)) {
      const lit = m[1];
      // Module specifiers are imports, not decisions.
      if (/^(\.\.?\/|@)/.test(lit) || lit.endsWith(".js")) continue;
      if (seen.has(lit)) continue;
      seen.add(lit);
      if (!byLiteral.has(lit)) byLiteral.set(lit, []);
      byLiteral.get(lit).push(file);
    }
  }
  const candidates = [];
  for (const [lit, where] of byLiteral) {
    if (where.length < 2) continue;
    candidates.push({
      id: `literal:${sha(lit)}`,
      detail: `"${lit.slice(0, 70)}${lit.length > 70 ? "..." : ""}" in ${where.join(", ")}`,
    });
  }
  return candidates;
}

// --- detector: union ---------------------------------------------------

function coreUnions() {
  const names = [];
  for (const file of sourceFiles()) {
    if (!file.startsWith("packages/core/src/")) continue;
    const text = readFileSync(join(root, file), "utf8");
    for (
      const m of text.matchAll(
        /export type (\w+) =\s*(?:\n\s*\| "[\w-]+")+\s*;/g,
      )
    ) {
      names.push({ name: m[1], declaredIn: file });
    }
  }
  return names;
}

function detectUnionRestatements(files) {
  const unions = coreUnions();
  const candidates = [];
  for (const file of files) {
    const text = readFileSync(join(root, file), "utf8");
    for (const { name, declaredIn } of unions) {
      if (file === declaredIn) continue;
      const constructs = [
        [`Record<${name}`, "record"],
        [`Set<${name}>`, "set"],
        [`readonly ${name}[]`, "array"],
      ];
      for (const [needle, kind] of constructs) {
        if (text.includes(needle)) {
          candidates.push({
            id: `union:${sha(`${file}|${name}|${kind}`)}`,
            detail: `${name} restated as ${kind} in ${file}`,
          });
        }
      }
    }
  }
  return candidates;
}

// --- detector: prose ---------------------------------------------------

const PROSE_PATTERNS = [
  /keep(?:\w* )?in sync/i,
  /must match/i,
  /hand-maintained/i,
  /kept in sync/i,
  /update this (?:table|list|file) when/i,
];

function proseFiles() {
  const files = [];
  const addIf = (p) => {
    try {
      statSync(join(root, p));
      files.push(p);
    } catch { /* absent is fine */ }
  };
  addIf("../CLAUDE.md");
  addIf("../AGENTS.md");
  addIf("../README.md");
  for (const pkg of readdirSync(join(root, "packages")).sort()) {
    addIf(`packages/${pkg}/CLAUDE.md`);
  }
  for (const f of walk(join(root, "docs"), new Set(["archive", "specs", "anki"]))) {
    // Dated audits and specs legitimately DISCUSS the parity
    // vocabulary; the prose detector's target is standing instruction
    // docs, where such a claim is a live hand-maintained mirror.
    if (f.endsWith(".md") && !/audit/.test(f)) files.push(relative(root, f));
  }
  return files;
}

function detectProseClaims() {
  const candidates = [];
  for (const file of proseFiles()) {
    const text = readFileSync(join(root, file), "utf8");
    for (const line of text.split("\n")) {
      if (PROSE_PATTERNS.some((p) => p.test(line))) {
        candidates.push({
          id: `prose:${sha(`${file}|${line.trim()}`)}`,
          detail: `${file}: ${line.trim().slice(0, 90)}`,
        });
      }
    }
  }
  return candidates;
}

// --- detector: generated ----------------------------------------------

function detectGenerated() {
  const candidates = [];
  const testTexts = [];
  for (const pkg of readdirSync(join(root, "packages")).sort()) {
    const tests = join(root, "packages", pkg, "tests");
    try {
      statSync(tests);
    } catch {
      continue;
    }
    for (const f of walk(tests, new Set(["node_modules"]))) {
      if (/\.(ts|tsx)$/.test(f)) testTexts.push(readFileSync(f, "utf8"));
    }
  }
  const allTests = testTexts.join("\n");
  for (const pkg of readdirSync(join(root, "packages")).sort()) {
    const src = join(root, "packages", pkg, "src");
    try {
      statSync(src);
    } catch {
      continue;
    }
    for (const f of walk(src, new Set(["node_modules", "dist"]))) {
      const rel = relative(root, f);
      const base = rel.split("/").pop();
      const isGenerated = /\.generated\./.test(base)
        || (/\.(ts|tsx)$/.test(base)
          && /(?:do not edit|generated by)/i.test(
            readFileSync(f, "utf8").slice(0, 400),
          ));
      if (!isGenerated) continue;
      const guarded = allTests.includes(base);
      candidates.push({
        id: `generated:${sha(rel)}`,
        detail: `${rel} (guard test mentioning it: ${guarded ? "yes" : "NO"})`,
      });
    }
  }
  return candidates;
}

// --- report ------------------------------------------------------------

const files = sourceFiles();
const candidates = [
  ...detectLiterals(files),
  ...detectUnionRestatements(files),
  ...detectProseClaims(),
  ...detectGenerated(),
].sort((a, b) => a.id.localeCompare(b.id));

if (!CHECK) {
  for (const c of candidates) console.log(`${c.id}  ${c.detail}`);
  console.log(`\naudit-duplication: ${candidates.length} candidate(s).`);
  process.exit(0);
}

const baseline = JSON.parse(
  readFileSync(join(root, "audit-baseline.json"), "utf8"),
);
const baselineIds = new Map(
  Object.entries(baseline.candidates).map(([id, entry]) => [id, entry]),
);
const currentIds = new Set(candidates.map((c) => c.id));
const failures = [];

for (const c of candidates) {
  if (!baselineIds.has(c.id)) {
    failures.push(
      `NEW candidate not in audit-baseline.json:\n    ${c.id}  ${c.detail}\n`
        + `    Classify it: share/derive the copy, register it in parity.manifest.json,\n`
        + `    add a drift test, or record it here as accepted-benign / tracked:<issue>.`,
    );
  }
}
for (const [id, entry] of baselineIds) {
  if (!currentIds.has(id)) {
    failures.push(
      `STALE baseline entry no longer detected: ${id} (${entry.note ?? entry.status})\n`
        + `    The finding was resolved -- remove the entry`
        + `${entry.status.startsWith("tracked") ? " and close its issue" : ""}.`,
    );
  }
}

if (failures.length > 0) {
  console.error(`audit-duplication --check: ${failures.length} failure(s)`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
const tracked = [...baselineIds.values()].filter((e) => e.status.startsWith("tracked"));
console.log(
  `audit-duplication --check: ${candidates.length} candidate(s), all classified; `
    + `${tracked.length} tracked as open findings. OK`,
);
