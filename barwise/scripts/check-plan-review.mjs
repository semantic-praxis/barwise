#!/usr/bin/env node
/**
 * A spec's plan is reviewed before its implementation is committed
 * (docs/specs/plan-scope-check.spec.md, WS6).
 *
 * The owner's rule: `/code-review` and `/pr-review` run on the spec
 * before any implementation commit, and the spec records it in its
 * header as `Plan-reviewed: <commit> (code-review, pr-review)`. Measured
 * before this existed: 90 of 120 spec-adding PRs since 2026-07-01
 * shipped code in the same PR, so the spec was reviewed, if at all,
 * beside the code it was meant to shape.
 *
 * WHICH SPECS. A spec is covered when the PR names it -- its file is in
 * the diff, or its file name is in a commit message on the branch -- and
 * the diff changes a path in its `Touches:` (read at the merge base and at
 * HEAD, so dropping an entry or archiving the spec does not take it out),
 * and it is new in the diff or its Status at the merge base claims nothing
 * is built (a missing Status counts as claiming nothing). Only specs the
 * PR names: covering every spec whose `Touches:` lists a changed file
 * made unrelated PRs that edit `ci.yml` or a skill answer for some Draft
 * spec's review, six findings in three rounds on PR #714 (Open decision
 * 5). Status is read at the base, not the head, because a compliant
 * first workstream updates Status in the commit that lands it.
 *
 * WHAT IT REQUIRES. A `Plan-reviewed:` line, at HEAD, naming a commit R
 * that (1) is a proper ancestor of every commit on the branch that changes
 * one of those `Touches:` paths -- on a merged side line too, not only
 * the first in topological order -- (2) contains the spec, and (3) carries
 * the same spec body -- everything but the header block -- as the parent
 * of F, the first such commit,
 * the plan as implementation began. A review of an earlier draft does not
 * vouch for a plan rewritten after it; adding the line itself, or a
 * Status update, leaves the body alone. The spec says "the body at that
 * first change"; read literally, that includes F's own edits, so a spec
 * amended in its first implementation commit failed while the same
 * amendment one commit later passed (#721, measured). The parent is the
 * reading under which the two agree.
 *
 * WHAT IT CANNOT PROVE: that the reviews ran well. It ties the claim to a
 * named commit and a body a later reader can compare.
 *
 * Base: `--base <ref>`, else $BASE_SHA (ci.yml passes the pull request's
 * base commit), else origin/main. The changed files are the three-dot
 * diff `base...HEAD`, as pr-risk reads them: a two-dot diff counts the
 * base's own new commits as this branch's changes. `--head <rev>` stands
 * in for HEAD, to measure the rule over merged history; nothing in CI
 * passes it. Committed state only, read through git, so a pre-push run
 * checks what is being pushed.
 *
 * Exit 0 every covered spec was reviewed first (or none is covered), 1 a
 * covered spec was not (named), 2 git or a spec could not be read, or the
 * clone is shallow -- ancestry in a truncated history is not an answer.
 */
import { execFileSync } from "node:child_process";
import { opt } from "./lib/args.mjs";
import { parseNameStatus } from "./lib/name-status.mjs";
import {
  CLAIMS_NOTHING_BUILT,
  entryPaths,
  header,
  inSpecCorpus,
  namedSpecs,
  specBody,
  touches,
} from "./lib/spec-reader.mjs";
import { REPO_ROOT } from "./lib/tracked.mjs";

function refuse(message) {
  console.error(`check:plan-review: cannot answer -- ${message}`);
  console.error("Refusing rather than reporting that every plan was reviewed.");
  process.exit(2);
}

