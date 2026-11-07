/**
 * The merge hook refuses a merge that is unpinned, not a plain `merge`,
 * automatic, or lacking a verdict comment on the pinned head
 * (merge-delegation decision 2; adr-batch10-enforcers.spec.md, WS5).
 * Driven as Claude Code drives it: JSON on stdin, the verdict in the exit
 * code. `gh` is a stub first on PATH that serves canned comments.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, "..", "hooks", "merge-guard.mjs");
const ROOT = join(HERE, "..", "..", "..");
const SHA = "a".repeat(40);
const OTHER = "b".repeat(40);

const dir = mkdtempSync(join(tmpdir(), "merge-guard-"));
const CALLS = join(dir, "calls.log");
const COMMENTS = join(dir, "comments.jsonl");
writeFileSync(
  join(dir, "gh"),
  `#!${process.execPath}
const fs = require("node:fs");
fs.appendFileSync(${JSON.stringify(CALLS)}, process.argv.slice(2).join(" ") + "\\n");
if (process.env.GH_STUB_FAIL) process.exit(1);
process.stdout.write(fs.existsSync(${JSON.stringify(COMMENTS)}) ? fs.readFileSync(${
    JSON.stringify(COMMENTS)
  }, "utf8") : "");
`,
);
chmodSync(join(dir, "gh"), 0o755);

/** What the API returns: the first line of each comment, as the hook's --jq prints it. */
function comments(...firstLines) {
  writeFileSync(COMMENTS, firstLines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  writeFileSync(CALLS, "");
}
const verdict = (sha, v = "**merge**") => `Review verdict on head ${sha}: ${v}.`;

function run(input, env = {}) {
  return spawnSync(process.execPath, [HOOK], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, ...env },
  });
}
const tool = (over = {}) => ({
  tool_name: "mcp__github__merge_pull_request",
  tool_input: {
    owner: "o",
    repo: "r",
    pullNumber: 7,
    merge_method: "merge",
    expectedHeadSha: SHA,
    ...over,
  },
});
const bash = (command) => ({ tool_name: "Bash", tool_input: { command } });
const PINNED = `gh pr merge 7 -R o/r --merge --match-head-commit ${SHA}`;

function refused(input, reason, env) {
  const r = run(input, env);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, reason);
}

test("refuses a merge call with no head pin [adr:merge-delegation#pinned-merge]", () => {
  comments(verdict(SHA));
  refused(tool({ expectedHeadSha: undefined }), /no head pin/);
});

test("refuses a pin that is not a full sha [adr:merge-delegation#pinned-merge]", () => {
  comments(verdict(SHA));
  refused(tool({ expectedHeadSha: SHA.slice(0, 8) }), /no head pin/);
});

for (const method of ["squash", "rebase", undefined]) {
  test(`refuses merge_method ${method ?? "absent"} [adr:merge-delegation#pinned-merge]`, () => {
    comments(verdict(SHA));
    refused(tool({ merge_method: method }), /method must be exactly `merge`/);
  });
}

test("refuses enable_pr_auto_merge outright [adr:merge-delegation#pinned-merge]", () => {
  comments(verdict(SHA));
  refused(
    {
      tool_name: "mcp__github__enable_pr_auto_merge",
      tool_input: { owner: "o", repo: "r", pullNumber: 7 },
    },
    /auto-merge/,
  );
});

test("refuses gh pr merge --auto [adr:merge-delegation#pinned-merge]", () => {
  comments(verdict(SHA));
  refused(bash(`${PINNED} --auto`), /auto-merge/);
});

test("refuses gh pr merge without --match-head-commit [adr:merge-delegation#pinned-merge]", () => {
  comments(verdict(SHA));
  refused(bash("gh pr merge 7 -R o/r --merge"), /no head pin/);
});

for (const flag of ["--squash", "-s", "--rebase", "-r"]) {
  test(`refuses gh pr merge ${flag} [adr:merge-delegation#pinned-merge]`, () => {
    comments(verdict(SHA));
    refused(
      bash(`gh pr merge 7 -R o/r ${flag} --match-head-commit ${SHA}`),
      /method must be exactly/,
    );
  });
}

test("refuses gh pr merge naming --merge and --squash together [adr:merge-delegation#pinned-merge]", () => {
  comments(verdict(SHA));
  refused(bash(`${PINNED} --squash`), /method must be exactly/);
});

test("refuses gh pr merge with no method flag [adr:merge-delegation#pinned-merge]", () => {
  comments(verdict(SHA));
  refused(bash(`gh pr merge 7 -R o/r --match-head-commit ${SHA}`), /method must be exactly/);
});

test("refuses a gh api merge without the pin or with another method [adr:merge-delegation#pinned-merge]", () => {
  comments(verdict(SHA));
  refused(bash("gh api -X PUT repos/o/r/pulls/7/merge -f merge_method=merge"), /no head pin/);
  refused(
    bash(`gh api -X PUT repos/o/r/pulls/7/merge -f merge_method=squash -f sha=${SHA}`),
    /method must be exactly/,
  );
});

test("sees a merge inside bash -c and after an env prefix [adr:merge-delegation#pinned-merge]", () => {
  comments(verdict(SHA));
  refused(
    bash(`bash -c 'gh pr merge 7 -R o/r --squash --match-head-commit ${SHA}'`),
    /method must be/,
  );
  refused(bash("GH_TOKEN=x gh pr merge 7 -R o/r --merge"), /no head pin/);
});

