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
 *   - each package's runtime dependencies in package.json. An internal
 *     dependency `INTENDED` does not allow is a layering decision taken in
 *     the manifest, where depcruise never looks (peer and optional
 *     dependencies count too). `devDependencies` are not compared:
 *     `@barwise/llm` lists `@barwise/diagram` there for its tests, which
 *     ship nothing.
 *
 * Package names map to directories through the manifests themselves, not
 * a naming rule, so `barwise-vscode` needs no special case and a package
 * outside the `@barwise/` scope is still recognised as internal.
 *
 * Exit 0 all agree, 1 an edge or dependency disagrees (each named), 2 an
 * input could not be read or has the wrong shape -- a graph block that
 * parses to nothing must not read as "no edges, so none missing"
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

/**
 * Runtime dependency fields: each is installed and resolved when the
 * package runs, so a layering edge in any of them is one depcruise cannot
 * see. `devDependencies` alone is left out (see the header).
 */
const RUNTIME = ["dependencies", "peerDependencies", "optionalDependencies"];

const isMap = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** The values in `list` that occur more than once. */
const repeated = (list) => [...new Set(list.filter((x, i) => list.indexOf(x) !== i))];

/**
 * The CLAUDE.md block, as package name to the names it lists, read by a
 * declared grammar -- GRAMMAR below, which is also the refusal message.
 * Any line outside it is refused (exit 2) with the line named.
 *
 * Five heuristics for telling hand-drawn rows from prose were tried first,
 * and each misread a realistic edit -- a nested connector skipped, a
 * comment that opened with a package name read as a second listing, a
 * legend read as a package -- and a shape test on comment text then failed
 * both ways (a lost row with a trailing note passed; `registry (x)`
 * prose was refused). Position settles it: a comment line starts in the
 * exact column where its row's comment text starts, as every wrap in the
 * real block is drawn, so a row that lost its connector sits at the
 * wrong column and is refused whatever its text says.
 */
const NAME = String.raw`[@\w](?:[\w@/.-]*\w)?`;
const LIST = String.raw`\(([\w@/.\-, ]*)\)`;
// Captured, so the comment's column can be read off the row.
const COMMENT = String.raw`(\s+--\s.*)?\s*$`;
const ROOT = new RegExp(String.raw`^(${NAME})\s+${LIST}${COMMENT}`);
// At most two spaces in: a connector indented further is a nested child,
// which the grammar does not draw.
const ROW = new RegExp(String.raw`^\s{0,2}\|---\s+(${NAME})\s+${LIST}${COMMENT}`);
const DRAWING = /^[\s|^]*$/;
const GRAMMAR = "the root line (`name (no internal deps)`); rows (`|--- name (a, b)`, at most"
  + " two spaces in, package names separated by commas); either may end with ` -- comment`,"
  + " and the comment may wrap onto lines whose text starts in the column its first word"
  + " starts in, after an optional `|`; and drawing lines of `|` and `^`";

/** The column a row's comment text starts in, or null when it has none. */
function commentColumn(line, group) {
  if (group === undefined) return null;
  return line.length - group.length + /^\s+--\s+/.exec(group)[0].length;
}

function graphLines(claudeMd) {
  // CRLF too: `.` stops at `\r`, so a Windows checkout would refuse every
  // comment line of a correct block.
  const lines = claudeMd.split(/\r?\n/);
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
  const out = [];
  const body = lines.slice(open + 1, close);
  const first = body.findIndex((l) => l.trim() !== "");
  const listed = (name, list) => ({
    name,
    deps: list.trim() === "no internal deps"
      ? []
      : list.split(",").map((x) => x.trim()).filter(Boolean),
  });
  // The column the open comment wraps at, or null when none is open.
  let wrap = null;
  for (const [i, line] of body.entries()) {
    if (i === first) {
      const m = ROOT.exec(line);
      if (!m) {
        throw new Error(
          `the graph block must open with the root line, not "${line.trim()}"; it allows ${GRAMMAR}`,
        );
      }
      out.push(listed(m[1], m[2]));
      wrap = commentColumn(line, m[3]);
      continue;
    }
    const m = ROW.exec(line);
    if (m) {
      out.push(listed(m[1], m[2]));
      wrap = commentColumn(line, m[3]);
      continue;
    }
    const indent = /^(\s*\|?\s+)\S/.exec(line)?.[1].length;
    // A null wrap never equals an indent, so no comment is open then.
    if (indent === wrap) continue;
    wrap = null;
    if (DRAWING.test(line)) continue;
    throw new Error(
      `the graph block line "${line.trim()}" is not one the grammar allows: ${GRAMMAR}`,
    );
  }
  if (out.length === 0) throw new Error("the Dependency Graph block names no package");
  return out;
}

