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
 * It also checks the ADRs (WS2): each one's shape, and that every reference
 * to an ADR resolves -- see ADR_REF and citesAdrs below. Those inputs come
 * from the tracked listing, so the check needs git; no ADR at all is exit 2.
 *
 * And it checks each ADR's `Enforced-by:` declarations
 * (docs/specs/executable-adrs.spec.md): every ADR has the header, every
 * decision has an id and an entry, each gate entry names a step CI runs, and each `none` names an
 * open issue. Those inputs (barwise/package.json, ci.yml, the tracker) are
 * read only when an entry needs them; one that cannot be read is exit 2,
 * reported after the findings and never in place of them.
 *
 * `--root <dir>` reads CLAUDE.md, barwise/scripts/lib/intended.cjs,
 * barwise/packages/* and the tracked files of another git tree, for this
 * check's own tests; nothing else passes it.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decisionIds } from "./lib/adr-enforcement.mjs";
import { createGovernanceReader } from "./lib/adr-facts.mjs";
import { judgeDeclarations, needsWorkflow } from "./lib/adr-judge.mjs";
import {
  ADR_DIR,
  currentSection,
  isAdr,
  isMap,
  loadExternalDeps,
  loadIntended,
  readFiles,
  renderSection,
  trackedPaths,
} from "./lib/architecture-section.mjs";
import { opt } from "./lib/args.mjs";
import { uncommittedPaths } from "./lib/changed-class.mjs";
import { isInstructionFile } from "./lib/instruction-files.mjs";
import { header, inSpecCorpus, touches } from "./lib/spec-reader.mjs";

/**
 * Runtime dependency fields: each is installed and resolved when the
 * package runs, so a layering edge in any of them is one depcruise cannot
 * see. `devDependencies` alone is left out (see the header).
 */
const RUNTIME = ["dependencies", "peerDependencies", "optionalDependencies"];

/**
 * ADRs (WS2): one file per concern under `barwise/docs/adr/`, edited in
 * place, so a name is the whole identity of a decision and a dead name is
 * a decision an agent can no longer find. A reference takes one of the two
 * current forms; a number such as "ADR 0001" is neither, which is why the
 * dated records that still use numbers need no exemption.
 */
