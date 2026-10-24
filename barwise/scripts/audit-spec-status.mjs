#!/usr/bin/env node
/**
 * A spec that says nothing has been built must not be sitting on top of
 * commits that built it.
 *
 * `must-validate-outside-the-rubric.spec.md` read "Draft for review
 * (design only -- no implementation in this PR)" while two of its three
 * workstreams were merged, and hid an undone third in the same breath.
 * `duplication-drift-guards.spec.md` still says it, though CLAUDE.md
 * cites its ratchet as landed and running in CI. Nothing reads a spec
 * header back, so the claim decays the moment the first workstream
 * ships and stays wrong for whoever reads it next (barwise-910).
 *
 * WHAT THIS CHECKS, precisely: for a spec whose Status claims no
 * implementation, whether any commit has touched the source files that
 * spec itself names, since the spec file was last edited. That is a
 * proxy, and the honest description of it is "the spec's own subject
 * moved and the spec did not". It cannot tell that a workstream shipped;
 * it can tell that the claim is no longer safe to believe.
 *
 * WHAT WAS TRIED AND REJECTED, so nobody re-derives it (all measured
 * against real history):
 *   - "Status is Draft while the tracking issue is closed": does not
 *     fire on the instance that prompted this. barwise-902 was still
 *     open, correctly, because its workstream 3 was undone.
 *   - "any commit mentioning the tracking issue": fires on context
 *     mentions -- barwise-902 is named in the bodies of commits about
 *     barwise-901 and barwise-904.
 *   - "a commit shipping a workstream must touch its spec", keyed on
 *     subject lines to control that noise: vacuous. 074ddb1 shipped
 *     workstream 2 of barwise-902 and names no issue in its subject.
 * This one fires at 7fbbba7 and 074ddb1, the two commits that made the
 * header false.
 *
 * `--check` ratchets against spec-status-baseline.json and fails BOTH
 * on a new unclassified spec and on a stale row, so the baseline always
 * enumerates exactly what is outstanding.
 *
 * `--survey` answers the neighbouring question the gate deliberately
 * does NOT: of the specs claiming PARTIAL implementation, which ones can
 * have that claim settled cheaply. It reports rather than fails, and it
 * lives here rather than in a second script so that "how a spec header
 * is read" keeps one owner -- a parallel parser would be the must-agree
 * copy this repo has a rule about. See barwise-912 for what it is for:
 * a spec whose Tracking names its workstream issues has a Status that is
 * DERIVABLE from the beads store instead of hand-written.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { mergeBaselineRows, mergeSummary, readExistingRows } from "./lib/baseline-merge.mjs";
import {
  CODE,
  entryPaths,
  header,
  HUB,
  inSpecCorpus,
  isWiring,
  namedPaths,
  touches,
} from "./lib/spec-reader.mjs";
import {
  noteUntrackedInput,
  refuseUntrackedInput,
  REPO_ROOT,
  trackedFiles,
} from "./lib/tracked.mjs";

/**
 * `--at <commit>` runs the same audit against a historical tree. It is
 * how this gate proves it would have caught the defect it was written
 * for -- see scripts/tests/gates.test.mjs, which asserts it fires at
 * 7fbbba7. Mutating a Status on today's tree does NOT reproduce that
 * condition: the comparison is against the commit that last touched the
 * spec, and every spec here has been edited since its implementation
 * landed, so on HEAD there is nothing "since".
 */
const atIndex = process.argv.indexOf("--at");
const AT = atIndex === -1 ? undefined : process.argv[atIndex + 1];

const SPEC_DIR = "barwise/docs/specs/";
const BASELINE = resolve(REPO_ROOT, "barwise/spec-status-baseline.json");

