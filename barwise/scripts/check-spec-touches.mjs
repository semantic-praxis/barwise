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
 * Exit 0 every entry resolves, 1 one does not (named), 2 the tracked-file
 * list could not be read or came back empty.
 *
 * `--tracked <file>` and `--specs <dir>` override the inputs for this
 * gate's own tests; nothing else passes them.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { opt } from "./lib/args.mjs";
import { matchesPattern, patternFault } from "./lib/review-tiers.mjs";
import { inSpecCorpus, touches } from "./lib/spec-reader.mjs";

// Every input is read inside the refusal: an unreadable spec is "could
// not answer" (exit 2), never a crash that exits 1 like a real finding.
let tracked, specs;
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
  const lib = list ? null : await import("./lib/tracked.mjs");
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
  process.exit(1);
}
console.log(`check:spec-touches: ${declaring} spec(s) declare Touches:, every entry resolves. OK`);