test("refuses a merge with no verdict comment [adr:merge-delegation#pinned-merge]", () => {
  comments("Some other comment");
  refused(tool(), /no comment on o\/r#7 reads/);
  assert.match(readFileSync(CALLS, "utf8"), /repos\/o\/r\/issues\/7\/comments --paginate/);
});

test("refuses a verdict naming a different head [adr:merge-delegation#pinned-merge]", () => {
  comments(verdict(OTHER));
  refused(tool(), /no comment on o\/r#7 reads/);
});

test("refuses a verdict that is not merge [adr:merge-delegation#pinned-merge]", () => {
  for (const v of ["**do not merge**", "**merge after**", "**cannot tell**"]) {
    comments(verdict(SHA, v));
    refused(tool(), /latest verdict on that head is/);
  }
});

test("a later non-merge verdict on the same head overrides an earlier merge [adr:merge-delegation#pinned-merge]", () => {
  comments(verdict(SHA), verdict(SHA, "**do not merge**"));
  refused(tool(), /latest verdict/);
});

test("an unreadable API blocks with exit 2 and says so [adr:merge-delegation#pinned-merge]", () => {
  comments(verdict(SHA));
  refused(tool(), /could not read the comments/, { GH_STUB_FAIL: "1" });
  writeFileSync(COMMENTS, "not json\n");
  refused(tool(), /could not read the comments/);
  // gh absent: PATH holds only the directory of node, which has no gh.
  comments(verdict(SHA));
  const noGh = join(mkdtempSync(join(tmpdir(), "merge-guard-nogh-")), "node");
  writeFileSync(noGh, "");
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(tool()),
    encoding: "utf8",
    env: { ...process.env, PATH: dirname(noGh) },
  });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /could not read the comments/);
});

test("allows a pinned merge with a verdict on that head [adr:merge-delegation#pinned-merge]", () => {
  comments(verdict(SHA));
  const r = run(tool());
  assert.equal(r.status, 0, r.stderr);
});

test("allows both verdict spellings and the gh forms [adr:merge-delegation#pinned-merge]", () => {
  comments(`**Review verdict on head ${SHA}**: **merge**.`);
  assert.equal(run(tool()).status, 0);
  comments(`Review verdict on head ${SHA}: merge.`);
  assert.equal(run(bash(PINNED)).status, 0);
  assert.equal(
    run(bash(`gh api -X PUT repos/o/r/pulls/7/merge -f merge_method=merge -f sha=${SHA}`)).status,
    0,
  );
  assert.equal(
    run(bash(`gh pr merge https://github.com/o/r/pull/7 -m --match-head-commit=${SHA}`)).status,
    0,
  );
});

test("allows an Owner-directed merge with no verdict, and only with the line [adr:merge-delegation#pinned-merge]", () => {
  comments("no verdict here");
  const msg = "Merge #7\n\nOwner-directed: owner said merge";
  assert.equal(run(tool({ commit_message: msg })).status, 0);
  assert.equal(run(bash(`${PINNED} --body '${msg}'`)).status, 0);
  refused(tool({ commit_message: "mentions Owner-directed: inline" }), /no comment/);
});

test("Owner-directed does not excuse a missing pin or a squash [adr:merge-delegation#pinned-merge]", () => {
  comments("none");
  const commit_message = "Owner-directed: yes";
  refused(tool({ commit_message, expectedHeadSha: undefined }), /no head pin/);
  refused(tool({ commit_message, merge_method: "squash" }), /method must be/);
});

test("ignores other tools and commands that only mention a merge", () => {
  comments();
  for (
    const i of [
      { tool_name: "mcp__github__get_commit", tool_input: {} },
      { tool_name: "Read", tool_input: { file_path: "x" } },
      bash("npm run build && git status"),
      bash('git commit -m "docs: explain gh pr merge --squash"'),
      bash('echo "gh pr merge 7"'),
      bash("gh pr view 7"),
      bash("gh api repos/o/r/pulls/7"),
    ]
  ) {
    const r = run(i);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, "");
  }
});

test("input it cannot read is reported without blocking: exit 1", () => {
  const r = run("not json");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /could not read/);
});

test("settings.json registers the hook for the MCP merge tools and Bash [adr:merge-delegation#pinned-merge]", () => {
  const settings = JSON.parse(readFileSync(join(ROOT, ".claude", "settings.json"), "utf8"));
  const entries = settings.hooks.PreToolUse.filter((e) =>
    e.hooks.some((h) => h.type === "command" && h.command.includes("hooks/merge-guard.mjs"))
  );
  for (
    const name of [
      "mcp__github__merge_pull_request",
      "mcp__github__enable_pr_auto_merge",
      "Bash",
    ]
  ) {
    assert.ok(
      entries.some((e) => new RegExp(`^(?:${e.matcher})$`).test(name)),
      `no PreToolUse entry running merge-guard.mjs matches ${name}`,
    );
  }
  assert.ok(
    entries.every((e) =>
      e.hooks.every((h) => h.command.startsWith("env -u BARWISE_EXIT_DIR node "))
    ),
  );
});