/**
 * The shape of Status that claims nothing exists yet.
 *
 * Two alternatives, because the same claim appears in two positions. The
 * anchored one is the common case (`Draft ...`, `Proposed ...`). The
 * unanchored phrase catches it mid-line: `conformance-property.spec.md`
 * reads "Accepted (all decisions resolved 2026-08-25; both workstreams
 * open -- design only, no implementation in this PR)", which asserts
 * exactly what an anchored `Draft` does and escaped this gate purely on
 * where its author put it.
 *
 * This is NOT the widening to partial specs that barwise-912 warns
 * against. That would mean inferring from "workstreams 1 and 2
 * implemented" which ones actually shipped, which no header can settle.
 * This is the identical claim -- nothing was built -- matched wherever
 * it sits. "No workstream implemented" is the same claim in the words
 * two specs used on 2026-09-06, and both sat outside the gate for a
 * whole workstream of commits until the first PR to land one noticed
 * (#426, session review); the gate test plants that exact phrasing.
 */
const CLAIMS_NOTHING_BUILT =
  /^\s*(draft|proposed|design only)\b|\bno (implementation|workstreams? implemented)\b/i;

/** A Status that claims some workstreams landed and others did not. */
const TERMINAL = /^\s*(implemented|complete|shipped)\b/i;

