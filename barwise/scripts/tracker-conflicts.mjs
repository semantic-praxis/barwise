#!/usr/bin/env node
/**
 * Comment on each open PR into main whose only conflict with main is the
 * tracker (docs/specs/tracker-conflict-comment.spec.md, barwise-ojo). Run
 * by .github/workflows/tracker-conflicts.yml from main's checkout.
 *
 * GitHub runs no custom merge driver, so a PR that added an issue shows as
 * conflicted after main moves, though one local `git merge origin/main`
 * clears it. Nothing tells its owner. For each PR this script asks git
 * which paths conflict (merge-tree, with no driver configured, as GitHub
 * merges), and for a tracker-only conflict asks the driver's own function
 * what a local merge would do. lib/tracker-conflicts.mjs turns that into
 * the comment.
 *
 * PR heads are data: read by `git merge-tree` (no checkout, no hooks) and
 * `git show`. No PR-controlled string reaches a shell or a comment.
 *
 * Exit 0 when every PR was checked, or some were and the rest are named as
 * unchecked; 2 when the PR list could not be read, none of the PRs could
 * be checked, git is too old, or the driver is configured in this clone
 * (gate-refusal-contract.spec.md).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { MalformedInput, parseTracker, resolveIssues } from "./lib/beads-merge.mjs";
import { commentAction, commentBody, TRACKER, verdict } from "./lib/tracker-conflicts.mjs";

const SHA = /^[0-9a-f]{40}$/;

/** A git runner over a work tree; tests pass their own temp repository. */
export function gitIn(cwd) {
  return (args, { allow = [0] } = {}) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (!allow.includes(r.status)) {
      throw new Error(
        `git ${args[0]} exited ${r.status}: ${(r.stderr || "").trim().split("\n")[0]}`,
      );
    }
    return { status: r.status, stdout: r.stdout };
  };
}

/** Why this clone cannot answer, or undefined. */
export function refusal(git) {
  const version = /git version (\d+)\.(\d+)/.exec(git(["--version"]).stdout);
  if (!version || Number(version[1]) * 1000 + Number(version[2]) < 2038) {
    return "git 2.38 or later is needed for `git merge-tree --write-tree`";
  }
  const config = git(["config", "--get-regexp", "^merge\\.beads\\."], { allow: [0, 1] });
  if (config.status === 0) {
    // With the driver configured, merge-tree would merge the tracker and
    // every tracker-only conflict would read as clean.
    return "this clone has merge.beads.* config; run from a clone without the driver installed";
  }
  return undefined;
}

/** The tracker at a revision, or "" where the file does not exist. */
function trackerAt(git, rev) {
  const r = git(["show", `${rev}:${TRACKER}`], { allow: [0, 128] });
  return r.status === 0 ? r.stdout : "";
}

/**
 * The verdict for one PR head against main, or `{ unchecked: reason }`.
 * Step 1: which paths conflict as GitHub merges. Step 2, for a
 * tracker-only conflict: what the driver's own function does with the
 * three versions.
 */
export function classify(git, mainRef, head) {
  const bases = git(["merge-base", "--all", mainRef, head], { allow: [0, 1] });
  const baseList = bases.stdout.trim().split("\n").filter(Boolean);
  if (baseList.length === 0) return { unchecked: "no merge base with main" };
  if (baseList.length > 1) {
    return { unchecked: "more than one merge base with main (criss-cross history)" };
  }

  const tree = git(["merge-tree", "--write-tree", "--name-only", "--no-messages", mainRef, head], {
    allow: [0, 1],
  });
  const conflicted = tree.status === 0 ? [] : tree.stdout.split("\n").slice(1).filter(Boolean);
  if (conflicted.length !== 1 || conflicted[0] !== TRACKER) return verdict(conflicted);

  try {
    const { reported } = resolveIssues(
      parseTracker(trackerAt(git, baseList[0]), "base"),
      parseTracker(trackerAt(git, mainRef), "current"),
      parseTracker(trackerAt(git, head), "other"),
    );
    return verdict(conflicted, { reported });
  } catch (err) {
    if (!(err instanceof MalformedInput)) throw err;
    return verdict(conflicted, { malformed: { label: err.label, lineNo: err.lineNo } });
  }
}

