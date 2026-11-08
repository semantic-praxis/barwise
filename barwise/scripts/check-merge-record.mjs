#!/usr/bin/env node
/**
 * check:merge-record -- a merge to main leaves the record merge-delegation
 * asks for (docs/adr/merge-delegation.md decisions 1, 3, 4 and 5;
 * docs/specs/adr-batch10-enforcers.spec.md, WS6).
 *
 * TWO HALVES, ONE SCRIPT. The rules are in scripts/lib/merge-record.mjs.
 *
 * The git half reads the first-parent merges from MERGE_RECORD_SINCE to the
 * tip: two parents, `Reviewed-head` equal to the second parent, `Review:
 * merge`, or an `Owner-directed:` trailer with text. No network, so it runs
 * on every CI event and in ci:local, and a bad merge shows wherever the
 * history is.
 *
 * The API half runs only when GITHUB_EVENT_NAME is `push`. For each of the
 * last 30 merges without `Owner-directed:` it reads the pull request's
 * comments and requires a verdict comment naming the merged head, dated at
 * or before the merge, saying `merge`; and no two non-`merge` verdicts after
 * the last `Owner-answer:`. It is detective: the comment is posted after CI
 * is green and before the merge, so on a pull request it could only be red
 * until the step it precedes. The preventive reader of the same comment is
 * the merge-guard hook. Anywhere else it prints that it did not run, so a
 * local pass is understood to be the git half.
 *
 * The tip is --tip, else $BASE_SHA (a pull request: the base the merge
 * would land on, not the synthetic merge commit, which has no trailers),
 * else HEAD on a push, else origin/main.
 *
 * THE BASELINE. A merge cannot be amended, so a finding on history is
 * permanent unless acknowledged, and one unacknowledged merge would red
 * every later run. barwise/merge-record-baseline.json keys a row by merge
 * SHA with `accepted-by-owner` or `tracked:<issue>` and a note;
 * `--write` adds a placeholder row for each git-half finding without
 * touching a verdict already recorded (scripts/lib/baseline-merge.mjs), and
 * check:findings holds the rest (a placeholder, an open row naming a closed
 * issue). A row suppresses every finding of its merge, on both halves, and
 * the API half does not read an accepted merge at all: an ambiguous pull
 * request lookup there would otherwise refuse forever over a merge the
 * owner has already answered for.
 *
 * A row whose SHA is not in the range is stale and a finding. A row for a
 * merge with no finding on the half that ran is not: the git half cannot
 * see an API-only finding, so calling that row stale would delete it.
 *
 * Exit 0 every merge in range holds, 1 a finding (each named, with the
 * command that files an issue for it), 2 could not answer: a shallow clone,
 * a git failure, a missing or unreadable baseline, a missing token on a
 * push, any non-2xx response, a rate limit or 403, an ambiguous pull
 * request, endless pagination. A refusal never uses 1
 * (docs/adr/gate-refusal-contract.md). It never writes to GitHub and never
 * reverts; the owner decides.
 *
 * `--write` rewrites the baseline from the git half and exits 0. `--since <sha>`
 * replaces the cutoff, for this gate's own tests.
 * `--check` is the default and is accepted so ratchet callers can spell it.
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { opt } from "./lib/args.mjs";
import { mergeBaselineRows, mergeSummary, readExistingRows } from "./lib/baseline-merge.mjs";
import { gitAt } from "./lib/git-run.mjs";
import {
  API_WINDOW,
  isOwnerDirected,
  judgeComments,
  judgeMerge,
  MERGE_RECORD_SINCE,
  readMergeComments,
  readMerges,
  Refusal,
} from "./lib/merge-record.mjs";
import { REPO_ROOT } from "./lib/tracked.mjs";

const BASELINE = join(REPO_ROOT, "barwise", "merge-record-baseline.json");
const BASELINE_COMMENT =
  "Merges the owner has answered for, from scripts/check-merge-record.mjs (npm run check:merge-record; "
  + "CI runs it). A merge cannot be amended, so a finding on history stays until acknowledged here: "
  + "status is `accepted-by-owner` or `tracked:<issue>`, and note says why a reader can follow. "
  + "`--write` adds a placeholder row for a new finding; check:findings refuses a placeholder and an open row "
  + "whose issue is closed. docs/adr/merge-delegation.md.";

const short = (sha) => sha.slice(0, 8);
const refuse = (why) => {
  console.error(`check:merge-record: cannot answer -- ${why}`);
  console.error("Refusing rather than reporting that every merge holds.");
  process.exit(2);
};

const isPlaceholder = (status) =>
  typeof status !== "string" || status === "" || status.startsWith("TODO");

function readBaselineRows() {
  let raw;
  try {
    raw = readFileSync(BASELINE, "utf8");
  } catch (err) {
    throw new Refusal(`cannot read ${BASELINE}: ${err.message}`);
  }
  try {
    const rows = JSON.parse(raw).merges;
    if (rows === null || typeof rows !== "object" || Array.isArray(rows)) {
      throw new Error('no "merges" object');
    }
    return rows;
  } catch (err) {
    throw new Refusal(`${BASELINE}: ${err.message}`);
  }
}

/** Single-quoted for a shell, so the printed command can be pasted as it is. */
const shq = (s) => `'${s.replaceAll("'", "'\\''")}'`;

