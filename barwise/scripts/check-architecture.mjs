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
 *     the manifest, where depcruise never looks. `devDependencies` are not
 *     compared: `@barwise/llm` lists `@barwise/diagram` there for its
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
  const open = lines.findIndex((l, i) => i > heading && l.startsWith("```"));
  const close = lines.findIndex((l, i) => i > open && l.startsWith("```"));
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

const root = resolve(opt("--root") ?? join(dirname(fileURLToPath(import.meta.url)), "..", ".."));

let intended, graph, manifests;
try {
  const intendedPath = join(root, "barwise", "scripts", "lib", "intended.cjs");
  intended = createRequire(import.meta.url)(intendedPath);
  const shape = intended && typeof intended === "object"
    && Object.values(intended).every((v) => Array.isArray(v));
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
    .map(([dir, p]) => ({ dir, json: JSON.parse(readFileSync(p, "utf8")) }));
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

for (const { dir, json } of manifests) {
  if (internal(json.name ?? "") !== dir) {
    problems.push(`packages/${dir}: name ${json.name} does not match its directory`);
  }
  if (!(dir in intended)) {
    problems.push(`packages/${dir}: not in INTENDED`);
    continue;
  }
  for (const dep of Object.keys(json.dependencies ?? {})) {
    const target = internal(dep);
    if (target !== null && !intended[dir].includes(target)) {
      problems.push(`packages/${dir}: depends on ${dep}, INTENDED does not allow it`);
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
