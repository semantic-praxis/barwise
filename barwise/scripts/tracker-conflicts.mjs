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
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { MalformedInput, resolveTracker } from "./lib/beads-merge.mjs";
import { envWithoutRepoLocation } from "./lib/git-env.mjs";
import { commentAction, commentBody, TRACKER, verdict } from "./lib/tracker-conflicts.mjs";

const SHA = /^[0-9a-f]{40}$/;

/**
 * A git runner over a work tree; tests pass their own temp repository.
 * GIT_DIR and its kin are dropped so the cwd decides the repository: run
 * from a hook in a linked worktree, they would point every call at the
 * outer checkout.
 */
export function gitIn(cwd) {
  const env = envWithoutRepoLocation();
  return (args, { allow = [0] } = {}) => {
    const r = spawnSync("git", args, { cwd, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (r.error) throw new Error(`git could not run: ${r.error.message}`);
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

/** The tracker at a revision, or undefined where the file does not exist. */
function trackerAt(git, rev) {
  const r = git(["show", `${rev}:${TRACKER}`], { allow: [0, 128] });
  return r.status === 0 ? r.stdout : undefined;
}

/**
 * The verdict for one PR head against main, or `{ unchecked: reason }`.
 * Step 1: which paths conflict as GitHub merges. Step 2, which verdict()
 * asks for only when the tracker is the sole conflict: what the driver's
 * own function does with the three versions.
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
  return verdict(conflicted, () => {
    const [base, main, pr] = [baseList[0], mainRef, head].map((rev) => trackerAt(git, rev));
    // A side that deleted the file is a modify/delete conflict, and git
    // runs no merge driver for one: a local merge would stop by hand.
    if (main === undefined || pr === undefined) return { needsHand: true };
    try {
      return { reported: resolveTracker(base ?? "", main, pr).reported };
    } catch (err) {
      if (!(err instanceof MalformedInput)) throw err;
      return { malformed: { label: err.label, lineNo: err.lineNo } };
    }
  });
}

/**
 * Check every open PR into main and post or edit its comment. `github` is
 * { listPulls(), listComments(n), post(n, body), edit(id, body) }.
 *
 * An unchecked PR is either undecidable (criss-cross history, a head not
 * yet fetchable) or unreadable (a fetch or API failure). Exit 2 means every
 * PR into main was unreadable: an undecidable PR is an answer, and one that
 * stays undecidable must not turn every run red.
 *
 * `closedPull` is the number of a PR the triggering event just closed: no
 * open-PR listing includes it, so its open comment is closed here.
 */
export async function run({
  git,
  github,
  mainRef = "origin/main",
  closedPull,
  log = () => {},
}) {
  let mainSha;
  try {
    const why = refusal(git);
    if (why) return { exit: 2, refused: why, checked: [], unchecked: [] };
    mainSha = git(["rev-parse", "--verify", `${mainRef}^{commit}`]).stdout.trim();
  } catch (err) {
    return { exit: 2, refused: err.message, checked: [], unchecked: [] };
  }

  let all;
  try {
    all = await github.listPulls();
  } catch (err) {
    return {
      exit: 2,
      refused: `could not list pull requests: ${err.message}`,
      checked: [],
      unchecked: [],
    };
  }
  const valid = all.filter((p) =>
    Number.isInteger(p.number) && p.number > 0 && SHA.test(p.head?.sha ?? "")
  );
  const pulls = valid.filter((p) => p.base?.ref === "main");
  const elsewhere = valid.filter((p) => p.base?.ref !== "main");

  // One fetch for every head; per-PR fetches only if it fails, so one
  // missing ref costs that PR alone.
  const refOf = (n) => `refs/barwise-tracker-conflicts/${n}`;
  const refspecs = pulls.map((p) => `+refs/pull/${p.number}/head:${refOf(p.number)}`);
  let batched = false;
  if (refspecs.length > 0) {
    try {
      git(["fetch", "--quiet", "--no-tags", "origin", ...refspecs]);
      batched = true;
    } catch {
      // fall through to per-PR fetches
    }
  }

  const checked = [];
  const unchecked = [];
  const act = async (n, v) => {
    const comments = await github.listComments(n);
    const action = commentAction(v, comments);
    const body = action.action === "none" ? undefined : commentBody(v, action.state, mainSha);
    if (action.action === "post") await github.post(n, body);
    // An identical body is not rewritten: a title edit rescans every PR.
    if (action.action === "edit" && action.previous !== body) {
      await github.edit(action.commentId, body);
    }
    return action.action;
  };

  for (const pr of pulls) {
    const n = pr.number;
    try {
      if (!batched) {
        git(["fetch", "--quiet", "--no-tags", "origin", `+refs/pull/${n}/head:${refOf(n)}`]);
      }
      // Classify the commit the API listed. GitHub updates
      // refs/pull/<n>/head asynchronously after a push, so when the ref
      // lags, the commit is fetched by its sha; when even that fails, no
      // run may follow (this can be the push's own synchronize), so it is
      // named as unchecked rather than guessed.
      const has = () =>
        git(["cat-file", "-e", `${pr.head.sha}^{commit}`], { allow: [0, 1, 128] }).status === 0;
      if (!has()) {
        git(["fetch", "--quiet", "--no-tags", "origin", pr.head.sha], { allow: [0, 1, 128] });
      }
      if (!has()) {
        unchecked.push({
          number: n,
          reason: "the listed head is not fetchable yet",
          undecidable: true,
        });
        continue;
      }
      const v = classify(git, mainSha, pr.head.sha);
      if (v.unchecked) {
        unchecked.push({ number: n, reason: v.unchecked, undecidable: true });
        continue;
      }
      const action = await act(n, v);
      checked.push({ number: n, verdict: v.verdict, action });
      log(`#${n}: ${v.verdict}, ${action}`);
    } catch (err) {
      unchecked.push({ number: n, reason: err.message });
    }
  }
  // A PR retargeted away from main, or just closed, keeps no open comment
  // saying it conflicts with main.
  const closing = [
    ...elsewhere.map((p) => [p.number, "elsewhere"]),
    ...(Number.isInteger(closedPull) && closedPull > 0 ? [[closedPull, "closed-pr"]] : []),
  ];
  for (const [n, kind] of closing) {
    try {
      const action = await act(n, { verdict: kind });
      if (action !== "none") checked.push({ number: n, verdict: kind, action });
    } catch (err) {
      unchecked.push({ number: n, reason: err.message });
    }
  }
  const unreadable = unchecked.filter((u) =>
    !u.undecidable && pulls.some((p) => p.number === u.number)
  );
  const exit = pulls.length > 0 && unreadable.length === pulls.length ? 2 : 0;
  return { exit, checked, unchecked };
}

/** The GitHub REST client the workflow uses; tests pass a fake. */
export function restClient({ token, repo, api = "https://api.github.com" }) {
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
    // Every open PR, whatever its base: one retargeted away from main
    // must still have its open comment closed.
    listPulls: () => all(`/repos/${repo}/pulls?state=open`),
    listComments: (n) => all(`/repos/${repo}/issues/${n}/comments`),
    post: (n, body) => call("POST", `/repos/${repo}/issues/${n}/comments`, { body }),
    edit: (id, body) => call("PATCH", `/repos/${repo}/issues/comments/${id}`, { body }),
  };
}

async function main() {
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, GITHUB_API_URL: api } = process.env;
  let top;
  try {
    top = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  } catch (err) {
    console.error(`tracker-conflicts: could not answer: not in a git work tree (${err.message})`);
    return 2;
  }
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repo ?? "")) {
    console.error(
      "tracker-conflicts: GITHUB_TOKEN and GITHUB_REPOSITORY (owner/repo) are required.",
    );
    return 2;
  }
  // The PR a `closed` event names, so its open comment can be closed.
  let closedPull;
  try {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8"));
    if (event.action === "closed") closedPull = event.pull_request?.number;
  } catch {
    // no event file, or not a pull_request event
  }
  const result = await run({
    closedPull,
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
  process.exitCode = await main().catch((err) => {
    console.error(`tracker-conflicts: could not answer: ${err.message}`);
    return 2;
  });
}
