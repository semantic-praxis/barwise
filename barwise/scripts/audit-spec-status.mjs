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
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { REPO_ROOT, trackedFiles } from "./lib/tracked.mjs";

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

/** The shape of Status that claims nothing exists yet. */
const CLAIMS_NOTHING_BUILT = /^\s*(draft|proposed|design only)\b/i;

const CODE = /\.(ts|tsx|mjs|cjs|js|json|ya?ml|py|sh)$/;

/**
 * A package barrel is touched by every change to its package, so a spec
 * naming one fires on work that has nothing to do with it. Measured:
 * `core/src/index.ts` alone accounted for every false signal in the
 * prototype sweep. Excluding barrels is what keeps this a signal.
 */
const HUB = /(^|\/)(index|registration)\.ts$/;

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
 */
function requireFullHistory() {
  if (git("rev-parse", "--is-shallow-repository") !== "true") return;
  console.error(
    "audit-spec-status: this is a shallow clone, so `git log` cannot see far\n"
      + "  enough back to answer whether a spec's subject moved after it was\n"
      + "  written. Refusing rather than reporting a smaller question's answer.\n"
      + "  Fix: git fetch --unshallow",
  );
  process.exit(1);
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

/** Every tracked spec path, in the working tree or at `--at`. */
function specFiles() {
  const files = AT === undefined
    ? trackedFiles()
    : git("ls-tree", "-r", "--name-only", AT).split("\n");
  return files.filter((f) =>
    f.startsWith(SPEC_DIR) && f.endsWith(".spec.md") && !f.includes("/archive/")
  );
}

const readSpec = (file) =>
  AT === undefined ? readFileSync(resolve(REPO_ROOT, file), "utf8") : git("show", `${AT}:${file}`);

/**
 * Repo paths a spec names in backticks. Specs write them relative to
 * `barwise/`, to `barwise/packages/`, or from the repo root, so each
 * candidate is tried against all three and kept only if git knows it.
 */
function namedPaths(text) {
  const out = new Set();
  for (const m of text.matchAll(/`([^`\s]+\/[^`\s]+)`/g)) {
    const raw = m[1].replace(/[.,;:)]+$/, "");
    if (!CODE.test(raw) || HUB.test(raw)) continue;
    for (const cand of [raw, `barwise/${raw}`, `barwise/packages/${raw}`]) {
      if (exists(cand)) {
        out.add(cand);
        break;
      }
    }
  }
  return [...out];
}

function header(text, field) {
  const m = new RegExp(`^${field}:[ \\t]*(.+)$`, "m").exec(text);
  return m ? m[1].trim() : undefined;
}

/** Specs claiming nothing is built, with the commits that say otherwise. */
function findings() {
  const found = [];
  const head = AT ?? "HEAD";
  for (const file of specFiles()) {
    const text = readSpec(file);
    const status = header(text, "Status");
    if (status === undefined || !CLAIMS_NOTHING_BUILT.test(status)) continue;

    const paths = namedPaths(text);
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

if (!check) {
  const baseline = {
    $comment: "Specs whose Status claims no implementation while commits have landed on "
      + "the source files they name. Each row needs a note saying why the header "
      + "is still right, or what it should say instead. Ratcheted by "
      + "`npm run audit:specs -- --check` (scripts/audit-spec-status.mjs).",
    specs: Object.fromEntries(
      found.map((f) => [f.id, { status: f.status, note: "TODO: classify", commits: f.commits }]),
    ),
  };
  writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`audit-spec-status: wrote ${found.length} row(s) to spec-status-baseline.json`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE, "utf8")).specs;
const failures = [];
const seen = new Set();

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
    failures.push(`UNCLASSIFIED: ${f.id} -- its baseline row has no note.`);
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
