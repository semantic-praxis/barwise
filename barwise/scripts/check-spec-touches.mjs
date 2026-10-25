#!/usr/bin/env node
/**
 * Every unmarked `Touches:` entry in a spec names something tracked
 * (docs/specs/plan-scope-check.spec.md, WS2).
 *
 * `Touches:` is a spec's declared plan: the paths it will change. A
 * declaration nothing checks rots the way a review-tiers glob did --
 * `llm/src/prompts/builtins.generated.ts` named a file that had moved,
 * and routed nothing for five weeks (barwise-fs0). So an unmarked entry
 * must be a tracked file, a tracked directory (`x/`), or a pattern that
 * matches a tracked path. `+path` is a file the plan creates and may be
 * absent; `-path` one it deletes and may already be gone. Without the
 * marks this gate would fail on main for every Draft spec that plans a
 * new file, because on main there is no branch that adds it.
 *
 * NEW SPECS DECLARE IT (docs/specs/touches-required.spec.md). A spec
 * without `Touches:` is outside check:plan-review entirely, and that gate
 * prints OK over it: 140 of the 146 merges in plan-scope-check's WS6 reach
 * population named only such specs. So a corpus spec whose file name
 * appears nowhere under barwise/docs/specs/ (corpus or archive/) in the
 * tree of the cutoff commit, `TOUCHES_REQUIRED_SINCE` in
 * lib/spec-reader.mjs, fails unless its `Touches:` has an entry standing
 * for a path outside barwise/docs/specs/: an unmarked entry, expanded
 * against the tracked tree, or a `-` entry naming a path tracked at the
 * cutoff, now, or at any commit between (`newSpecVerdict`). By file name,
 * not path: a spec moved into or out of
 * archive/ is the existing spec the owner exempted, and a rename to a new
 * name reads as new (Open decision 2). An empty `Touches:` is left to the
 * tree rule's own finding, so it is reported once.
 *
 * The specs are the ones the tree rule reads -- tracked paths, read from
 * the working tree -- so a committed, staged or unstaged edit is judged
 * alike, and an untracked spec is named as unchecked by both rules. The
 * cutoff is fixed, not a per-change base: no BASE_SHA, no before-SHA, no
 * fetch, and nothing that a moving base could absorb and exempt.
 *
 * Exit 0 every entry resolves and every new spec declares a tracked path,
 * 1 one does not (named), 2 the tracked-file list could not be read or
 * came back empty, a spec could not be read, or the new-spec rule could
 * not run: the cutoff is not in this clone (a shallow clone, usually, and
 * the message says which fix applies), `--cutoff` names no single commit,
 * or git failed (no fetch advice: fetching would not mend it). Git
 * readings come from lib/git-run.mjs, shared with check:plan-review. When
 * the tree rule has findings and the new-spec rule
 * cannot run, the findings are printed first and the exit is 1: the
 * change fails whatever the new-spec rule would have said.
 *
 * `--tracked <file>` and `--specs <dir>` override the inputs for this
 * gate's own tests; under them the new-spec rule is not applied, and the
 * OK line says so, and that a `--cutoff` given with them was ignored.
 * `--cutoff <rev>` stands in for the cutoff, for the
 * gate's tests and for replaying the rule over history; nothing in CI
 * passes it.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { opt } from "./lib/args.mjs";
import { gitAt } from "./lib/git-run.mjs";
import { matchesPattern, patternFault } from "./lib/review-tiers.mjs";
import {
  inSpecCorpus,
  newSpecVerdict,
  SPECS_DIR,
  touches,
  TOUCHES_REQUIRED_SINCE,
} from "./lib/spec-reader.mjs";

const fileName = (p) => p.slice(p.lastIndexOf("/") + 1);
const nulList = (out) => out.split("\u0000").filter(Boolean);

/**
 * The corpus specs new since the cutoff, each with the rule's verdict on
 * the entries the tree rule already read. Throws, never exits, so the
 * caller decides how a refusal sits beside the tree rule's findings.
 */