function git(...args) {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

/**
 * This gate reads history, so a shallow clone makes it answer a smaller
 * question and print OK for it -- which is how it shipped red: 309
 * commits locally against CI's full history, so the local run reported
 * zero findings and CI reported one. A gate that under-reports silently
 * is the barwise-905/906 defect in a new coordinate, so refuse rather
 * than reassure. CI checks out with `fetch-depth: 0`; a working copy
 * needs `git fetch --unshallow` once.
 *
 * Exit 2, not 1. This word "refusing" was already in the message while
 * the code exited 1, which is this gate's code for "a spec's header is
 * wrong" -- so a shallow clone said the specs were bad rather than that
 * the history was short, and the reader went looking for a spec to fix.
 * `scripts/fault-matrix.mjs` found it by shimming
 * `rev-parse --is-shallow-repository` to true and reading the code
 * (docs/specs/gate-refusal-contract.spec.md, WS3).
 */
function requireFullHistory() {
  if (git("rev-parse", "--is-shallow-repository") !== "true") return;
  console.error(
    "audit-spec-status: this is a shallow clone, so `git log` cannot see far\n"
      + "  enough back to answer whether a spec's subject moved after it was\n"
      + "  written. Refusing rather than reporting a smaller question's answer.\n"
      + "  Fix: git fetch --unshallow",
  );
  process.exit(2);
}

function exists(path) {
  try {
    if (AT === undefined) {
      execFileSync("git", ["ls-files", "--error-unmatch", path], {
        cwd: REPO_ROOT,
        stdio: "ignore",
      });
    } else {
      execFileSync("git", ["cat-file", "-e", `${AT}:${path}`], {
        cwd: REPO_ROOT,
        stdio: "ignore",
      });
    }
    return true;
  } catch {
    return false;
  }
}

/** Every tracked path, in the working tree or at `--at`; read once. */
let listing;
function allFiles() {
  listing ??= AT === undefined
    ? trackedFiles()
    : git("ls-tree", "-r", "--name-only", AT).split("\n");
  return listing;
}

/** Every tracked spec path, in the working tree or at `--at`. */
function specFiles() {
  return allFiles().filter(IN_CORPUS);
}

/**
 * What this audit reads: specs, archived ones excepted. One rule for the
 * corpus and for the untracked files it reports or refuses, shared with
 * check:spec-touches through the reader.
 */
const IN_CORPUS = inSpecCorpus;

const readSpec = (file) =>
  AT === undefined ? readFileSync(resolve(REPO_ROOT, file), "utf8") : git("show", `${AT}:${file}`);

/**
 * Commits in `found` that `recorded` does not contain. By prefix, because
 * both are abbreviations and git lengthens them as a repository grows, so
 * the same commit can be recorded in 8 characters and found in 9.
 */
function unseenCommits(found, recorded = []) {
  return found.filter((c) => !recorded.some((r) => c.startsWith(r) || r.startsWith(c)));
}

/**
 * The paths whose commits say a spec was implemented. A `Touches:` header
 * is the spec's own declaration and replaces inference: a path cited as
 * context (`ci.yml`, a gate's test) is no longer read as the subject
 * (plan-scope-check.spec.md). From it the audit drops shared wiring,
 * non-code files and barrels, as it always has for inferred paths. A
 * directory entry stays (git log takes a directory), and a pattern is
 * expanded against the tracked files by the same matcher
 * check:spec-touches validates it with, so the two read one language.
 * Without the header, the paths the spec names, as before.
 */
function subjectPaths(text) {
  const declared = touches(text);
  if (declared === undefined) return namedPaths(text, exists);
  return declared
    .flatMap((e) => entryPaths(e.path, allFiles()))
    .filter((p) => !isWiring(p) && (p.endsWith("/") || (CODE.test(p) && !HUB.test(p))));
}

/** Specs claiming nothing is built, with the commits that say otherwise. */
function findings() {
  const found = [];
  const head = AT ?? "HEAD";
  for (const file of specFiles()) {
    const text = readSpec(file);
    const status = header(text, "Status");
    if (status === undefined || !CLAIMS_NOTHING_BUILT.test(status)) continue;

    const paths = subjectPaths(text);
    if (paths.length === 0) continue;
    const specCommit = git("log", "-1", "--format=%H", head, "--", file);
    if (!specCommit) continue; // never committed; nothing to be stale against

    const since = git("log", "--format=%h %s", `${specCommit}..${head}`, "--", ...paths)
      .split("\n").filter(Boolean);
    if (since.length === 0) continue;

    found.push({
      id: file.slice(SPEC_DIR.length),
      status,
      commits: since.map((c) => c.split(" ")[0]),
    });
  }
  return found.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Issue ids a spec's Tracking line names, with their state. Tracking is
 * free text -- it mixes issue ids, sibling specs and review documents --
 * so this takes every id the beads store actually knows.
 */
function trackedIssues(text) {
  const store = new Map();
  for (const line of readFileSync(resolve(REPO_ROOT, ".beads/issues.jsonl"), "utf8").split("\n")) {
    if (!line.trim()) continue;
    const issue = JSON.parse(line);
    if (issue.id) store.set(issue.id, issue.status);
  }
  const tracking = header(text, "Tracking") ?? "";
  const ids = [...new Set([...tracking.matchAll(/\bbarwise-[a-z0-9]+\b/g)].map((m) => m[0]))]
    .filter((id) => store.has(id));
  return { ids, open: ids.filter((id) => store.get(id) !== "closed") };
}

/**
 * The specs claiming partial implementation, ranked by how cheaply the
 * claim can be settled. The ranking is the point: it separates the three
 * that a reader can confirm from the store from the thirteen that need
 * the code read workstream by workstream, so the work can be sized
 * before it is started rather than after.
 */
function survey() {
  const CLASSES = [
    "A  settled from the store: every named issue is closed",
    "B  settled from the store: named issues cover the workstreams, some open",
    "C  partly settled: fewer issues named than the spec has workstreams",
    "D  nothing named: needs artifact-level verification, per workstream",
  ];
  const rows = [];
  for (const file of specFiles()) {
    const text = readSpec(file);
    const status = header(text, "Status") ?? "<none>";
    if (TERMINAL.test(status) || CLAIMS_NOTHING_BUILT.test(status)) continue;

    const workstreams = [...text.matchAll(/^### (\d+)\.\s+(.+)$/gm)].length;
    const { ids, open } = trackedIssues(text);
    const notes = /^## Implementation notes/m.test(text);
    const cls = ids.length === 0
      ? 3
      : ids.length < workstreams
      ? 2
      : open.length > 0
      ? 1
      : 0;
    rows.push({ id: file.slice(SPEC_DIR.length), workstreams, ids, open, notes, cls });
  }
  rows.sort((a, b) => a.cls - b.cls || a.id.localeCompare(b.id));

  let last = -1;
  for (const r of rows) {
    if (r.cls !== last) {
      console.log(`\n${CLASSES[r.cls]}\n${"-".repeat(70)}`);
      last = r.cls;
    }
    const bits = [`${r.workstreams} workstream(s)`, `${r.ids.length} issue(s)`];
    if (r.open.length > 0) bits.push(`${r.open.length} open: ${r.open.join(", ")}`);
    if (r.notes) bits.push("has Implementation notes");
    console.log(`  ${r.id}\n      ${bits.join(" | ")}`);
  }
  console.log(`\n${rows.length} spec(s) claiming partial implementation (barwise-912).`);
}

if (process.argv.includes("--survey")) {
  survey();
  process.exit(0);
}

requireFullHistory();

const found = findings();
const check = process.argv.includes("--check");

if (AT !== undefined && !check) {
  // `--at` is a read-only historical query; writing a baseline from an old
  // tree would overwrite the current one with the past.
  for (const f of found) {
    console.log(`${f.id}\n   Status: ${f.status}\n   since: ${f.commits.join(", ")}`);
  }
  if (found.length === 0) console.log(`audit-spec-status --at ${AT}: no findings`);
  process.exit(0);
}

// A bare invocation SURVEYS; only `--write` writes. It used to be the other
// way round: the write path was the `else` of `--check`, so plain
// `npm run audit:specs` -- the spelling a reader tries first to see what the
// gate says -- silently rewrote the baseline, stamping "TODO: classify" over
// every recorded note. That is a worse instance of barwise-1026's shape than
// the one filed, because the operator never asked to write anything. Nothing
// in the repository depended on the old default: every CI step and hook passes
// `--check`.
if (!check && !process.argv.includes("--write")) {
  console.log(
    `audit-spec-status: ${found.length} spec(s) claiming no implementation with commits since`,
  );
  for (const f of found) {
    console.log(`  ${f.id}\n    Status: ${f.status}\n    since: ${f.commits.join(", ")}`);
  }
  console.log("\nNothing written. `--write` updates the baseline, `--check` ratchets it.");
  process.exit(0);
}

if (!check) {
  // An untracked spec is invisible to trackedFiles(), so writing the baseline
  // here would freeze a corpus missing it: --check passes locally and fails
  // once the spec is committed. audit-corrections shipped exactly that
  // (barwise-1018, barwise-906's form). --check does not refuse -- its input is
  // the tracked corpus by definition. Rule shared with audit-corrections in
  // lib/tracked.mjs rather than copied, per duplication-drift-guards.
  refuseUntrackedInput({
    pathspec: "barwise/docs/specs",
    suffix: ".spec.md",
    include: IN_CORPUS,
    gate: "audit-spec-status",
  });

  const fresh = Object.fromEntries(
    found.map((f) => [f.id, { status: f.status, commits: f.commits }]),
  );

  // Merged, not regenerated: the `note` is why a stale-looking header is
  // actually right, and rebuilding from the detector alone stamped the
  // placeholder over all six of them (barwise-1026).
  const existing = readExistingRows(BASELINE, "specs");
  const { rows: specs, ...counts } = mergeBaselineRows({
    fresh,
    existing,
    preserve: { note: "TODO: classify" },
  });
  // A verdict covers the commits it was written against, not ones that
  // landed since. Refreshing the list under the old note made four verdicts
  // read as covering commits nobody had looked at (barwise-qs8), so a row
  // that gains commits gets its note reopened, and --check stays red until
  // a person re-reads them and removes the TODO.
  // A row already reopened gains any newer commits in its TODO, so the
  // person who clears it re-reads everything the row will then claim.
  const REOPENED = /^TODO: re-read -- (.*?) landed since this verdict\. Previous note: ([\s\S]*)$/;
  const reopened = [];
  for (const [id, row] of Object.entries(specs)) {
    const prior = existing[id];
    if (!prior?.note || prior.note.startsWith("TODO: classify")) continue;
    const added = unseenCommits(row.commits, prior.commits);
    if (added.length === 0) continue;
    const open = REOPENED.exec(prior.note);
    const listed = open ? open[1].split(", ") : [];
    const verdict = open ? open[2] : prior.note;
    row.note = `TODO: re-read -- ${[...listed, ...added].join(", ")} landed since this verdict. `
      + `Previous note: ${verdict}`;
    reopened.push(`${id}: ${added.join(", ")}`);
  }

  const baseline = {
    $comment: "Specs whose Status claims no implementation while commits have landed on "
      + "the source files they name. Each row needs a note saying why the header "
      + "is still right, or what it should say instead. Ratcheted by "
      + "`npm run audit:specs -- --check` (scripts/audit-spec-status.mjs).",
    specs,
  };
  writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(
    `audit-spec-status: wrote ${found.length} row(s) to spec-status-baseline.json`
      + ` -- ${mergeSummary(counts)}`,
  );
  for (const id of counts.dropped) console.log(`  dropped (no longer stale): ${id}`);
  // Said here, not left for --check to find: a reopen rewrites a note.
  for (const r of reopened) console.log(`  reopened (re-read before --check passes): ${r}`);
  process.exit(0);
}

// --check from here. Its corpus is the tracked tree; name the specs it did
// not read, so an OK while one is being written does not claim to cover it.
noteUntrackedInput({
  pathspec: "barwise/docs/specs",
  suffix: ".spec.md",
  include: IN_CORPUS,
  gate: "audit-spec-status",
});

const baseline = JSON.parse(readFileSync(BASELINE, "utf8")).specs;
const failures = [];
const seen = new Set();
// Reported, never failed on. A commit that touches a file a Draft spec
// names is a shadow of implementation, not the thing: failing on it made
// every change to a named file red (merge commits included, which no
// baseline can record) until a note was rewritten. The hole barwise-qs8
// found -- a refresh crediting a verdict with commits nobody read -- is
// closed on the write side instead: --write reopens the note.
const unreviewed = [];

for (const f of found) {
  seen.add(f.id);
  const row = baseline[f.id];
  if (!row) {
    failures.push(
      `NEW: ${f.id}\n     Status: "${f.status}"\n`
        + `     but ${f.commits.length} commit(s) touched what it names since it was last edited: `
        + `${f.commits.join(", ")}\n`
        + `     Update the Status to say what shipped, or add a row to `
        + `spec-status-baseline.json saying why it is still right.`,
    );
  } else if (!row.note || row.note.startsWith("TODO")) {
    failures.push(
      row.note?.startsWith("TODO: re-read")
        ? `UNCLASSIFIED: ${f.id} -- reopened: ${row.note.split(" Previous note:")[0]}`
        : `UNCLASSIFIED: ${f.id} -- its baseline row has no note.`,
    );
  } else {
    const added = unseenCommits(f.commits, row.commits);
    if (added.length > 0) unreviewed.push(`${f.id}: ${added.join(", ")}`);
  }
}
for (const id of Object.keys(baseline)) {
  if (!seen.has(id)) {
    failures.push(
      `STALE baseline row: ${id} no longer claims to be unimplemented, or nothing `
        + `has touched what it names. Remove the entry.`,
    );
  }
}

if (failures.length > 0) {
  console.error("spec-status audit:\n");
  for (const f of failures) console.error(`  ${f}\n`);
  console.error(`${failures.length} failure(s).`);
  process.exit(1);
}
console.log(
  `audit-spec-status --check: ${found.length} spec(s) claiming no implementation, all classified. OK`,
);
if (unreviewed.length > 0) {
  console.log(
    `  ${unreviewed.length} verdict(s) predate commits that touched what their spec names; `
      + "`--write` records them and reopens the note for a re-read:",
  );
  for (const u of unreviewed) console.log(`    ${u}`);
}
