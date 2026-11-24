#!/usr/bin/env node
/**
 * Claude Code PreToolUse hook: refuse a pull-request merge that is not
 * pinned to a reviewed head, before it happens (merge-delegation decision 2,
 * docs/specs/adr-batch10-enforcers.spec.md, WS5).
 *
 * The detective half (check:merge-record) reads the merge afterwards; this
 * is the preventive half, for sessions that load .claude/settings.json.
 *
 * A merge is allowed when all of these hold:
 *   - it carries the head pin (`expectedHeadSha`, `--match-head-commit`,
 *     the REST `sha` field), so a push after the review is refused by
 *     GitHub rather than merged;
 *   - the method is exactly `merge`: a squash or rebase writes a commit
 *     with no second parent and no trailers, which the pin and the git half
 *     of the detective gate could then not check, and an omitted method
 *     leaves the choice to a default nobody verified;
 *   - it is not auto-merge, which merges whatever head arrives later and so
 *     cannot carry a pin;
 *   - a comment on the pull request reads `Review verdict on head <that
 *     sha>: **merge**.`, unless the merge message carries `Owner-directed:`.
 *
 * Exit codes are Claude Code's hook contract: 2 blocks and hands stderr to
 * the agent. Unlike python-uv-guard, an unreadable API also blocks: the
 * merge needs the same API, so blocking loses nothing.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { apiFields, flagValue, ghCalls, repoFromRemote, subcommand } from "../lib/gh-command.mjs";

const FULL_SHA = /^[0-9a-f]{40}$/i;
const OWNER_DIRECTED = /^Owner-directed:/m;
const VERDICT_LINE =
  /^\*{0,2}Review verdict on head ([0-9a-f]{40})\*{0,2}: \*{0,2}(.+?)\*{0,2}\.$/i;

function block(...reasons) {
  console.error(`merge-guard: refused.\n${reasons.map((r) => `  - ${r}`).join("\n")}`);
  process.exit(2);
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return r.error || r.status !== 0 ? null : r.stdout;
}

const fromUrl = (u) => u?.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);

/** Which pull request a `gh pr merge` names, asking gh when the argument is a branch or absent. */
function prOfGhMerge(args, positional) {
  const slug = flagValue(args, ["--repo", "-R"]);
  const u = fromUrl(positional);
  if (u) return { owner: u[1], repo: u[2], number: Number(u[3]) };
  if (/^\d+$/.test(positional ?? "")) {
    const [owner, repo] = slug ? slug.split("/") : Object.values(repoFromRemote() ?? {});
    return owner && repo ? { owner, repo, number: Number(positional) } : null;
  }
  const out = run("gh", [
    "pr",
    "view",
    ...(positional ? [positional] : []),
    ...(slug ? ["-R", slug] : []),
    "--json",
    "url",
    "-q",
    ".url",
  ]);
  const v = fromUrl(out ?? "");
  return v ? { owner: v[1], repo: v[2], number: Number(v[3]) } : null;
}

/**
 * Merge attempts in the tool call, each `{ pr, pin, method, message, auto }`.
 * `pr` is null when the pull request could not be identified.
 */
