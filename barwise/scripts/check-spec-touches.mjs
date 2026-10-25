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
 * population named only such specs. So a change that adds a spec whose
 * file name did not exist anywhere under barwise/docs/specs/ (corpus or
 * archive/) at the merge base fails unless its `Touches:`, read at HEAD,
 * has an unmarked entry or a `-` entry tracked at the merge base. `+`
 * entries alone do not count, so `Touches: +none` cannot pass. By file
 * name, not path: `--no-renames` reports an archive move as delete plus
 * add, and a moved spec is the existing spec the owner exempted; a rename
 * to a new name reads as new (Open decision 2). An empty `Touches:` is
 * left to the tree rule's own finding, so it is reported once.
 *
 * Base: `lib/pr-base.mjs` (`--base`, $BASE_SHA, origin/main), shared
 * with check:plan-review; the change is the three-dot `base...HEAD`.
 * ci.yml passes the pull request's base, or the push's before-SHA, so a
 * spec landed on main by direct push turns main red while it is still the
 * newest commit, instead of being exempt for every later branch.
 * `--head <rev>` stands in for HEAD in this rule only, to replay it over
 * merged history; nothing in CI passes it.
 *
 * Exit 0 every entry resolves and every new spec declares a tracked path,
 * 1 one does not (named), 2 the tracked-file list could not be read or
 * came back empty, or, for the new-spec rule, the base is the all-zero
 * SHA or does not resolve, the clone is shallow, or git failed.
 *
 * `--tracked <file>` and `--specs <dir>` override the inputs for this
 * gate's own tests; nothing else passes them. Under them the new-spec
 * rule is not applied, and the OK line says so.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { opt } from "./lib/args.mjs";
import { parseNameStatus } from "./lib/name-status.mjs";
import { resolveBase } from "./lib/pr-base.mjs";
import { matchesPattern, patternFault } from "./lib/review-tiers.mjs";
import { inSpecCorpus, newSpecVerdict, touches } from "./lib/spec-reader.mjs";

const SPECS = "barwise/docs/specs/";
const fileName = (p) => p.slice(p.lastIndexOf("/") + 1);

/**
 * The specs this change adds that are new by file name, each with the
 * rule's verdict on its `Touches:` at HEAD. Throws, never exits, so the
 * caller's refusal names the failure: a git that fails here is "could not
 * answer", and a new spec it could not see is not one that passed.
 */
function newSpecs(root) {
  const git = (args) => {
    try {
      return execFileSync("git", args, {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch (err) {
      const why = err.stderr?.toString().trim().split("\n")[0] || err.message.split("\n")[0];
      throw new Error(`\`git ${args.join(" ")}\` failed: ${why}`);
    }
  };
  const { base, source } = resolveBase();
  const head = opt("--head") ?? "HEAD";
  if (git(["rev-parse", "--is-shallow-repository"]).trim() !== "false") {
    throw new Error(
      "this is a shallow clone, so the merge base, and which specs are new\n"
        + "  since it, cannot be read. Fix: git fetch --unshallow",
    );
  }
  for (const [rev, what] of [[base, `the base (${source})`], [head, "--head"]]) {
    try {
      git(["rev-parse", "--verify", "--quiet", `${rev}^{commit}`]);
    } catch {
      throw new Error(`${what} ${rev} does not resolve to a commit in this clone`);
    }
  }
  const mergeBase = git(["merge-base", base, head]).trim();
  if (!mergeBase) throw new Error(`no merge base between ${base} and ${head}`);
  const added = parseNameStatus(
    git(["diff", "--name-status", "-z", "--no-renames", `${base}...${head}`, "--", SPECS]),
  ).filter((r) => r.letter === "A" && inSpecCorpus(r.path)).map((r) => r.path);
  const existing = new Set(
    git(["ls-tree", "-r", "-z", "--name-only", mergeBase, "--", SPECS]).split("\u0000")
      .filter(Boolean).map(fileName),
  );
  const heldAtBase = (path) => git(["ls-tree", "-z", "--name-only", mergeBase, "--", path]) !== "";
  const specs = added.filter((p) => !existing.has(fileName(p))).map((path) => {
    const verdict = newSpecVerdict(touches(git(["show", `${head}:${path}`])), heldAtBase);
    // The commit that added it, for the finding: on a stale origin/main it
    // may be someone else's, and the reader needs to see that.
    const commit = verdict === "none" || verdict === "marked-only"
      ? git([
        "log",
        "--no-renames",
        "--diff-filter=A",
        "--format=%h",
        "-n1",
        `${mergeBase}..${head}`,
        "--",
        path,
      ]).trim()
      : undefined;
    return { path, verdict, commit };
  });
  return { base, source, mergeBase, specs };
}

// Every input is read inside the refusal: an unreadable spec is "could
// not answer" (exit 2), never a crash that exits 1 like a real finding.
let tracked, specs, fresh;
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
    fresh = newSpecs(lib.REPO_ROOT);
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
    `check:spec-touches: FAIL -- ${undeclared.length} new spec(s) since ${fresh.base} (merge base ${
      fresh.mergeBase.slice(0, 8)
    }) declare no tracked path:`,
  );
  for (const s of undeclared) {
    const why = s.verdict === "none"
      ? "new in this change and declares no Touches:"
      : "new in this change, and no Touches: entry names a tracked path";
    console.error(`  ${s.path}: ${why} (added in ${s.commit || "an unknown commit"})`);
  }
  console.error(
    "A new spec declares the paths its plan changes: at least one unmarked entry, or a -path\n"
      + "tracked at the base; +path entries alone do not count. A spec whose file name existed\n"
      + "under barwise/docs/specs/ at the merge base is exempt (docs/specs/touches-required.spec.md).",
  );
  // CI passes the exact base; only the fallback can be stale, since
  // ci-local never fetches.
  if (fresh.source.startsWith("the default")) {
    console.error(
      "If a commit named above is not yours, origin/main may be stale: git fetch origin main, and rerun.",
    );
  }
}
if (dead.length > 0 || undeclared.length > 0) process.exit(1);
const reach = fresh
  ? `${fresh.specs.length} new spec(s) since ${fresh.base} (merge base ${
    fresh.mergeBase.slice(0, 8)
  }), each declaring a tracked path`
  : "the new-spec rule was not applied (fixture overrides)";
console.log(
  `check:spec-touches: ${declaring} spec(s) declare Touches:, every entry resolves; ${reach}. OK`,
);