/**
 * Check every open PR into main and post or edit its comment. `github` is
 * { listPulls(), listComments(n), post(n, body), edit(id, body) }.
 */
export async function run({ git, github, mainRef = "origin/main", log = () => {} }) {
  const why = refusal(git);
  if (why) return { exit: 2, refused: why, checked: [], unchecked: [] };
  const mainSha = git(["rev-parse", "--verify", `${mainRef}^{commit}`]).stdout.trim();

  let pulls;
  try {
    pulls = (await github.listPulls()).filter((p) => p.base?.ref === "main");
  } catch (err) {
    return {
      exit: 2,
      refused: `could not list pull requests: ${err.message}`,
      checked: [],
      unchecked: [],
    };
  }

  const checked = [];
  const unchecked = [];
  for (const pr of pulls) {
    const n = pr.number;
    try {
      if (!Number.isInteger(n) || n <= 0) throw new Error("not a pull request number");
      if (!SHA.test(pr.head?.sha ?? "")) throw new Error("head is not a commit sha");
      const ref = `refs/barwise-tracker-conflicts/${n}`;
      git(["fetch", "--quiet", "--no-tags", "origin", `+refs/pull/${n}/head:${ref}`]);
      const v = classify(git, mainSha, ref);
      if (v.unchecked) {
        unchecked.push({ number: n, reason: v.unchecked });
        continue;
      }
      const act = commentAction(v, await github.listComments(n));
      if (act.action === "post") await github.post(n, commentBody(v, act.state, mainSha));
      if (act.action === "edit") {
        await github.edit(act.commentId, commentBody(v, act.state, mainSha));
      }
      checked.push({ number: n, verdict: v.verdict, action: act.action });
      log(`#${n}: ${v.verdict}, ${act.action}`);
    } catch (err) {
      unchecked.push({ number: n, reason: err.message });
    }
  }
  const exit = pulls.length > 0 && checked.length === 0 ? 2 : 0;
  return { exit, checked, unchecked };
}

/** The GitHub REST client the workflow uses; tests pass a fake. */
function restClient({ token, repo, api = "https://api.github.com" }) {
  const call = async (method, path, body) => {
    const res = await fetch(`${api}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status}`);
    return res.json();
  };
  const all = async (path) => {
    const out = [];
    for (let page = 1;; page++) {
      const batch = await call(
        "GET",
        `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
      );
      out.push(...batch);
      if (batch.length < 100) return out;
    }
  };
  return {
    listPulls: () => all(`/repos/${repo}/pulls?state=open&base=main`),
    listComments: (n) => all(`/repos/${repo}/issues/${n}/comments`),
    post: (n, body) => call("POST", `/repos/${repo}/issues/${n}/comments`, { body }),
    edit: (id, body) => call("PATCH", `/repos/${repo}/issues/comments/${id}`, { body }),
  };
}

async function main() {
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, GITHUB_API_URL: api } = process.env;
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repo ?? "")) {
    console.error(
      "tracker-conflicts: GITHUB_TOKEN and GITHUB_REPOSITORY (owner/repo) are required.",
    );
    return 2;
  }
  const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const result = await run({
    git: gitIn(top),
    github: restClient({ token, repo, api }),
    log: (line) => console.log(line),
  });
  const lines = [];
  if (result.refused) lines.push(`tracker-conflicts: could not answer: ${result.refused}`);
  lines.push(
    `checked ${result.checked.length} pull request(s), ${result.unchecked.length} unchecked`,
  );
  for (const u of result.unchecked) {
    // A warning annotation, not a failure: one unreadable PR must not turn
    // every later run red.
    console.log(`::warning::tracker-conflicts: #${u.number} unchecked: ${u.reason}`);
    lines.push(`- #${u.number} unchecked: ${u.reason}`);
  }
  console.log(lines.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
  }
  return result.exit;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
