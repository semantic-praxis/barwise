#!/usr/bin/env node
/**
 * A pull request that closes a tracker issue changes nothing but the
 * tracker (docs/specs/tracker-only-closes.spec.md).
 *
 * The steward skill puts closures in a tracker-only follow-up after the
 * work merges, and the pr-review checklist says a PR does not close its
 * own tracking issue: a close inside a code PR records work as shipped
 * while it is still a branch. Both were written down and enforced nowhere,
 * and in one session the rule was broken in #604 and #615 and caught only
 * by a reviewer bot after the PR was open (barwise-i61). Which issues a
 * diff closes, and which files it touches, are both mechanical facts, so
 * this is a gate rather than a checklist line.
 *
 * Base: $BASE_SHA when set (ci.yml passes the pull request's base commit),
 * else `git merge-base origin/main HEAD`, the fallback ci-local.mjs uses.
 * Committed state only, read with `git show`, so a pre-push run checks
 * exactly what is being pushed.
 *
 * Exit 0 clean, 1 a close beside a non-tracker change, 2 could not answer.
 */
import { execFileSync } from "node:child_process";
import { committedPaths } from "./lib/changed-class.mjs";

const TRACKER = ".beads/issues.jsonl";

function refuse(message) {
  console.error(`check-tracker-closes: ${message}`);
  console.error("Could not answer; refusing rather than reporting a clean diff.");
  process.exit(2);
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function resolveBase() {
  const fromEnv = process.env.BASE_SHA?.trim();
  if (fromEnv) return fromEnv;
  try {
    return git(["merge-base", "origin/main", "HEAD"]).trim();
  } catch {
    return refuse("no $BASE_SHA and no merge-base with origin/main.");
  }
}

/** Issue id -> status, from the tracker as committed at `rev`. */
function statuses(rev) {
  let text;
  try {
    text = git(["show", `${rev}:${TRACKER}`]);
  } catch {
    return refuse(`cannot read ${TRACKER} at ${rev}.`);
  }
  const out = new Map();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (row.id) out.set(row.id, row.status);
  }
  return out;
}

const base = resolveBase();
let paths;
try {
  paths = committedPaths(base);
} catch {
  refuse(`git cannot diff ${base}..HEAD.`);
}

const before = statuses(base);
const after = statuses("HEAD");
const closed = [...after]
  .filter(([id, status]) => status === "closed" && before.get(id) !== "closed")
  .map(([id]) => id);
const elsewhere = paths.filter((p) => !p.startsWith(".beads/"));

if (closed.length > 0 && elsewhere.length > 0) {
  console.error(
    `check-tracker-closes: FAIL -- this diff closes ${closed.length} issue(s) and changes `
      + `${elsewhere.length} file(s) outside .beads/.`,
  );
  console.error(`  closed:  ${closed.join(", ")}`);
  console.error(
    `  changed: ${elsewhere.slice(0, 5).join(", ")}${elsewhere.length > 5 ? ", ..." : ""}`,
  );
  console.error(
    "Close issues in a tracker-only follow-up after the work merges (steward skill, section 5).",
  );
  process.exit(1);
}

console.log(
  closed.length > 0
    ? `check-tracker-closes: OK -- ${closed.length} close(s), tracker-only diff.`
    : `check-tracker-closes: OK -- no issue closed in ${paths.length} changed file(s).`,
);
