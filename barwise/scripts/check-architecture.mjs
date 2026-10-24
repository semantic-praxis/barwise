#!/usr/bin/env node
/**
 * The package graph has one authority, and its copies agree with it
 * (docs/specs/architecture-index.spec.md, WS1).
 *
 * `INTENDED` in `scripts/lib/intended.cjs` is the authority: it is the map
 * dependency-cruiser enforces against real imports. Two other places state
 * the same graph, and nothing compared them with it before this check:
 *
 *   - the root CLAUDE.md "Dependency Graph" block, which is what a reader
 *     (and an agent) actually reads. Every edge it shows must be in
 *     `INTENDED` and every edge in `INTENDED` must be shown; a one-way
 *     check would let a removed package linger in the picture.
 *   - each package's runtime `dependencies` in package.json. An internal
 *     dependency `INTENDED` does not allow is a layering decision taken in
 *     the manifest, where depcruise never looks (peer and optional
 *     dependencies count too). `devDependencies` are not compared: `@barwise/llm` lists `@barwise/diagram` there for its
 *     tests, which ship nothing.
 *
 * Exit 0 all agree, 1 an edge or dependency disagrees (each named), 2 an
 * input could not be read or parsed -- a graph block that parses to
 * nothing must not read as "no edges, so none missing"
 * (docs/specs/gate-refusal-contract.spec.md).
 *
 * `--root <dir>` reads CLAUDE.md, barwise/scripts/lib/intended.cjs and
 * barwise/packages/* from another tree, for this check's own tests;
 * nothing else passes it.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { opt } from "./lib/args.mjs";

/** The internal package an npm name refers to, by directory name, or null. */
function internal(name) {
  if (name.startsWith("@barwise/")) return name.slice("@barwise/".length);
  if (name === "barwise-vscode") return "vscode";
  return null;
}

/**
 * The edges the CLAUDE.md block draws, as a map of package to the
 * packages it lists. A package line is `@barwise/x (a, b)` or
 * `|--- @barwise/x (a, b)  -- comment`; continuation lines of a comment
 * begin with `|` and spaces, so they never start with a package name.
 */
function graphEdges(claudeMd) {
  const lines = claudeMd.split("\n");
  const heading = lines.findIndex((l) => /^##\s+Dependency Graph\s*$/.test(l));
  if (heading === -1) throw new Error('CLAUDE.md has no "## Dependency Graph" heading');
  // The closing fence must lie inside this section: a section that lost
  // its block then refuses, rather than reading a later section's block.
  const next = lines.findIndex((l, i) => i > heading && l.startsWith("## "));
  const end = next === -1 ? lines.length : next;
  const open = lines.findIndex((l, i) => i > heading && l.startsWith("```"));
  const close = lines.findIndex((l, i) => i > open && i < end && l.startsWith("```"));
  if (open === -1 || close === -1) {
    throw new Error("the Dependency Graph section has no fenced block");
  }
  const edges = new Map();
  const twice = [];
  for (const line of lines.slice(open + 1, close)) {
    const m = /^\s*(?:\|---\s+)?(@barwise\/[\w-]+|barwise-vscode)\s+\(([^)]*)\)/.exec(line);
    if (!m) continue;
    const pkg = internal(m[1]);
    const deps = m[2].trim() === "no internal deps"
      ? []
      : m[2].split(",").map((s) => s.trim()).filter(Boolean);
    if (edges.has(pkg)) twice.push(pkg);
    edges.set(pkg, deps);
  }
  if (edges.size === 0) throw new Error("the Dependency Graph block names no package");
  return { edges, twice };
}

/**
 * Runtime dependency fields: each is installed and resolved when the
 * package runs, so a layering edge in any of them is one depcruise cannot
 * see. `devDependencies` alone is left out (see the header).
 */
const RUNTIME = ["dependencies", "peerDependencies", "optionalDependencies"];