function newSpecs(root, specs, current) {
  const git = gitAt(root);
  const given = opt("--cutoff");
  const cutoff = given ?? TOUCHES_REQUIRED_SINCE;
  // undefined is "no such commit" (exit 1); git failing throws from
  // commit() with its own message, and gets no fetch advice: fetching
  // would not mend it.
  const id = git.commit(cutoff);
  if (id === undefined) {
    // A shallow clone can lack any commit, so it is named either way; a
    // `--cutoff` in a full clone is a bad revision, which no fetch mends.
    const shallow = git.run(["rev-parse", "--is-shallow-repository"]).trim() === "true";
    const what = given !== null
      ? `--cutoff ${given} names no single commit in this clone (unknown, or an ambiguous abbreviation).`
      : `the cutoff ${cutoff} is not in this clone, so which specs are new cannot be read.`;
    const fix = shallow
      ? "\n  This clone is shallow. Fix: git fetch --unshallow"
      : given === null
      ? "\n  Fix: git fetch origin main"
      : "";
    throw new Error(what + fix);
  }
  const atCutoff = nulList(git.run(["ls-tree", "-r", "-z", "--name-only", id]));
  if (atCutoff.length === 0) throw new Error(`git listed no files at the cutoff ${cutoff}`);
  const existing = new Set(atCutoff.filter((f) => f.startsWith(SPECS_DIR)).map(fileName));
  const fresh = specs.filter((s) => !existing.has(fileName(s.id)));
  // What a `-` entry may name: a path tracked at the cutoff, in the current
  // tree, or at any commit between. The cutoff alone ages: a file created
  // after it and deleted by the plan could never satisfy a `-` entry, and
  // the same entry left unmarked fails the tree rule once the deletion
  // lands. Read only when a new spec has a `-` entry.
  let known = null;
  const knownPaths = () => {
    if (known === null) {
      const between = git.run([
        "log",
        "--format=",
        "--name-only",
        "-z",
        "--no-renames",
        `${id}..HEAD`,
      ]);
      known = [...new Set([...atCutoff, ...current, ...nulList(between.replace(/\n/g, "\u0000"))])];
    }
    return known;
  };
  return {
    cutoff,
    specs: fresh.map((s) => ({
      path: s.id,
      verdict: newSpecVerdict(
        s.entries,
        current,
        s.entries?.some((e) => e.mark === "-") ? knownPaths() : [],
      ),
    })),
  };
}

// Every input is read inside the refusal: an unreadable spec is "could
// not answer" (exit 2), never a crash that exits 1 like a real finding.
let tracked, specs, lib;
try {
  const list = opt("--tracked");
  const dir = opt("--specs");
  // The fixture overrides go together: --tracked alone would read specs
  // from a repository root it has no way to know.
  if ((list === null) !== (dir === null)) {
    throw new Error("--tracked and --specs are given together");
  }
  // Imported only without --tracked: lib/tracked.mjs resolves the repo
  // root at import and refuses outside one, which is where fixtures run.
  lib = list ? null : await import("./lib/tracked.mjs");
  tracked = list ? readFileSync(list, "utf8").split("\n").filter(Boolean) : lib.trackedFiles();
  if (tracked.length === 0) throw new Error("the tracked-file list is empty");
  const paths = dir
    ? readdirSync(dir).filter((f) => f.endsWith(".spec.md")).map((f) => [f, join(dir, f)])
    : tracked.filter(inSpecCorpus).map((f) => [f, join(lib.REPO_ROOT, f)]);
  specs = paths.map(([id, path]) => ({ id, entries: touches(readFileSync(path, "utf8")) }));
  // A spec being written is not yet tracked; say it was not read, so OK
  // does not claim to cover it (the audit does the same).
  if (lib) {
    lib.noteUntrackedInput({
      pathspec: "barwise/docs/specs",
      suffix: ".spec.md",
      include: inSpecCorpus,
      gate: "check:spec-touches",
    });
  }
} catch (err) {
  console.error(`check:spec-touches: cannot answer -- ${err.message}`);
  if (err.cause) console.error(`  cause: ${err.cause.message}`);
  process.exit(2);
}