// One line break may sit between `ADR` and the name -- dprint reflows prose,
// and a reference split at the wrap would otherwise never be read -- with a
// quote or comment marker (`>`, `*`, `#`, `//`) after it, but not a blank
// line; and `ADR` is a whole word (not the tail of `MADR`).
const ADR_REF =
  /\bADR[ \t]*(?:\r?\n[ \t]*(?:[>*#]|\/\/)?[ \t]*)?`([a-z0-9][a-z0-9-]*)`|docs\/adr\/([a-z0-9][a-z0-9-]*)\.md/g;
/**
 * A citation of one decision: `<adr>.md#<id>`, with or without the
 * `docs/adr/` path (an ADR cites another ADR by bare file name). The id is
 * the decision's `{#id}`, so a retirement that renumbers an ADR cannot
 * leave the citation pointing at another decision, which a citation by
 * number would (docs/specs/adr-refactor.spec.md, Scope). A bare
 * `<name>.md#<fragment>` whose name is no ADR is some other document's
 * anchor and is not read, nor is a bare name after a `/` (a same-named file
 * in another directory), nor a fragment that is one of the ADR's heading
 * anchors (a link into its Context or Consequences).
 */
const DECISION_REF = /(docs\/adr\/)?\b([a-z0-9][a-z0-9-]*)\.md#([a-z0-9]+(?:-[a-z0-9]+)*)/g;
const SCOPES = ["architecture", "process"];
/**
 * The files whose ADR references are read: a named set, not "everything
 * but". Instruction files, the docs (specs included) and package files act
 * on a decision. History is left out, under the docs and the packages
 * alike -- the tracker, eval runs and payloads, archives and dated records
 * (a date in the path) -- because history may name
 * what no longer exists, and the old numbered forms are not read anyway.
 */
const DATED = /\d{4}-\d{2}-\d{2}/;
const HISTORY = /\/(archive|eval-runs|eval-payloads)\//;
const citesAdrs = (f) =>
  isInstructionFile(f)
  || (((f.startsWith("barwise/docs/") && f.endsWith(".md")) || f.startsWith("barwise/packages/"))
    && !HISTORY.test(f) && !DATED.test(f));

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
 * both ways (a lost row with a trailing note passed; `registry (x)` prose
 * was refused). Position settles it: a comment line's text starts right of
 * the column where its row's list opens. That column does not move when a
 * dependency is added, so the wraps under a row survive the commonest
 * edit, and a row that lost its connector starts at the row-name column,
 * left of it, and is refused whatever its text says. (An exact-column
 * rule was tried and refused the untouched wraps whenever a list grew.)
 */
const NAME = String.raw`[@\w](?:[\w@/.-]*\w)?`;
const LIST = String.raw`\(([\w@/.\-, ]*)\)`;
const COMMENT = String.raw`(\s+--\s.*)?\s*$`;
// The `d` flag gives the list's column; group 3 says whether a comment opened.
const ROOT = new RegExp(String.raw`^(${NAME})\s+${LIST}${COMMENT}`, "d");
// At most two spaces in: a connector indented further is a nested child,
// which the grammar does not draw.
const ROW = new RegExp(String.raw`^\s{0,2}\|---\s+(${NAME})\s+${LIST}${COMMENT}`, "d");
// The drawing characters; a line of nothing else is a drawing line.
const DRAWN = /^[\s|^]*/;
const GRAMMAR = "the root line (`name (no internal deps)`); rows (`|--- name (a, b)`, at most"
  + " two spaces in, package names separated by commas); either may end with ` -- comment`,"
  + " and the comment may wrap onto the lines below it, whose text starts right of the"
  + " column where that row's list opens, until a drawing line ends it; and drawing lines"
  + " of `|` and `^`. Columns count from 1, as an editor does";

/** What a root or row match leaves open: its name and list column, if it has a comment. */
const opened = (m) => (m[3] === undefined ? null : { name: m[1], at: m.indices[2][0] - 1 });

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
  // The comment the previous line opened or continued, or null.
  let comment = null;
  for (const [i, line] of body.entries()) {
    if (i === first) {
      const m = ROOT.exec(line);
      if (!m) {
        throw new Error(
          `the graph block must open with the root line, not "${line.trimEnd()}"; it allows ${GRAMMAR}`,
        );
      }
      out.push(listed(m[1], m[2]));
      comment = opened(m);
      continue;
    }
    const m = ROW.exec(line);
    if (m) {
      out.push(listed(m[1], m[2]));
      comment = opened(m);
      continue;
    }
    // Text starts after the drawing characters, so a wrap may sit beside `^`.
    const indent = DRAWN.exec(line)[0].length;
    const drawing = indent === line.length;
    if (comment !== null && !drawing && indent > comment.at) continue;
    const prev = comment;
    comment = null;
    if (drawing) continue;
    // The column hint only for a line meant as comment text: a malformed
    // row would otherwise be blamed on the previous row's comment.
    const under = prev === null || /[|+`\\^]-{2,}/.test(line)
      ? ""
      : `; a comment line under ${prev.name} must start right of column ${prev.at + 1}`
        + `, and this one starts at column ${indent + 1}`;
    throw new Error(
      `the graph block line "${line.trimEnd()}" is not one the grammar allows${under}: ${GRAMMAR}`,
    );
  }
  if (out.length === 0) throw new Error("the Dependency Graph block names no package");
  return out;
}

let intended, externalDeps, drawnLines, manifests, adrs, citing, scriptFiles, root, section;
try {
  // Inside the refusal: a bare `--root` throws, and that is "could not
  // answer", not the exit 1 a real disagreement uses.
  root = resolve(opt("--root") ?? join(dirname(fileURLToPath(import.meta.url)), "..", ".."));
  intended = loadIntended(root);
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
  externalDeps = loadExternalDeps(root);
  // Two manifests with one name would map it to whichever was read last,
  // and every message after that would blame the wrong directory.
  const names = manifests.map((m) => m.json.name);
  const clash = repeated(names);
  if (clash.length > 0) throw new Error(`two package manifests are named ${clash.join(", ")}`);
  drawnLines = graphLines(readFileSync(join(root, "CLAUDE.md"), "utf8"));
  // ADRs and the files that cite them both come from the tracked listing
  // (lib/architecture-section.mjs, which regen:architecture reads too). An
  // ADR on disk but not yet staged is named as unchecked, not silently counted.
  const tracked = trackedPaths(root);
  adrs = readFiles(root, tracked.filter(isAdr));
  // Zero ADRs is a listing that went wrong, not a tree with nothing to check.
  if (adrs.length === 0) throw new Error(`no ADR under ${join(root, ADR_DIR)}`);
  citing = readFiles(root, tracked.filter(citesAdrs));
  // Scripts cite ADR decisions in comments too; they are read for decision
  // citations only (adr-refactor review, 2026-11-06).
  scriptFiles = readFiles(
    root,
    tracked.filter((p) => p.startsWith("barwise/scripts/") && /\.(mjs|cjs|js|sh)$/.test(p)),
  );
  // The generated first section of ARCHITECTURE.md (WS3): its markers must
  // be there to compare, so their absence is "could not answer".
  const doc = readFileSync(join(root, "barwise", "docs", "ARCHITECTURE.md"), "utf8");
  section = currentSection(doc);
  if (section === null) throw new Error("ARCHITECTURE.md has no regen:architecture markers");
  // The shared listing of uncommitted paths (check:git-listing refuses a
  // hand-written one); those not tracked are the untracked ones.
  const inTree = new Set(tracked);
  for (const f of uncommittedPaths(root)) {
    if (isAdr(f) && !inTree.has(f)) console.log(`check:architecture: unchecked (untracked): ${f}`);
  }
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

// A listed package's external runtime dependencies are exactly its list
// (package-graph-authority#core-external-deps): one the list lacks is a
// dependency nobody decided on, and a listed one the manifest dropped is a
// list that no longer says what the package ships.
const manifestOf = new Map(manifests.map((m) => [m.dir, m.json]));
for (const [p, allowedExternal] of Object.entries(externalDeps)) {
  const json = manifestOf.get(p);
  if (json === undefined) {
    problems.push(`external-deps.cjs lists ${p}, which is not a package under packages/`);
    continue;
  }
  const declared = new Set();
  for (const field of RUNTIME) {
    for (const dep of Object.keys(json[field] ?? {})) {
      if (dirOf.has(dep)) continue;
      declared.add(dep);
      if (!allowedExternal.includes(dep)) {
        problems.push(`packages/${p}: ${field} has ${dep}, external-deps.cjs does not list it`);
      }
    }
  }
  for (const dep of allowedExternal) {
    if (!declared.has(dep)) {
      problems.push(`external-deps.cjs lists ${dep} for ${p}, which its manifest does not declare`);
    }
  }
}

// Each ADR's shape: the two header fields and the section the index
// reads. `Date:` is checked for form only; whether an edit changed the
// decision is a judgment for review (the spec, "Date:").
const adrProblems = [];
for (const { f, text } of adrs) {
  const scope = header(text, "Scope");
  if (scope === undefined) adrProblems.push(`${f}: no Scope: line`);
  else if (!SCOPES.includes(scope)) {
    adrProblems.push(`${f}: Scope: ${scope} is not one of ${SCOPES.join(", ")}`);
  }
  const date = header(text, "Date");
  if (date === undefined) adrProblems.push(`${f}: no Date: line`);
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    adrProblems.push(`${f}: Date: ${date || "(empty)"} is not YYYY-MM-DD`);
  }
  if (!/^## Decision\s*$/m.test(text)) adrProblems.push(`${f}: no "## Decision" section`);
  // The generated index lists an ADR by its title.
  if (!/^# \S/m.test(text)) adrProblems.push(`${f}: no "# " title line`);
}
// Every reference names an ADR that exists, or one the citing spec plans
// to create or retire in its Touches: (`+` or `-`), so a spec may name the
// ADR its own PR adds or deletes.
const adrNames = new Set(adrs.map((a) => a.f.slice(ADR_DIR.length, -".md".length)));
for (const { f, text } of citing) {
  const declared = new Set(
    (inSpecCorpus(f) ? touches(text) ?? [] : [])
      .filter((e) => e.mark !== "" && isAdr(e.path))
      .map((e) => e.path.slice(ADR_DIR.length, -".md".length)),
  );
  // Lines counted in one pass: matches arrive in order.
  let line = 1;
  let at = 0;
  for (const m of text.matchAll(ADR_REF)) {
    for (; at < m.index; at++) if (text[at] === "\n") line++;
    const name = m[1] ?? m[2];
    if (!adrNames.has(name) && !declared.has(name)) {
      adrProblems.push(`${f}:${line}: names ADR ${name}, and ${ADR_DIR}${name}.md does not exist`);
    }
  }
}

// Every decision citation names a decision its ADR has. A citation of an
// ADR not in the tree (one a spec plans, or one being deleted) is left to
// the reference loop above, which knows the Touches: exceptions.
const idsOf = new Map(
  adrs.map((a) => [
    a.f.slice(ADR_DIR.length, -".md".length),
    new Set(decisionIds(a.text).decisions.map((d) => d.id).filter((id) => id !== null)),
  ]),
);
// GitHub's heading anchors: lower-cased, punctuation dropped, spaces to
// hyphens. A fragment that is one is a link into the ADR, not a citation.
const slug = (h) => h.trim().toLowerCase().replace(/[^a-z0-9 -]/g, "").replace(/ /g, "-");
const headingsOf = new Map(
  adrs.map((a) => [
    a.f.slice(ADR_DIR.length, -".md".length),
    new Set([...a.text.matchAll(/^#{1,6} (.+)$/gm)].map((m) => slug(m[1]))),
  ]),
);
for (const { f, text } of [...citing, ...scriptFiles]) {
  let line = 1;
  let at = 0;
  for (const m of text.matchAll(DECISION_REF)) {
    for (; at < m.index; at++) if (text[at] === "\n") line++;
    const [, path, name, id] = m;
    const ids = idsOf.get(name);
    if (ids === undefined || headingsOf.get(name).has(id)) continue;
    if (path === undefined && text[m.index - 1] === "/") continue;
    if (!ids.has(id)) {
      adrProblems.push(
        `${f}:${line}: cites ${path ?? ""}${name}.md#${id}, and ${name} has no decision {#${id}}`,
      );
    }
  }
}

// Each ADR's `Enforced-by:` declarations (docs/specs/executable-adrs.spec.md,
// WS1). Every ADR carries the header since the backfill (WS3): one without it
// is a finding, so a new ADR cannot leave its decisions unaccounted for, and
// a decision with no enforcer says so as `none` on its own gap issue rather
// than by silence. `tests` entries are answered by
// `check:adr-tests` from the runners' reports, never from source text.
// Inputs are read only when an entry needs them, and an unreadable one is a
// refusal recorded here, so it never hides a finding from the passes above.
// The reads are scripts/lib/adr-facts.mjs and the rules
// scripts/lib/adr-judge.mjs (docs/specs/adr-gate-reader-split.spec.md):
// both push into this one refusal list, in the order the rules first ask.
const refusals = [];
// ci-occurrences.mjs needs the `yaml` package, so it is imported only when
// some ADR declares a gate: a tree with no such entry runs on builtins, as
// this check always has.
const reader = await createGovernanceReader(root, {
  needsWorkflow: needsWorkflow(adrs),
  refusals,
});
const { problems: enforcementProblems, held } = judgeDeclarations(adrs, reader, refusals);

// The generated section is rendered from these same inputs (the tracked
// ADRs and INTENDED), so a stale section is one regen:architecture fixes.
const stale = section !== renderSection(adrs, intended);

if (problems.length > 0) {
  console.error(`check:architecture: FAIL -- ${problems.length} disagreement(s) with INTENDED:`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    "INTENDED (barwise/scripts/lib/intended.cjs) is the authority: fix the copy, or change"
      + " INTENDED and every copy in the same commit.",
  );
}
if (adrProblems.length > 0) {
  console.error(`check:architecture: FAIL -- ${adrProblems.length} ADR problem(s):`);
  for (const p of adrProblems) console.error(`  ${p}`);
  console.error(
    "Fix the reference or the ADR (template: .claude/skills/spec-writer/template.adr.md);"
      + " a spec may name an ADR its PR creates or retires as a +/- barwise/docs/adr/<name>.md Touches: entry.",
  );
}
if (stale) {
  console.error(
    "check:architecture: FAIL -- the generated section of barwise/docs/ARCHITECTURE.md is stale"
      + " (an ADR or INTENDED changed); run npm run regen:architecture and commit the result.",
  );
}
if (enforcementProblems.length > 0) {
  console.error(
    `check:architecture: FAIL -- ${enforcementProblems.length} Enforced-by: problem(s):`,
  );
  for (const p of enforcementProblems) console.error(`  ${p}`);
  console.error(
    "Every decision needs an entry: a gate, tests (<ids>), or none (<gap issue>: <id>) on"
      + " the decision's own open gap issue, labelled adr-gap and titled"
      + ' "Gap: <adr> decision <id> ..." (docs/specs/executable-adrs.spec.md,'
      + " docs/specs/enforceable-adr-practice.spec.md).",
  );
}
if (refusals.length > 0) {
  console.error(`check:architecture: cannot answer for ${refusals.length} declaration(s):`);
  for (const r of refusals) console.error(`  ${r}`);
}
// Any finding is exit 1, and the refusals beside it are still listed above;
// refusals alone are exit 2 (docs/adr/gate-refusal-contract.md).
if (problems.length > 0 || adrProblems.length > 0 || stale || enforcementProblems.length > 0) {
  process.exit(1);
}
if (refusals.length > 0) process.exit(2);
console.log(
  `check:architecture: ${drawnEdges.size} edges in CLAUDE.md and ${manifests.length} package`
    + ` manifests agree with INTENDED; ${adrs.length} ADRs are well-formed and every reference`
    + ` in ${citing.length} files resolves; ${held.decisions} decisions: ${held.gate} with a gate,`
    + ` ${held.testsOnly} tests and no gate, ${held.noneOnly} none only; ${held.gap} carry a gap`
    + ` issue${
      // A decision with no entry is check:adr-model's to report (coverage):
      // named here, so this OK never reads as covering it.
      held.none > 0 ? `; ${held.none} with no entry, which check:adr-model reports` : ""}. OK`,
);