let intended, graph, manifests;
try {
  // Inside the refusal: a bare `--root` throws, and that is "could not
  // answer", not the exit 1 a real disagreement uses.
  const root = resolve(
    opt("--root") ?? join(dirname(fileURLToPath(import.meta.url)), "..", ".."),
  );
  const intendedPath = join(root, "barwise", "scripts", "lib", "intended.cjs");
  intended = createRequire(import.meta.url)(intendedPath);
  const shape = intended && typeof intended === "object"
    && Object.values(intended).every(
      (v) => Array.isArray(v) && v.every((d) => typeof d === "string"),
    );
  if (!shape || Object.keys(intended).length === 0) {
    throw new Error(`${intendedPath} does not export a map of package to package list`);
  }
  graph = graphEdges(readFileSync(join(root, "CLAUDE.md"), "utf8"));
  const pkgs = join(root, "barwise", "packages");
  manifests = readdirSync(pkgs, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => [e.name, join(pkgs, e.name, "package.json")])
    // A directory without a manifest (a stray build folder) is not a package.
    .filter(([, p]) => existsSync(p))
    .map(([dir, p]) => {
      try {
        return { dir, json: JSON.parse(readFileSync(p, "utf8")) };
      } catch (err) {
        throw new Error(`${p}: ${err.message}`);
      }
    });
  if (manifests.length === 0) throw new Error(`no package.json under ${pkgs}`);
} catch (err) {
  console.error(`check:architecture: cannot answer -- ${err.message}`);
  process.exit(2);
}

const problems = [];
for (const pkg of graph.twice) problems.push(`CLAUDE.md lists ${pkg} twice`);

const edgeSet = (m) => new Set([...m].flatMap(([p, ds]) => ds.map((d) => `${p} -> ${d}`)));
const drawn = edgeSet(graph.edges);
const allowed = edgeSet(Object.entries(intended));
for (const e of drawn) {
  if (!allowed.has(e)) problems.push(`CLAUDE.md draws ${e}, INTENDED does not`);
}
for (const e of allowed) if (!drawn.has(e)) problems.push(`INTENDED has ${e}, CLAUDE.md does not`);
for (const p of Object.keys(intended)) {
  if (!graph.edges.has(p)) problems.push(`CLAUDE.md does not list ${p}`);
}
for (const p of graph.edges.keys()) {
  if (!(p in intended)) problems.push(`CLAUDE.md lists ${p}, INTENDED does not`);
}
// INTENDED and the picture agreeing is not enough: a deleted or misspelled
// package would pass in both. Every key is a package with a manifest, and
// every target is a key -- depcruise's group would silently drop a
// misspelled one.
const dirs = new Set(manifests.map((m) => m.dir));
for (const [p, ds] of Object.entries(intended)) {
  if (!dirs.has(p)) problems.push(`INTENDED has ${p}, which is not a package under packages/`);
  for (const d of ds) {
    if (!(d in intended)) problems.push(`INTENDED has ${p} -> ${d}, and ${d} is not a key`);
  }
}

for (const { dir, json } of manifests) {
  if (internal(json.name ?? "") !== dir) {
    problems.push(`packages/${dir}: name ${json.name} does not match its directory`);
  }
  if (!(dir in intended)) {
    problems.push(`packages/${dir}: not in INTENDED`);
    continue;
  }
  for (const field of RUNTIME) {
    for (const dep of Object.keys(json[field] ?? {})) {
      const target = internal(dep);
      if (target !== null && !intended[dir].includes(target)) {
        problems.push(`packages/${dir}: ${field} has ${dep}, INTENDED does not allow it`);
      }
    }
  }
}

if (problems.length > 0) {
  console.error(`check:architecture: FAIL -- ${problems.length} disagreement(s) with INTENDED:`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    "INTENDED (barwise/scripts/lib/intended.cjs) is the authority: fix the copy, or change"
      + " INTENDED and every copy in the same commit.",
  );
  process.exit(1);
}
console.log(
  `check:architecture: ${drawn.size} edges in CLAUDE.md and ${manifests.length} package manifests`
    + " agree with INTENDED. OK",
);
