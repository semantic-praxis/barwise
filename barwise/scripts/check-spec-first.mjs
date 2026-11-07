#!/usr/bin/env node
/**
 * A pull request that changes package source names the spec it implements,
 * or says it has none (plan-before-code#spec-first;
 * docs/specs/adr-batch10-enforcers.spec.md, WS3).
 *
 * The decision was "a change starts from a spec"; the owner restated it
 * (row 14) to what a script can read: presence and form. The pull request
 * body or any commit message on the branch contains (a) the file name of a
 * spec in the corpus, resolved as `namedSpecs` resolves it for
 * check:plan-review and plan-scope, or (b) a line starting `No spec:`
 * followed by non-whitespace text. A diff that adds or changes a spec file
 * counts as naming it. The reason after `No spec:` is never read, so `No
 * spec: n/a` passes; the gate catches forgetting, not a bad reason (5 of 88
 * spec-adding merges showed forgetting to be the failure).
 *
 * WHICH CHANGES. A path under barwise/packages/<name>/src/, in the
 * three-dot diff `base...HEAD`, committed state, as check:plan-review reads
 * it: a two-dot diff counts the base's own new commits as this branch's.
 *
 * THE BODY. In CI it arrives as $PR_BODY, set from the event payload
 * through `env` (ci.yml), never interpolated into a shell. A pull request
 * with no description arrives as an empty string: a body that names
 * nothing, which is a finding, not a missing input. Unset in CI means the
 * wiring is broken, so it refuses (exit 2). `edited` is among ci.yml's
 * `pull_request` types so a corrected body is read, but a manual re-run of
 * a job reuses the original payload and does not see the edit.
 *
 * LOCALLY there is no body: ci:local sets neither BASE_SHA nor PR_BODY, and
 * the pre-push hook turns exit 2 into a blocked push, before any pull
 * request exists to carry one. So without $GITHUB_ACTIONS, package source
 * changed and no commit message naming a spec, the gate prints that it did
 * not read the body and exits 0. It never prints OK there: the refusal
 * contract forbids a pass over input the gate could not see, and this says
 * so. A $PR_BODY given locally is read as in CI.
 *
 * Git is read before the body, so a local run still refuses (exit 2) where
 * it cannot see the diff: any git failure, a shallow clone, an unresolvable
 * base.
 *
 * Base: `--base <ref>`, else $BASE_SHA, else origin/main. `--head <rev>`
 * stands in for HEAD; nothing in CI passes it.
 */
import { opt } from "./lib/args.mjs";
import { gitAt } from "./lib/git-run.mjs";
import { parseNameStatus } from "./lib/name-status.mjs";
import { inSpecCorpus, namedSpecs } from "./lib/spec-reader.mjs";
import { REPO_ROOT } from "./lib/tracked.mjs";

function refuse(message) {
  console.error(`check:spec-first: cannot answer -- ${message}`);
  console.error("Refusing rather than reporting that every change names its spec.");
  process.exit(2);
}

const g = gitAt(REPO_ROOT);
const git = (args) => {
  try {
    return g.run(args);
  } catch (err) {
    return refuse(err.message);
  }
};

let base, head;
try {
  base = opt("--base") ?? (process.env.BASE_SHA?.trim() || "origin/main");
  head = opt("--head") ?? "HEAD";
} catch (err) {
  refuse(err.message);
}

if (git(["rev-parse", "--is-shallow-repository"]).trim() !== "false") {
  refuse(
    "this is a shallow clone, so the branch's changes and commit messages cannot be\n"
      + "  read in full. Fix: git fetch --unshallow",
  );
}
const mergeBase = git(["merge-base", base, head]).trim();
if (!mergeBase) refuse(`no merge base between ${base} and ${head}.`);

let changed;
try {
  changed = parseNameStatus(
    git(["diff", "--name-status", "-z", "--no-renames", `${base}...${head}`]),
  ).map((r) => r.path);
} catch (err) {
  refuse(err.message);
}

// Checked before the diff is judged, so a step missing its `env` fails on
// every pull request, not only on the first one that changes package source.
const body = process.env.PR_BODY;
const inCI = process.env.GITHUB_ACTIONS !== undefined && process.env.GITHUB_ACTIONS !== "";
if (inCI && body === undefined) {
  refuse(
    "GITHUB_ACTIONS is set but PR_BODY is not. In CI the body is always present (empty when\n"
      + "  the description is null), so its absence is a wiring fault: the step's `env` needs\n"
      + "  PR_BODY: ${{ github.event.pull_request.body }}.",
  );
}

const PACKAGE_SOURCE = /^barwise\/packages\/[^/]+\/src\//;
const source = changed.filter((p) => PACKAGE_SOURCE.test(p));
if (source.length === 0) {
  console.log(
    `check:spec-first: OK -- no package source changed (${changed.length} changed file(s)).`,
  );
  process.exit(0);
}

// The corpus at HEAD and at the merge base, as check:plan-review reads it:
// a spec the branch archives or deletes is still one it may be naming.
const corpusAt = (rev) =>
  git(["ls-tree", "-r", "--name-only", "-z", rev, "--", "barwise/docs/specs/"])
    .split("\u0000").filter(inSpecCorpus);
const corpus = [...new Set([...corpusAt(head), ...corpusAt(mergeBase)])].sort();
const messages = git(["log", "--format=%B", `${mergeBase}..${head}`]);

/** `No spec:` and then text on the same line; the text itself is not read. */
const NO_SPEC = /^[ \t]*No spec:[ \t]*\S/m;
const hasEscape = (text) => NO_SPEC.test(text);

function verdict(text) {
  const named = namedSpecs(changed, corpus, text);
  if (named.length > 0) {
    return `names ${named.map((s) => s.slice(s.lastIndexOf("/") + 1)).join(", ")}`;
  }
  if (hasEscape(text)) return "carries a `No spec:` line";
  return undefined;
}

const fromCommits = verdict(messages);
const fromBody = body === undefined ? undefined : verdict(body);
const found = fromCommits ? `a commit message ${fromCommits}` : fromBody && `the body ${fromBody}`;
if (found) {
  console.log(
    `check:spec-first: OK -- ${source.length} package source file(s) changed; ${found}.`,
  );
  process.exit(0);
}
if (body === undefined) {
  console.log(
    "check:spec-first: NOT CHECKED -- no pull request body in a local run; CI reads it "
      + `(${source.length} package source file(s) changed, no commit message names a spec).`,
  );
  process.exit(0);
}

console.error(
  `check:spec-first: FAIL -- ${source.length} package source file(s) changed and neither the `
    + "pull request body nor any commit message names a spec or carries a `No spec:` line:",
);
for (const p of source.slice(0, 5)) console.error(`  ${p}`);
if (source.length > 5) console.error(`  ... and ${source.length - 5} more`);
console.error(
  "Name the spec this implements by file name (barwise/docs/specs/<name>.spec.md), or add a\n"
    + "line `No spec: <reason>` with a reason after the colon (plan-before-code#spec-first).",
);
process.exit(1);