/** git at the repository root, or a refusal naming the command. */
function git(args) {
  try {
    return execFileSync("git", args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    const why = err.stderr?.toString().trim().split("\n")[0] || err.message.split("\n")[0];
    return refuse(`\`git ${args.join(" ")}\` failed: ${why}`);
  }
}

/**
 * Whether git says yes (exit 0) or no (exit 1) to a question; anything
 * else refuses. 128 is git failing -- a missing object, a corrupt history
 * -- and read as "no" it would blame the author for what git could not see.
 */
function gitAnswers(args) {
  try {
    execFileSync("git", args, { cwd: REPO_ROOT, stdio: "ignore" });
    return true;
  } catch (err) {
    if (err.status === 1) return false;
    return refuse(`\`git ${args.join(" ")}\` exited ${err.status ?? err.signal}`);
  }
}

/** The full id of the commit `sha` abbreviates, or undefined when there is none. */
function resolveCommit(sha) {
  try {
    return execFileSync("git", ["rev-parse", "--verify", "--quiet", `${sha}^{commit}`], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (err) {
    if (err.status === 1) return undefined;
    return refuse(`\`git rev-parse --verify ${sha}\` exited ${err.status ?? err.signal}`);
  }
}

/**
 * Whether `rev` holds `path`, from a listing rather than an exit status:
 * `cat-file -e` exits 128 both for an absent path and for a git that
 * failed, and only the listing tells them apart.
 */
const holds = (rev, path) => git(["ls-tree", "-z", "--name-only", rev, "--", path]) !== "";

let base, head;
try {
  base = opt("--base") ?? (process.env.BASE_SHA?.trim() || "origin/main");
  head = opt("--head") ?? "HEAD";
} catch (err) {
  refuse(err.message);
}

if (git(["rev-parse", "--is-shallow-repository"]).trim() !== "false") {
  refuse(
    "this is a shallow clone, so whether a review commit precedes the first\n"
      + "  implementation commit cannot be read. Fix: git fetch --unshallow",
  );
}

const mergeBase = git(["merge-base", base, head]).trim();
if (!mergeBase) refuse(`no merge base between ${base} and ${head}.`);

// -z prints names exactly; --no-renames keeps a rename's source path,
// which is as much a change to a planned file as its destination.
let changed;
try {
  changed = parseNameStatus(
    git(["diff", "--name-status", "-z", "--no-renames", `${base}...${head}`]),
  ).map((r) => r.path);
} catch (err) {
  refuse(err.message);
}

// The specs the branch names (the rule plan-scope shares), from the corpus
// at HEAD and at the merge base: a spec the branch archives or deletes is
// still one whose plan it may be implementing.
const corpusAt = (rev) =>
  git(["ls-tree", "-r", "--name-only", "-z", rev, "--", "barwise/docs/specs/"])
    .split("\u0000").filter(inSpecCorpus);
const corpus = [...new Set([...corpusAt(head), ...corpusAt(mergeBase)])].sort();
const messages = git(["log", "--format=%B", `${mergeBase}..${head}`]);
const named = namedSpecs(changed, corpus, messages);

const read = (rev, path) => git(["show", `${rev}:${path}`]);
const short = (sha) => sha.slice(0, 8);

const failures = [];
const checked = [];
for (const spec of named) {
  const atBase = holds(mergeBase, spec) ? read(mergeBase, spec) : undefined;
  // The spec as the branch leaves it, or as it stood when the branch
  // removes it; the review line is read from this.
  const text = holds(head, spec) ? read(head, spec) : atBase;
  // Both sides' entries: a branch that drops an implemented path from
  // Touches: (a header edit, which leaves a review standing) is still
  // implementing it.
  const entries = [...(touches(text) ?? []), ...(atBase ? touches(atBase) ?? [] : [])];
  // No declaration, no plan to hold the diff against. check:spec-touches
  // owns an empty one.
  if (entries.length === 0) continue;

  if (atBase !== undefined) {
    // A missing Status is read as claiming nothing, as a new spec's is.
    const status = header(atBase, "Status");
    if (status !== undefined && !CLAIMS_NOTHING_BUILT.test(status)) continue;
  }

  // The spec's own file is the plan, not its implementation, even when
  // its Touches: lists the specs directory.
  const others = changed.filter((p) => p !== spec);
  const planned = new Set(entries.flatMap((e) => entryPaths(e.path, others)));
  const implemented = others.filter((p) => planned.has(p));
  if (implemented.length === 0) continue;

  // Every commit on the branch to change one of them, topological and
  // reversed, so an ancestor always comes before its descendants and the
  // first is where implementation began.
  const changing = git([
    "rev-list",
    "--reverse",
    "--topo-order",
    `${mergeBase}..${head}`,
    "--",
    ...implemented,
  ])
    .split("\n").filter(Boolean);
  const first = changing[0];
  if (!first) refuse(`the diff changes ${implemented[0]} but no commit on the branch does.`);
  const id = spec.slice(spec.lastIndexOf("/") + 1);
  const at = `first change to its Touches: is ${short(first)} (${implemented[0]})`;

  const line = header(text, "Plan-reviewed");
  if (line === undefined) {
    failures.push(`${id}: no Plan-reviewed: line; ${at}.`);
    continue;
  }
  const sha = /^([0-9a-f]{7,40})\b/.exec(line)?.[1];
  const reviewed = sha && resolveCommit(sha);
  if (!reviewed) {
    failures.push(`${id}: Plan-reviewed: "${line}" names no commit in this repository; ${at}.`);
    continue;
  }
  // Each changing commit, not only the first: one on a side line merged
  // in later can precede the review while the first does not.
  const early = changing.find((c) =>
    c === reviewed || !gitAnswers(["merge-base", "--is-ancestor", reviewed, c])
  );
  if (early !== undefined) {
    failures.push(
      `${id}: Plan-reviewed: names ${short(reviewed)}, which does not precede ${
        short(early)
      }, a change to its Touches: (the ${at}). The plan must be reviewed before it is implemented.`,
    );
    continue;
  }
  if (!holds(reviewed, spec)) {
    failures.push(
      `${id}: Plan-reviewed: names ${short(reviewed)}, which does not contain the spec.`,
    );
    continue;
  }
  // Against F's parent: the plan as implementation began. Comparing with F
  // itself failed a spec amended in its first implementation commit while
  // passing the same amendment one commit later (#721, measured).
  const began = `${first}^`;
  if (!holds(began, spec) || specBody(read(reviewed, spec)) !== specBody(read(began, spec))) {
    failures.push(
      `${id}: the plan changed between the reviewed ${short(reviewed)} and the ${at}; `
        + "the review covers the plan it read.",
    );
    continue;
  }
  checked.push(`${id} (reviewed at ${short(reviewed)}, first change ${short(first)})`);
}

if (failures.length > 0) {
  console.error(`check:plan-review: FAIL -- ${failures.length} spec(s) implemented before review:`);
  for (const f of failures) console.error(`  ${f}`);
  console.error(
    "Run /code-review and /pr-review on the spec, commit `Plan-reviewed: <that commit> "
      + "(code-review, pr-review)` in its header, then implement (spec-writer, step 8).",
  );
  process.exit(1);
}
console.log(
  checked.length > 0
    ? `check:plan-review: OK -- ${checked.join("; ")}.`
    : `check:plan-review: OK -- ${named.length} spec(s) named, none implemented here before a `
      + `recorded review was due (${changed.length} changed file(s)).`,
);