function attempts(input) {
  const ti = input.tool_input ?? {};
  if (input.tool_name === "mcp__github__enable_pr_auto_merge") return [{ auto: true }];
  if (input.tool_name === "mcp__github__merge_pull_request") {
    return [{
      pr: { owner: ti.owner, repo: ti.repo, number: Number(ti.pullNumber) },
      pin: ti.expectedHeadSha,
      method: ti.merge_method,
      message: ti.commit_message ?? "",
    }];
  }
  if (input.tool_name !== "Bash" || typeof ti.command !== "string") return [];
  const found = [];
  for (const args of ghCalls(ti.command)) {
    const { words, at } = subcommand(args);
    if (words[0] === "api" && words[1] === "graphql") {
      if (args.some((a) => /mergePullRequest|enablePullRequestAutoMerge/.test(a))) {
        found.push({ graphql: true });
      }
    } else if (words[0] === "pr" && words[1] === "merge") {
      const rest = args.slice(at[1] + 1);
      if (rest.some((a) => ["--help", "-h", "--disable-auto"].includes(a))) continue;
      const valued = new Set([
        "--repo",
        "-R",
        "--match-head-commit",
        "--body",
        "-b",
        "--body-file",
        "-F",
        "--subject",
        "-t",
        "--author-email",
        "-A",
      ]);
      const positional = rest.find((a, i) => !a.startsWith("-") && !valued.has(rest[i - 1]));
      const methods = ["--merge", "-m", "--squash", "-s", "--rebase", "-r"].filter((f) =>
        rest.includes(f)
      );
      found.push({
        pr: prOfGhMerge(args, positional),
        pin: flagValue(rest, ["--match-head-commit"]),
        method: methods.length === 1 && ["--merge", "-m"].includes(methods[0])
          ? "merge"
          : methods.join(" ") || undefined,
        message: flagValue(rest, ["--body", "-b"]) ?? "",
        auto: rest.includes("--auto"),
      });
    } else if (words[0] === "api") {
      const path = words.slice(1).find((w) => /pulls\/\d+\/merge\/?$/.test(w));
      if (!path) continue;
      // Without PUT or a body, `gh api .../merge` is the is-merged GET.
      const put = /^put$/i.test(flagValue(args, ["--method", "-X"]) ?? "");
      if (!put && !args.some((a) => /^(-f|-F|--field|--raw-field|--input)(=|$)/.test(a))) continue;
      const m = path.match(/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/merge/);
      const f = apiFields(args);
      found.push({
        pr: m ? { owner: m[1], repo: m[2], number: Number(m[3]) } : null,
        pin: f.sha,
        method: f.merge_method,
        message: f.commit_message ?? "",
      });
    }
  }
  return found;
}

/** The verdicts posted for `sha`, oldest first; null when the API cannot be read. */
function verdictsFor(pr, sha) {
  const out = run("gh", [
    "api",
    `repos/${pr.owner}/${pr.repo}/issues/${pr.number}/comments`,
    "--paginate",
    "--jq",
    '.[] | (.body // "" | split("\\n") | .[0]) | @json',
  ]);
  if (out === null) return null;
  try {
    return out.split("\n").filter(Boolean)
      .map((l) => JSON.parse(l).trim().match(VERDICT_LINE))
      .filter((m) => m && m[1].toLowerCase() === sha.toLowerCase())
      .map((m) => m[2].toLowerCase());
  } catch {
    return null;
  }
}

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  console.error("merge-guard: could not read the tool call from stdin; not checked.");
  process.exit(1);
}

for (const a of attempts(input)) {
  if (a.graphql) {
    block(
      "a GraphQL merge mutation cannot be checked for a pin or method. Use the REST merge or the GitHub MCP merge tool with expectedHeadSha and merge_method `merge`.",
    );
  }
  if (a.auto) {
    block(
      "auto-merge merges whatever head arrives later, so it cannot be pinned to a reviewed one. Merge by hand, pinned to the reviewed head.",
    );
  }
  const why = [];
  if (!FULL_SHA.test(a.pin ?? "")) {
    why.push(
      "no head pin: pass the full 40-character reviewed sha as expectedHeadSha / --match-head-commit / sha. It must be a literal: \`$SHA\` or \`$(git rev-parse HEAD)\` is not expanded when this hook reads the command",
    );
  }
  if (a.method !== "merge") {
    why.push(
      `merge method must be exactly \`merge\` (got ${
        a.method ?? "none"
      }): a squash or rebase leaves no second parent or trailers to check`,
    );
  }
  if (!a.pr || !a.pr.owner || !a.pr.repo || !Number.isInteger(a.pr.number)) {
    why.push(
      "could not tell which pull request this merges, so its review comment cannot be checked",
    );
  }
  if (why.length) block(...why);
  if (OWNER_DIRECTED.test(a.message)) continue;
  const verdicts = verdictsFor(a.pr, a.pin);
  if (verdicts === null) {
    block(
      `could not read the comments of ${a.pr.owner}/${a.pr.repo}#${a.pr.number} (gh missing, failed, or unparsable output), so the review cannot be confirmed`,
    );
  }
  if (verdicts.at(-1) !== "merge") {
    block(
      `no comment on ${a.pr.owner}/${a.pr.repo}#${a.pr.number} reads \`Review verdict on head ${a.pin}: **merge**.\``
        + (verdicts.length ? ` (the latest verdict on that head is \`${verdicts.at(-1)}\`)` : "")
        + ". Run pr-review on this head and post its verdict, or carry an `Owner-directed:` line in the merge message when the owner said to merge.",
    );
  }
}
process.exit(0);