let intended, drawnLines, manifests;
try {
  // Inside the refusal: a bare `--root` throws, and that is "could not
  // answer", not the exit 1 a real disagreement uses.
  const root = resolve(
    opt("--root") ?? join(dirname(fileURLToPath(import.meta.url)), "..", ".."),
  );
  const intendedPath = join(root, "barwise", "scripts", "lib", "intended.cjs");
  intended = createRequire(import.meta.url)(intendedPath);
  const shape = isMap(intended) && Object.keys(intended).length > 0
    && Object.values(intended).every(
      (v) => Array.isArray(v) && v.every((d) => typeof d === "string"),
    );
  if (!shape) {
    throw new Error(`${intendedPath} does not export a map of package to package list`);
  }
  const pkgs = join(root, "barwise", "packages");
  manifests = readdirSync(pkgs, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => [e.name, join(pkgs, e.name, "package.json")])
    // A directory without a manifest (a stray build folder) is not a package.
    .filter(([, p]) => existsSync(p))
    .map(([dir, p]) => {
      let json;
      try {
        json = JSON.parse(readFileSync(p, "utf8"));
      } catch (err) {
        throw new Error(`${p}: ${err.message}`);
      }
      // A manifest that parses to the wrong shape is unreadable too: read
      // on, it would crash with exit 1 or skip an array-form field whose
      // keys are indices.
      const fieldsOk = RUNTIME.every((f) => json?.[f] === undefined || isMap(json[f]));
      if (!isMap(json) || typeof json.name !== "string" || !fieldsOk) {
        throw new Error(
          `${p}: not an object with a string name and object-valued ${RUNTIME.join(", ")}`,
        );
      }
      return { dir, json };
    });
  if (manifests.length === 0) throw new Error(`no package.json under ${pkgs}`);
  // Two manifests with one name would map it to whichever was read last,
  // and every message after that would blame the wrong directory.
  const names = manifests.map((m) => m.json.name);
  const clash = repeated(names);
  if (clash.length > 0) throw new Error(`two package manifests are named ${clash.join(", ")}`);
  drawnLines = graphLines(readFileSync(join(root, "CLAUDE.md"), "utf8"));
} catch (err) {
  console.error(`check:architecture: cannot answer -- ${err.message}`);
  process.exit(2);
}

// Own keys only: `in` would accept `constructor` or `toString` as a package.
const has = (p) => Object.hasOwn(intended, p);
const dirOf = new Map(manifests.map((m) => [m.json.name, m.dir]));

const problems = [];
const drawn = new Map();
for (const { name, deps } of drawnLines) {
  // A directory name is its own key; an unknown name stays as written, so
  // it is reported, not dropped.
  const pkg = dirOf.get(name) ?? name;
  // The first listing stands; merging the second in would invent edge
  // disagreements beside the real one.
  if (drawn.has(pkg)) {
    problems.push(`CLAUDE.md lists ${pkg} twice`);
    continue;
  }
  // Either vocabulary inside the list (`core` or `@barwise/core`), mapped
  // before the duplicate check so one edge spelled both ways is caught.
  const targets = deps.map((x) => dirOf.get(x) ?? x);
  for (const d of repeated(targets)) problems.push(`CLAUDE.md lists ${pkg} -> ${d} twice`);
  drawn.set(pkg, targets);
}
for (const [p, ds] of Object.entries(intended)) {
  for (const d of repeated(ds)) problems.push(`INTENDED lists ${p} -> ${d} twice`);
}

const edgeSet = (m) => new Set([...m].flatMap(([p, ds]) => ds.map((d) => `${p} -> ${d}`)));
const drawnEdges = edgeSet(drawn);
const allowed = edgeSet(Object.entries(intended));
for (const e of drawnEdges) {
  if (!allowed.has(e)) problems.push(`CLAUDE.md draws ${e}, INTENDED does not`);
}
for (const e of allowed) {
  if (!drawnEdges.has(e)) problems.push(`INTENDED has ${e}, CLAUDE.md does not`);
}
for (const p of Object.keys(intended)) {
  if (!drawn.has(p)) problems.push(`CLAUDE.md does not list ${p}`);
}
for (const p of drawn.keys()) {
  if (!has(p)) problems.push(`CLAUDE.md lists ${p}, INTENDED does not`);
}
// INTENDED and the picture agreeing is not enough: a deleted or misspelled
// package would pass in both. Every key is a package with a manifest, and
// every target is another key -- depcruise's group would silently drop a
// misspelled one, and a self-edge means nothing.
const dirs = new Set(manifests.map((m) => m.dir));
for (const [p, ds] of Object.entries(intended)) {
  if (!dirs.has(p)) problems.push(`INTENDED has ${p}, which is not a package under packages/`);
  for (const d of ds) {
    if (d === p) problems.push(`INTENDED has ${p} -> ${p}, a self-edge`);
    else if (!has(d)) problems.push(`INTENDED has ${p} -> ${d}, and ${d} is not a key`);
  }
}

for (const { dir, json } of manifests) {
  if (!has(dir)) {
    problems.push(`packages/${dir}: not in INTENDED`);
    continue;
  }
  for (const field of RUNTIME) {
    for (const dep of Object.keys(json[field] ?? {})) {
      const target = dirOf.get(dep);
      if (target !== undefined && !intended[dir].includes(target)) {
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
  `check:architecture: ${drawnEdges.size} edges in CLAUDE.md and ${manifests.length} package`
    + " manifests agree with INTENDED. OK",
);