async function main() {
  const git = gitAt(REPO_ROOT);
  const event = process.env.GITHUB_EVENT_NAME ?? "";
  const tip = opt("--tip")
    ?? (process.env.BASE_SHA?.trim() || (event === "push" ? "HEAD" : "origin/main"));
  const writing = process.argv.includes("--write");

  const since = opt("--since") ?? MERGE_RECORD_SINCE;
  const merges = readMerges(git, tip, since);
  const gitFindings = merges
    .map((merge) => ({ merge, items: judgeMerge(merge).map((f) => ({ ...f, half: "git" })) }))
    .filter((f) => f.items.length > 0);

  if (writing) {
    const existing = readExistingRows(BASELINE, "merges");
    // Existing rows are carried as they stand: the API half's findings are
    // invisible here, so dropping a row the git half does not explain would
    // delete an acceptance this run could not see the reason for.
    const fresh = Object.fromEntries(
      Object.entries(existing).map(([sha, row]) => {
        const { status: _s, note: _n, ...derived } = row;
        return [sha, derived];
      }),
    );
    for (const { merge, items } of gitFindings) {
      fresh[merge.sha] = { subject: merge.subject, rules: items.map((i) => i.rule) };
    }
    const { rows, ...counts } = mergeBaselineRows({
      fresh,
      existing,
      preserve: { status: "TODO: classify", note: "" },
    });
    writeFileSync(
      BASELINE,
      JSON.stringify({ $comment: BASELINE_COMMENT, merges: rows }, null, 2) + "\n",
    );
    console.log(
      `check:merge-record: wrote ${Object.keys(rows).length} row(s); ${mergeSummary(counts)}.`,
    );
    return 0;
  }

  const baseline = readBaselineRows();
  const accepted = new Set(
    Object.entries(baseline).filter(([, row]) => !isPlaceholder(row?.status)).map(([sha]) => sha),
  );
  const inRange = new Set(merges.map((m) => m.sha));
  const staleRows = Object.keys(baseline).filter((sha) => !inRange.has(sha));

  // API half.
  const apiFindings = [];
  const readLines = [];
  let apiNote;
  if (event !== "push") {
    apiNote = `API half not run (GITHUB_EVENT_NAME is ${
      event || "unset"
    }, not push); a pass here is the git half only`;
  } else {
    const token = process.env.GITHUB_TOKEN;
    const repo = process.env.GITHUB_REPOSITORY;
    if (!token) {
      throw new Refusal("GITHUB_TOKEN is not set on a push event; the step's `env` needs it");
    }
    if (!repo) throw new Refusal("GITHUB_REPOSITORY is not set on a push event");
    const apiUrl = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, "");
    const window = merges.slice(0, API_WINDOW);
    const toRead = window.filter((m) =>
      m.parents.length === 2 && !isOwnerDirected(m) && !accepted.has(m.sha)
    );
    const results = await readMergeComments(toRead, {
      fetchImpl: globalThis.fetch,
      apiUrl,
      repo,
      token,
    });
    for (const { merge, number, comments } of results) {
      const { found, read } = judgeComments(merge, number, comments);
      if (found.length > 0) {
        apiFindings.push({ merge, items: found.map((f) => ({ ...f, half: "api" })) });
      }
      for (const r of read) {
        const flags = [
          r.edited && "edited",
          r.editedAfterMerge && "edited after the merge",
          r.afterMerge && "after the merge",
        ]
          .filter(Boolean).join(", ");
        readLines.push(
          `| ${
            short(merge.sha)
          } | #${number} | ${r.id} | ${r.created_at} | ${r.updated_at} | ${r.hash} | ${flags} |`,
        );
      }
    }
    apiNote = `API half read ${toRead.length} of the last ${window.length} merge(s) `
      + `(${
        window.length - toRead.length
      } exempt: owner-directed, accepted or not a two-parent merge)`;
  }

  if (readLines.length > 0) {
    const table = [
      "### check:merge-record: comments read",
      "",
      "| merge | PR | comment | created_at | updated_at | body hash | notes |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...readLines,
      "",
    ].join("\n");
    console.log(table);
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, table + "\n");
    }
  }

  const byMerge = new Map();
  for (const f of [...gitFindings, ...apiFindings]) {
    if (accepted.has(f.merge.sha)) continue;
    const entry = byMerge.get(f.merge.sha) ?? { merge: f.merge, items: [] };
    entry.items.push(...f.items);
    byMerge.set(f.merge.sha, entry);
  }

  const total = byMerge.size + staleRows.length;
  if (total === 0) {
    console.log(
      `check:merge-record: OK -- ${merges.length} merge(s) from ${short(since)} to ${tip} `
        + `hold the record (${accepted.size} baseline row(s)). ${apiNote}.`,
    );
    return 0;
  }

  console.error(
    `check:merge-record: FAIL -- ${total} finding(s) over ${merges.length} merge(s). ${apiNote}.`,
  );
  for (const { merge, items } of byMerge.values()) {
    console.error(`\n  ${short(merge.sha)} ${merge.subject}`);
    for (const i of items) console.error(`    [${i.half}] ${i.rule}: ${i.why}`);
    const title = `merge-record: ${items.map((i) => i.rule).join(", ")} on ${short(merge.sha)}`;
    const detail = items.map((i) => `${i.rule}: ${i.why}`).join("; ");
    console.error(
      "    file it: node barwise/scripts/beads-crud.mjs create "
        + `--title ${shq(title)} --type bug --labels merge-record `
        + `--description ${shq(`Merge ${merge.sha} (${merge.subject}). ${detail}`)}`,
    );
  }
  for (const sha of staleRows) {
    console.error(
      `\n  baseline row ${short(sha)} names a commit that is not a merge in the range; remove it`,
    );
  }
  console.error(
    "\nA merge cannot be amended. The owner decides whether to revert; to acknowledge one, run "
      + "`npm run check:merge-record -- --write` and set the new row's status to `accepted-by-owner` or "
      + "`tracked:<issue>` with a note (docs/adr/merge-delegation.md).",
  );
  return 1;
}

try {
  process.exit(await main());
} catch (err) {
  // Anything thrown is "could not answer", never a finding: a throw that
  // escaped as exit 1 would blame the history for what the reader missed.
  refuse(err.message);
}