const files = new Set(tracked);
const dirs = new Set();
for (const f of tracked) {
  const parts = f.split("/");
  for (let i = 1; i < parts.length; i++) dirs.add(`${parts.slice(0, i).join("/")}/`);
}
/**
 * Patterns are review-tiers' language, the one the audit expands them
 * with: `*` is a whole segment, so `scripts/*.mjs` is a fault, not a
 * glob that this gate and git would read differently.
 */
function problem(path) {
  if (path.includes("*")) {
    const fault = patternFault(path);
    if (fault) return fault;
    return tracked.some((f) => matchesPattern(f, path)) ? null : "matches nothing tracked";
  }
  if (path.endsWith("/")) return dirs.has(path) ? null : "names no tracked directory";
  return files.has(path) ? null : "names nothing tracked";
}

const dead = [];
let declaring = 0;
for (const spec of specs) {
  if (spec.entries === undefined) continue;
  declaring += 1;
  if (spec.entries.length === 0) {
    // An empty declaration is not "touches nothing": the audit would have
    // no subject and skip the spec silently.
    dead.push(`${spec.id}: Touches: has no entries`);
    continue;
  }
  for (const e of spec.entries) {
    if (e.path === "") {
      dead.push(`${spec.id}: an empty entry`);
      continue;
    }
    const why = e.mark === ""
      ? problem(e.path)
      : e.path.includes("*")
      ? patternFault(e.path)
      : null;
    if (why) dead.push(`${spec.id}: ${e.mark}${e.path} -- ${why}`);
  }
}

// The new-spec rule runs after the tree rule, and its refusal is held
// until the tree rule's findings are printed: those are answers either way.
let fresh = null;
let cannot = null;
if (lib) {
  try {
    fresh = newSpecs(lib.REPO_ROOT, specs, tracked);
  } catch (err) {
    cannot = err.message;
  }
}
// An empty field ("empty") is the loop above's finding, so it is not
// reported twice; "satisfies" is the rule met.
const undeclared = (fresh?.specs ?? []).filter((s) =>
  s.verdict === "none" || s.verdict === "marked-only"
);

if (dead.length > 0) {
  console.error(
    `check:spec-touches: FAIL -- ${dead.length} Touches: entr${
      dead.length === 1 ? "y does" : "ies do"
    } not resolve:`,
  );
  for (const d of dead) console.error(`  ${d}`);
  console.error(
    "Fix the path, or mark it +path (the plan creates it) or -path (the plan deletes it).",
  );
}
if (undeclared.length > 0) {
  console.error(
    `check:spec-touches: FAIL -- ${undeclared.length} spec(s) new since the cutoff ${
      fresh.cutoff.slice(0, 8)
    } declare no tracked path:`,
  );
  for (const s of undeclared) {
    console.error(
      `  ${s.path}: ${
        s.verdict === "none"
          ? "new since the cutoff and declares no Touches:"
          : "new since the cutoff, and no Touches: entry names a tracked path outside barwise/docs/specs/"
      }`,
    );
  }
  console.error(
    "A new spec declares the paths its plan changes: at least one entry standing for a path\n"
      + "outside barwise/docs/specs/ -- unmarked, or a -path tracked at or since the cutoff;\n"
      + "+path entries alone do not count.\n"
      + "A spec whose file name was under barwise/docs/specs/ at the cutoff is exempt\n"
      + "(docs/specs/touches-required.spec.md).",
  );
}
if (cannot !== null) {
  console.error(`check:spec-touches: cannot answer for new specs -- ${cannot}`);
  if (dead.length === 0) {
    console.error("Refusing rather than reporting that every new spec declares Touches:.");
    process.exit(2);
  }
}
if (dead.length > 0 || undeclared.length > 0) process.exit(1);
const reach = fresh
  ? `${fresh.specs.length} spec(s) new since the cutoff ${
    fresh.cutoff.slice(0, 8)
  }, each declaring a tracked path`
  : `the new-spec rule was not applied (fixture overrides${
    process.argv.includes("--cutoff") ? "; --cutoff ignored" : ""
  })`;
console.log(
  `check:spec-touches: ${declaring} spec(s) declare Touches:, every entry resolves; ${reach}. OK`,
);
