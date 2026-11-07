# Batch 10: process gates -- merge, plan and review decisions enforced

Status: Draft revised after plan review 2026-11-07

Created: 2026-11-07
Last-updated: 2026-11-07
Tracking: barwise-ym8.gc9 (adr-refactor batch 10), barwise-ym8.2ds,
barwise-ym8.vl9, barwise-ym8.2vy, barwise-ym8.oof, barwise-ym8.n0m,
barwise-ym8.yg7, barwise-ym8.ogi, barwise-ym8.8hq, barwise-ym8.l7d,
barwise-ym8.7y6, barwise-ym8.8ya, barwise-ym8.f9u, barwise-ym8.ehz,
barwise-zdd, barwise-4q0, barwise-x3l, barwise-wzl, barwise-z4h,
barwise-ilb, barwise-j9d
Touches: barwise/docs/adr/merge-delegation.md,
barwise/docs/adr/plan-before-code.md, barwise/docs/adr/review-policy.md,
barwise/docs/adr/probes.json, barwise/docs/adr/tested-in.json,
barwise/docs/ARCHITECTURE.md, REVIEW.md, .claude/settings.json,
.claude/skills/steward/SKILL.md, .claude/skills/pr-review/SKILL.md,
.github/workflows/ci.yml, barwise/package.json, package.json,
barwise/scripts/check-plan-review.mjs, barwise/scripts/lib/spec-reader.mjs,
barwise/scripts/lib/findings.mjs, barwise/scripts/tests/gates.test.mjs,
barwise/scripts/tests/ci-conditions.test.mjs,
+barwise/scripts/check-review-workflows.mjs,
+barwise/scripts/check-spec-form.mjs, +barwise/scripts/check-spec-first.mjs,
+barwise/scripts/check-merge-record.mjs,
+barwise/scripts/hooks/merge-guard.mjs,
+barwise/scripts/lib/merge-record.mjs, +barwise/merge-record-baseline.json,
+barwise/scripts/tests/review-workflows.test.mjs,
+barwise/scripts/tests/spec-form.test.mjs,
+barwise/scripts/tests/spec-first.test.mjs,
+barwise/scripts/tests/merge-record.test.mjs,
+barwise/scripts/tests/merge-guard.test.mjs

## Principle

Batch 10 holds thirteen decisions across three process ADRs
(`merge-delegation`, `plan-before-code`, `review-policy`), each carrying a
gap issue. Every other batch checked a property of files in the tree. These
check what people and agents did: who merged what, on which head, after
which review; which spec a pull request names; which review workflow runs.
The record of an action is not in the tree. Some of it is in git history
(a merge commit's second parent and trailers), some in GitHub (comments,
the pull request body), some nowhere (whether the review was done well).
So the principle at stake is "explicit over implicit" applied to
_evidence_: a process rule is enforceable exactly as far as the action
leaves a record a check can read, and the honest design says which half of
each decision that is.

The plan's enforcers (`adr-refactor.spec.md`, batch 10) were checked
against the code and the live record before being adopted. Eleven could
not fail on the violation they were written for, or would fail on
legitimate work; the corrected forms are below ("Where the plan's
enforcers could not fail"). The three constraints batch 9 learned apply:
a scanner that crosses packages or reads outside a package's turbo inputs
is an uncached script gate, never a package's vitest; a gate that cannot
see its input refuses (exit 2) rather than passing; and a gate entry needs
a probe, or an `unprobed` row that says why.

## The reading this spec starts from (main at d522e899)

- **Every merge is a merge commit, and carries the trailers.** Of the 65
  first-parent commits from #937 (`17918579`, 2026-11-05) to #1000, all 65
  are two-parent merges with `Reviewed-head:` and `Review: merge`, and in
  all 65 `Reviewed-head` equals the second parent. Before #937 there are
  138 merge commits without trailers and 97 single-parent squash commits
  (`git log --first-parent`; the last squash is #868 on 2026-10-29). One
  merge, #983 (`cfff1486`), carries `Owner-directed:` beside both review
  trailers. No merge carries it alone. Measured 2026-11-07 with `git log
  --first-parent --format=...%(trailers:key=...)`.
- **The second parent is the reviewed head, readable from git alone.**
  `Reviewed-head == <merge>^2` is a deterministic check with no API. It
  also makes the pin (decision 2) observable by its outcome: if the head
  moved after the review, the merged head differs from the reviewed one.
  It cannot show whether the agent _passed_ the pin on a merge where the
  head did not move.
- **The verdict comments exist and follow two spellings.** For #945 to
  #1000 (56 pull requests) the issue-comments endpoint returns exactly one
  comment each whose first line is `Review verdict on head <full sha>:
  **merge**.` (49) or `... merge.` without bold (7), posted 2 to 13
  seconds before the merge commit's committer date. #937, #934, #938 and
  #944 (before the 2026-11-06 restatement, #956) have the verdict in
  another spelling (`**Review verdict: merge** on head <sha>`, or an
  8-character head), so a gate with a cutoff at #956 sees none of them and
  one with a cutoff at #937 flags all four. No pull request in that range
  has a verdict other than `merge`, and none has an `Owner-answer:`
  comment (`gh api repos/semantic-praxis/barwise/issues/N/comments`).
- **The margin is seconds, at second resolution.** Comment `created_at`
  and the merge commit's committer date are both GitHub-set and both ISO
  seconds; #1000's are `00:54:46Z` and `00:54:49Z`. A comparison must be
  `comment <= merge`, because the two can share a second.
- **A commit finds its pull request.** `GET /repos/{r}/commits/{sha}/pulls`
  returned #1000 with `head.sha` equal to the merge's second parent, so a
  gate need not parse the agent-written subject (`Merge PR #N`, or
  GitHub's default `Merge pull request #N from ...`).
- **ci.yml runs on push to `main` and on pull requests into it** (`ci.yml`
  lines 3-7), with `cancel-in-progress: true` per ref (lines 9-11). Two
  merges landed 12 seconds apart (#957 and #956) and others 6 seconds
  apart (#964, #965), so a push run can be cancelled by the next, and a
  gate that reads only `github.event.before..sha` loses the first merge's
  range.
- **What a ci.yml step may be, if it is declared.** `check:architecture`
  accepts an `npm run` entry only if a ci.yml step in `barwise/` runs it,
  is not `continue-on-error`, and has a guard `shouldRun` understands that
  runs on every code change (`scripts/lib/adr-judge.mjs:26-44`,
  `scripts/lib/ci-gates.mjs:122-143`). The one event atom understood is
  `github.event_name == 'pull_request'`; `== 'push'` is "not understood",
  which the judge reports as a refusal and `ci:local` as "run it anyway".
  So a push-only gate cannot be declared as a guarded step without
  extending both. A step with no `if:` that reads `GITHUB_EVENT_NAME`
  inside the script needs neither.
- **No hook inspects a merge.** `.claude/settings.json` registers one
  `PreToolUse` hook, matcher `Bash`, `python-uv-guard.mjs`. The GitHub MCP
  merge tool (`mcp__github__merge_pull_request`, parameters `expectedHeadSha`
  and `merge_method`) and `enable_pr_auto_merge` (no SHA parameter at all)
  match nothing. `steward` section 4b (lines 141-175) states the rule.
- **`check:plan-review`** (`scripts/check-plan-review.mjs`, 259 lines)
  reads the `Plan-reviewed:` line at HEAD, parses only its leading hash
  (line 168 region), tests ancestry against every commit changing a
  `Touches:` path, and compares the spec body at the parent of each
  implementation start. It covers only specs the pull request names, whose
  Status claims nothing built at the base. Covering every spec whose
  `Touches:` lists a changed file was tried and withdrawn: shared wiring
  (`ci.yml`, a skill) made unrelated pull requests answer for some Draft
  spec (PR #714, six findings in three rounds; header lines 20-26).
- **`Touches:` completeness, measured.** Over the last 150 first-parent
  merges, 101 name a spec (a changed spec file or a spec file name in a
  branch commit message). 59 of those change at least one path outside the
  named specs' `Touches:` (specs directory and `.beads/` excluded); 24 do
  so for `packages/*/src` alone, mostly barrels and the older
  `iri-identity` work, and the batch 9 spec's own last workstream (#1000)
  changed `verifyOssie.ts` and `writeOssie.ts`, which its `Touches:` does
  not list. Measured 2026-11-07 with an uncommitted script over
  `namedSpecs`, `touches` and `entryPaths` from `lib/spec-reader.mjs`.
- **Package source without a spec, measured.** 90 of the last 300
  first-parent commits change `barwise/packages/*/src`. Of the 88 whose
  pull request body could be read, 83 name a spec (`.spec.md`) in the body,
  a branch commit message or the diff; 5 (#733 to #755, before
  2026-10-24) name none, and none carries `No spec:`. The rule as restated
  would have asked 5.7 percent of package-source pull requests for the
  escape.
- **Open decisions sections, measured.** Of 201 non-archived specs, 75
  have no `## Open decisions` heading and 14 have one with no entry; of
  the 387 entries in the rest, 25 (in 11 specs) lack any of "recommend",
  "resolved", "taken as", "decided", "default". `template.spec.md` does not
  mark the section optional, while `spec-writer` step 4 says to drop
  sections that do not apply. Measured 2026-11-07 over `git ls-files
  barwise/docs/specs` filtered by `inSpecCorpus`.
- **Copilot workflow.** The `request` job's condition is
  `github.event_name == 'workflow_dispatch'` (`copilot-review.yml:112`),
  with the intended condition commented out on the line above, under a
  `PAUSED 2026-10-19` note (lines 3 and 105) that names `barwise-ilb`. The
  tagged tests (`gates.test.mjs:5231, 5537, 5568`) run the job's shell
  against a stub `gh` and pass whether or not the job ever starts. The
  job exits 1 by design when a request does not land (lines ending the
  second step). `ci.yml` does not mention Copilot.
- **The tier.** `lib/review-tiers.mjs` exports `classify`, `tierRows`,
  `isTrivial`, `trivialGlobs` and the glob helpers. Importers outside
  `pr-risk.mjs` and `check-review-tiers.mjs`: `spec-reader.mjs`,
  `plan-scope.mjs` and `check-spec-touches.mjs`, all for `matchesPattern`
  or `patternFault` only. `copilot-review.yml` calls `pr-risk.mjs --json`,
  decides on `.trivial` and prints `.tier`. Nothing gates on the tier.
- **REVIEW.md's lane table** (lines 17-23) says the CI row runs "Every
  push"; `ci.yml` runs on pushes to `main` and pull requests into it. The
  table has no Copilot row (`barwise-j9d`).
- **Branch protection is not readable from a session.** `barwise-raw`:
  the one ruleset shows deletion and non-fast-forward rules, no required
  check, with the caveat that the token may lack visibility.

## Where the plan's enforcers could not fail

Each of these is the plan's enforcer, and the reason it would not do its
job. The corrected enforcer is in the decision's entry below.

1. **Row 7's gate on "a merge commit with the agent's trailers".** It can
   only fail on a merge that carries trailers. The most likely violation,
   an agent that merges without them, is not in its input; the ADR states
   this limit (an agent's merge cannot be told from the owner's). On this
   history the limit has not bitten: 65 of 65 merges since #937 carry
   them. A gate that fails on a trailerless merge would fail on the likely
   violation; the owner chose to accept the cost to the owner's manual merges
   (Open decision 1, resolved).
2. **"Opens a tracker issue for the owner."** The gate writes nothing, and
   the tracker is `.beads/issues.jsonl` in the repository, which only a
   commit can change. A gate cannot open one. The mechanism is a printed
   `beads-crud create` command and a baseline row (below), not a write.
3. **Row 9's "a non-driving reviewer never approves or merges".** Nothing
   distinguishes the reviewer; every action shows the owner's login. The
   second sentence is not checkable; the owner moved it to Consequences (Open
   decision 7, resolved).
4. **Row 20's "two verdicts other than `merge`".** No non-`merge` verdict
   has ever been posted as a comment (0 of 56), because `pr-review` section
   6 and `steward` 4b ask only for the verdict before the merge. A gate
   counting them sees zero and passes on any history. It needs the skills
   to post every verdict; even then its other three conditions are
   unreadable or already covered (below).
5. **`pinned-merge`'s "closed-PR workflow checking the SHA comment".** The
   gap issue describes a post-merge comment the ADR no longer asks for
   (decision 1 now asks for the comment _before_). And a pin omitted on a
   merge where the head did not move leaves no trace in the record. Only
   the hook sees the call.
6. **`plan-reviewed`'s "match diffs against merged specs' Touches:".** Tried
   and withdrawn in PR #714 (above). The corrected enforcer closes the
   gap's other halves.
7. **`touches-named`'s "plan-scope --check mode".** It would have failed 59
   of 101 spec-naming merges. It is the shadow the `plan-scope` spec
   refused to gate on.
8. **`copilot-requested`'s "job triggers on pull_request".** Red on main
   today, by the owner's pause. It could only land if the pause were lifted
   in the same change.
9. **`copilot-never-blocks`'s "it cannot fail a run".** The workflow fails
   by design when a request does not land, and `copilot-requested` relies
   on that. The optional `gh api` branch-protection read needs admin the
   session lacks (`barwise-raw`).
10. **Row 16's "the table names every review lane".** "Every lane" has no
    list in the tree to check against; `/security-review` and the Claude
    Code Review service have no file. Without a declared list the check
    can only pass.
11. **Row 14's "names the spec ... in its body".** The body is not in git.
    A check that reads commit messages only fails every body-only
    declaration; one that skips an unreadable body passes on its absence.

## Decision by decision

"Tests" means node tests or vitest carrying `[adr:<adr>#<id>]`, held in CI
by `check:adr-tests`. Each entry gives what holds the decision now, the
enforcer, whether the decision's wording changes, the planted violation,
and what happens to the gap issue. Only the owner's recorded restatements
(rows 7, 8, 9, 14, 15, 16, 20) are decided; every other wording change is
an Open decision.

### merge-delegation

The four review-trailer decisions share one gate and one hook. The gate,
`check:merge-record` (`scripts/check-merge-record.mjs`, with its reader in
`scripts/lib/merge-record.mjs`), has two halves in one script.

**The git half** reads the first-parent merges from a fixed cutoff to the
tip, with no network. It runs on every CI event and in `ci:local`, so a
bad merge is seen wherever the history is. The tip is
`BASE_SHA` on a pull request (the base commit the existing `Base of the
merge under test` step computes, not the synthetic merge commit, which
has no trailers), `HEAD` on a push, `origin/main` locally. For each commit
`M` it requires:

- `M` has two parents. A single-parent first-parent commit is a squash,
  rebase or direct push; it has no merged head to compare, and is a
  finding unless it carries `Owner-directed:`.
- `Reviewed-head` is 40 hex and equals `M^2`; `Review` is exactly `merge`.
  Either trailer without the other is a finding.
- `Owner-directed:` is non-empty text. With it, the review trailers are
  optional (as #983 shows, both may appear) and, if present, must still
  satisfy the line above.
- A merge with none of the three is a finding (Open decision 1, resolved
  by the owner: a trailerless merge is a finding, and the owner's own
  manual merges are accepted by baseline rows).

**The API half** runs only when `GITHUB_EVENT_NAME` is `push` and reads
GitHub; elsewhere it prints that it did not run, so a local pass is
understood to be the git half. For each of the last 30 first-parent merges
(a window, not `before..after`; see the cancellation fact above) it finds
the pull request by `commits/{sha}/pulls`, reads the issue comments, and
requires, for a merge without an `Owner-directed:` trailer:

- The latest verdict comment naming the merged head (a 7 to 40 hex prefix
  of `M^2`) and posted at or before `M`'s committer date has verdict
  `merge`. The comment grammar is the first line
  `**?Review verdict on head <hex>**?: **?<verdict>**?.`, bold optional, the
  verdict one of the five in `pr-review` section 6. Both spellings in the
  corpus above match; the 2026-11-05 spellings do not, and sit before the
  cutoff.
- Row 20: the verdict comments after the last `Owner-answer:` comment,
  at or before `M`; two or more with verdict other than `merge` is a
  finding.

A merge carrying `Owner-directed:` is exempt from both comment rules,
exactly as the git half exempts it from the review trailers (decision 5:
the trailer stands "in place of" the review trailers, and the owner's
instruction needs no verdict). It still gets the git half's form check
(non-empty text). Without this the API half would flag the merges the
git half accepts.

It records, in the job summary, each comment it read: id, `created_at`,
`updated_at`, and a hash of the body. **Edits.** Measured 2026-11-07 over
the 56 verdict comments of #945 to #1000: 54 have `updated_at` equal to
`created_at`; #966's was edited 3 seconds before the merge and #969's 27
seconds after it (`gh api repos/semantic-praxis/barwise/issues/N/comments`).
The API keeps no edit history, so the gate cannot read what a comment said
at the merge. A comment edited after the merge is therefore _reported_ in
the job summary and is neither a finding (it could be a typo fix, and the
gate cannot tell) nor a refusal (that would blind the gate on #969 for
good); a rewrite that fakes a verdict is the evasion the ADR's stated
limit puts out of reach. The gate judges the body it reads, and the
summary lets a reader see which verdicts rest on an edited comment.

**How it gets data in CI.** The step sets `GITHUB_TOKEN:
${{ secrets.GITHUB_TOKEN }}` and the script calls the REST API with
Node's global `fetch` (`GITHUB_API_URL`, `GITHUB_REPOSITORY`), not `gh`,
so a test can stub it as `copilot-review`'s tests stub `gh` and no tool
is assumed on the runner. The job needs `issues: read` and
`pull-requests: read`; ci.yml sets no `permissions:` today, so the
default token's scope is a repository setting this spec cannot see
(unverified; WS6 sets explicit job-level permissions if it differs).

**How it refuses.** Exit 2, never 1, when: the token or repository is
missing on a push event; any response is not 2xx; the network fails;
`x-ratelimit-remaining` is 0 or the status is 403/429; pagination does not
terminate (a `Link: rel="next"` still present after the page cap); a
merge's pull-request lookup returns more than one pull request (ambiguous
head); the clone is shallow; `git` fails. The refusal names which read
failed. Exit 1 is only a finding. It never writes, never reverts.

**Pull requests or pushes.** The git half runs on both. The API half is
pushes to `main` only, because the merge does not exist on a pull request
and the comment is posted after CI is green (`steward` 4b: review the
green head, post, merge): a pull-request check for the comment would be red
until the very step it precedes and would not re-run on a comment. The
API half is therefore detective, after the merge. The preventive reader of
the same comment is the hook below.

**What a finding does.** It prints the merge, the rule and the exact
command that files the issue
(`node barwise/scripts/beads-crud.mjs create --title ... --labels
merge-record`). The owner decides whether to revert. A merge cannot be
amended, so a finding on history is permanent unless acknowledged:
`barwise/merge-record-baseline.json` keys a row by merge SHA with
`tracked:<issue>` or `accepted-by-owner` and a note, written through
`baseline-merge.mjs`, and read by `check:findings` through a sixth adapter
in `lib/findings.mjs` (the open row must name an open issue; the common
reader already enforces that for the five baselines). Without it, one bad
merge reds every later pull request, as the git half reads all history
since the cutoff.

**Under `fault-matrix` and `ci:local`.** The matrix's CI step runs on pull
requests only, with `BASE_SHA` in its `env` (`ci.yml:627-630`), and the
gates inherit that environment (`fault-matrix.mjs`, `run()`). For
`check:merge-record` that is enough: `GITHUB_EVENT_NAME` is
`pull_request` there, so only the git half runs, from `BASE_SHA`, and the
matrix's git-fault and cwd axes judge it. The API half is never exercised
by the matrix, and nothing in the matrix needs `GITHUB_TOKEN`; no
`MATRIX_EXCEPTIONS` entry and no matrix `env` change. `ci:local` sets
neither variable, so it runs the git half from `origin/main`.

**The cutoff.** A constant `MERGE_RECORD_SINCE` in `lib/merge-record.mjs`,
the merge commit of PR #956 (`21075c41`, the restatement of rows 7, 8, 9
and 20 into the ADR). Between #937 and #956 the trailers existed but the
comment spellings did not agree, so a cutoff at #937 flags four merges that
followed the practice of the day.

**The hook** (`scripts/hooks/merge-guard.mjs`, registered in
`.claude/settings.json`) is the preventive half, beside `python-uv-guard`.
It matches the GitHub merge tool, `enable_pr_auto_merge`, `gh pr merge` and
`gh api ... pulls/N/merge`. For a merge it requires `expectedHeadSha` or
`--match-head-commit` (decision 2); requires the merge method to be
`merge`, because a squash or rebase produces a commit with no second
parent and no trailers, which the pin and the git half cannot then
check (the tool's `merge_method` must be present and equal `merge`,
since an omitted value leaves the method to a default this spec has not
verified; `gh pr merge` must carry `--merge` or `-m` and neither
`--squash`/`-s` nor `--rebase`/`-r`; `gh api` must set `merge_method=merge`);
refuses auto-merge outright (`enable_pr_auto_merge`, `gh pr merge --auto`),
since it merges whatever head arrives later and cannot carry a pin; and reads the
pull request's comments with the session's own credentials, requiring a
verdict comment naming the pinned SHA with verdict `merge` unless the merge
message carries `Owner-directed:`. Hook exit codes follow Claude Code's
contract (2 blocks, others show): here an unreadable API blocks (exit 2),
because the merge itself needs the same API, so blocking loses nothing,
unlike `python-uv-guard`, where blocking every command on a harness change
would. The hook reaches only sessions that load `.claude/settings.json`;
that is the limit `barwise-zdd` records, narrowed here to "a session that
disables or never loads project hooks".

**`review-before-merge`** (row 7, owner-restated). Now: nothing. Enforcer:
the git half (`Reviewed-head == M^2`, trailer shape), the API half (the
verdict comment) and the hook. Wording: unchanged. Plants: a merge commit
whose `Reviewed-head` names its first parent -> git half exits 1; a merge
with the right trailers and no verdict comment (stub API returns none) ->
API half exits 1; a verdict comment dated after the merge -> exit 1; the
stub returning 403 -> exit 2 and no finding; a merge with `Owner-directed:`
and no verdict comment (stub returns none) -> API half exits 0, the same
merge without the trailer -> exit 1; a hook call to the merge tool with no
verdict comment -> exit 2. All are `tempRepo()` histories and a
stubbed `fetch`, not working-tree probes, so the `probes.json` row is
`unprobed` with that reason, as `check:plan-review`'s is. Header gains
`npm run check:merge-record (review-before-merge, no-size-exemption,
owner-overrides, ask-owner)` and `tests (pinned-merge)`. Gap issue:
`barwise-ym8.2ds` closes; `barwise-zdd` closes (the hook and gate exist);
`barwise-4q0` stays (identity), and the ADR's stated limit moves unchanged
into Consequences.

**`pinned-merge`** (decision 2). Now: nothing; the ADR's header names
`barwise-ym8.vl9` and the gap issue describes a post-merge comment the
current text no longer asks for (the issue is corrected when it is closed).
Enforcer: the hook, tagged `tests (pinned-merge)`: a test per refusal
(merge call without `expectedHeadSha`; with `merge_method` `squash`,
`rebase` or absent; `gh pr merge` without `--match-head-commit`, with
`--squash`, `--rebase` or `--auto`; auto-merge; `gh api` merge; an allowed
pinned `merge` call),
plus a test that `.claude/settings.json` registers the hook with a matcher
covering the MCP merge tool and `Bash`. The registration test is the one
that goes red if the hook is unwired; `tested-in.json` gets a row naming
both test files. The git half is the outcome check (a moved head shows as
`Reviewed-head != M^2`). Wording: unchanged. Plant: delete the
`expectedHeadSha` check from the hook -> the refusal test fails; remove the
settings entry -> the registration test fails. Gap `vl9` closes.

**`no-size-exemption`** (row 8, owner-restated). Now: nothing. Enforcer:
the same gate, which has no path logic at all; the tagged test builds a
tracker-only merge (a diff of `.beads/issues.jsonl` alone) without
trailers and a docs-only one, and requires a finding for each. That the
gate contains no exemption is a property of its code, so the test also
runs the same merge with a code diff and requires the same result. The
three tracker-only merges the owner named (#930, #933, #936) predate the
cutoff and are not re-flagged. Plant: add `if (onlyTracker(M)) continue;`
-> the tagged test fails. Gap `2vy` closes.

**`ask-owner`** (row 20, kept as a decision). Now: nothing. Enforcer: the
API half's count (above), and it is the weakest of the four, for the
reasons in "Where the plan's enforcers could not fail" 4. Its four
conditions: (a) `cannot tell` and (b) `code-review unavailable` are
caught by row 7, because a merge needs the verdict naming the merged head
to be `merge`; (c) "the body leaves an unanswered owner decision" is not
checkable and stays prose; (d) two non-`merge` verdicts is checked only
over verdicts that were posted. WS6 therefore also edits `pr-review`
section 6 and `steward` 4b to post _every_ verdict, not only the one
before the merge (a skill edit, not a decision edit), and the gate counts
the ones it can see. Plant: a stub PR with two `do not merge` comments, a
`merge` comment and no `Owner-directed:` -> exit 1; the same with an
`Owner-answer:` comment between the second `do not merge` and the `merge`
-> exit 0. Wording: unchanged. Gap `oof` narrows, to (c) and verdicts
never posted, and stays open.

**`owner-overrides`** (row 9, owner-restated). Now: nothing. Enforcer: the
git half's `Owner-directed:` form rule (non-empty) and its standing in for
the review trailers. The audit (a model reads the session transcript for
the instruction) is the owner's non-CI lane and is not built here (Non-
goals). Plant: `Owner-directed:` with empty text and no review trailers ->
exit 1. The second sentence ("a reviewer who is not the driving agent
recommends, and never approves or merges") cannot fail any check while
every action shows the owner's login. **Resolved (owner; Open decision 7):**
it moves to Consequences, where the ADR already says it is not checkable,
and decision 5 keeps the `Owner-directed:` sentence. Gap `n0m` closes.

### plan-before-code

**`spec-first`** (row 14, owner-restated). Now: nothing; `plan-scope`
reports and never fails, by the owner's earlier decision, which row 14
replaced with a declared escape. Enforcer: `check:spec-first`
(`scripts/check-spec-first.mjs`), a `pull_request`-only ci.yml step beside
`check:plan-review`, with `BASE_SHA` and `PR_BODY`. It fails a pull
request that changes any `barwise/packages/*/src/**` path (three-dot diff
`base...HEAD`, committed state, as `check:plan-review` reads it) when
neither the body nor any branch commit message contains (a) the file name
of a spec in the corpus, resolved the way `namedSpecs` resolves it, or (b)
a line starting `No spec:` followed by non-whitespace text. A diff that
adds or changes a spec file counts as naming it. The reason after `No
spec:` is never read.

**How it reads the PR body in CI.** From the event payload, not the API:
the step sets `PR_BODY: ${{ github.event.pull_request.body }}` through
`env` (never interpolated into the shell, as `copilot-review.yml` does),
and the script reads `process.env.PR_BODY`. A null body arrives as an empty
string, which is a body that names nothing, not a missing input. Two
properties follow. A body edited after the run is not seen until the next
run: the default `pull_request` types are `opened`, `synchronize` and
`reopened`, so WS3 adds `edited` to ci.yml's `types` (Open decision 9),
and a manual re-run of a job reuses the original payload, so a re-run
alone does not help.

**Locally, and under `fault-matrix`.** `ci:local` sets neither `BASE_SHA`
nor `PR_BODY` (it does not mention `BASE_SHA` at all; `check:plan-review`
falls back to `origin/main`, and `check-spec-first` does the same). The
step's `github.event_name == 'pull_request'` guard reads as true locally
(`shouldRun`, `ci-gates.mjs:122-143`), so the gate runs in every pre-push.
`.husky/pre-push` turns a `ci:local` status of 2 into exit 1 and blocks
the push ("`git push --no-verify`" is the only way past), so a refusal for
a missing body would block every push that changes package source and
names no spec in a commit message, before any pull request exists to
carry a body. The script therefore reads the environment it is in:

- `GITHUB_ACTIONS` unset (a local run): after the git reads, when package
  source changed and the commit messages name nothing, it prints
  `check:spec-first: NOT CHECKED -- no pull request body in a local run;
  CI reads it` and exits 0. It never prints `OK`.
- `GITHUB_ACTIONS` set (CI) and `PR_BODY` unset: exit 2. In CI the body
  always exists (empty when null), so an unset variable is a wiring fault.
- Any git failure, a shallow clone, or an unresolvable base: exit 2 in
  both, and these are read before the body, so a local run still refuses
  where it cannot see the diff.

This is a declared scope, printed in its own words, not a pass over input
it could not see: the refusal contract forbids printing PASS for input the
gate could not read, and this prints that it did not read it. The
alternative that preserves the contract literally (exit 2 locally) blocks
pushes, which is the worse failure for a check the author can satisfy only
after the pull request exists. Under `fault-matrix` the CI step passes only
`BASE_SHA` (`ci.yml:627-630`), so the gate would exit 2 on its unfaulted
baseline reading ("CI, no `PR_BODY`") and the matrix would refuse. The
choice is to add `PR_BODY: ${{ github.event.pull_request.body }}` to that
step's `env` rather than list `check:spec-first` in `MATRIX_EXCEPTIONS`
(`lib/ci-gates.mjs:32`): the exceptions are for steps that are not gates or
that call a registry, the matrix's git-fault and cwd axes are exactly what
this gate's diff and shallow-clone reads need, and the body travels through
`env`, never the shell. The cost is one line in `ci.yml` and a body that is
untrusted data in a process environment, as in `check:spec-first` itself.

Plants: package source changed, body and commits silent, `GITHUB_ACTIONS`
set -> exit 1; a `No spec:` line with no text -> exit 1; a body naming
`nothing.spec.md` that is in no corpus -> exit 1; the body in `PR_BODY` ->
exit 0; `PR_BODY` unset with `GITHUB_ACTIONS` set -> exit 2; `GITHUB_ACTIONS`
unset and commits silent -> exit 0 with `NOT CHECKED` and no `OK`; a
shallow clone in either mode -> exit 2. Working-tree probes cannot reach it
(committed state plus an environment variable), so `probes.json` takes an
`unprobed` row. Wording: unchanged. Gap `yg7` closes. Shadow stated:
`No spec: n/a` passes. The owner chose presence and form over a stricter
rule, and over retirement; the gate catches forgetting, which the 5-in-88
history shows is the failure.

**`plan-reviewed`** (decision 2). Now: `check:plan-review` holds the
named-spec, first-workstream, `Touches:`-overlap case (probe `unprobed`).
Three of the gap's holes are checkable and one is not:

- _The line is read at HEAD, so it can be added after the implementation_
  (`barwise-wzl` 1). The ADR says the line is "committed before any
  implementation commit". Enforcer: the commit that first introduced a
  `Plan-reviewed:` header line into the spec (found by walking the spec's
  commits with `git log --reverse --format=%H -- <spec>` and reading the
  header at each) must be an ancestor of the first implementing commit, or
  the same commit as the reviewed one. Plant: a branch that adds the line
  in the implementation commit, naming an earlier commit -> exit 1.
- _Review names are not checked_ (`wzl` 2). The parenthetical must be
  name both reviews, `code-review` and `pr-review`, as words, with
  anything else allowed after them. An exact `(code-review, pr-review)`
  match was the first draft and is wrong: seven specs carry a re-point or
  review annotation after the names (`architecture-index`,
  `capability-matrix-check`, `executable-adrs`, `python-uv-widened`,
  `surface-mirroring` and `touches-required` write `(code-review,
  pr-review; re-pointed ...)`; `iri-identity` writes `(pr-review x5,
  code-review x3; re-pointed ...)`, so "starts with `code-review,
  pr-review`" would also reject it). Checking for both words, in any
  order, accepts all seven. This is a form check; it does not show the
  reviews ran, which the ADR already says no gate can. Plants: `(code-review)`
  alone -> exit 1; `(code-review, pr-review; re-pointed after WS2)` ->
  exit 0; `(pr-review x2, code-review x1; note)` -> exit 0.
- _A spec that lists one path can implement others unreviewed_ (`x3l`).
  The remedy the plan proposed is the withdrawn #714 design. Not built.
  `x3l`'s other half, that a Status claiming some work built takes the spec
  out of coverage, has no clean fix: the Status is exactly what a
  multi-workstream spec updates as it goes, and `architecture-index.spec.md`
  shows the cost. Left open.
- _Plan edits after implementation begins are never compared_ (`wzl` 3).
  A gate that compared the HEAD body to the reviewed body would fail every
  spec that folds implementation notes in, which `spec-writer` step 8
  tells authors to do. The ADR's last sentence ("a plan edited afterwards
  needs the review again") disagrees with that practice and with the
  gate's own reading ("the plan as implementation began"). **Resolved
  (owner; Open decision 5):** decision 2's last sentence is restated to "a
  plan edited before implementation begins needs the review again"; this
  item closes with the wording and the gate is unchanged.

The two checkable items go into `check:plan-review` (`wzl` 1 and 2 close);
its `unprobed` row stays. The stacked-pull-request half of `barwise-z4h`
is moot (CI does not run on a pull request into another branch at all,
`ci.yml:6-7`); the squash half is now a history fact (no squash since
#868). A direct push to `main` is the remaining hole; `check:merge-record`'s
single-parent finding covers it. Gap `ogi` narrows and stays open for
`x3l`; `wzl` closes.

**`touches-named`** (decision 3). Now: `check:spec-touches` holds the new-
spec form (probe in `probes.json`). The gap is completeness: that the list
is the paths actually changed. Measured above: a failing check would fail
59 of 101 spec-naming merges, and 24 on package source alone, including
the most careful recent spec's last workstream. A pull request legitimately
edits baselines, lockfiles, barrels and generated docs the plan did not
list; the check would measure sloppiness of listing, not a defect, and
`plan-scope-check.spec.md` refused it for the same reason. No gate is built.
`plan-scope` stays the report. **Resolved (owner, 2026-11-07; Open
decision 3):** restate decision 3 to what `check:spec-touches` holds ("a new
spec's `Touches:` names at least one tracked path outside the specs
directory"); `8hq` closes. This is the owner's recorded restatement, so the
ADR edit is part of WS4, with the completeness half moved to Consequences as
review's, held by the `plan-scope` report. The existing probe row for
`touches-named` (`probes.json`) stays and already fails the restated text
on its plant.

**`open-decisions-reviewer`** (row 15, owner-restated). Now: nothing.
Enforcer: `check:spec-form` (`scripts/check-spec-form.mjs`) over _new_
specs only, by the same "file name absent at a fixed cutoff commit" rule
`TOUCHES_REQUIRED_SINCE` uses (a second constant,
`OPEN_DECISIONS_REQUIRED_SINCE`, in `lib/spec-reader.mjs`, with the value
`d522e899b585ae19bc7159f74fa1d7b47f6f8226`, the tip of `main` at this
draft, #1000's merge; verify with `git rev-parse d522e899`). It requires an
`## Open decisions` heading and, for each top-level entry (a `- ` or `N. `
item), one of "recommend", "resolved", "taken as", "decided" or "default"
in the entry. A section that says only "None." is accepted, since the
template's instruction to drop sections that do not apply otherwise
contradicts the decision. Existing specs are exempt: 75 lack the heading
today and the sweep that would fix them is `barwise-1007`'s. Which specs that
covers: a spec is new when its file name is absent from the tree at that
commit. `adr-batch9-enforcers.spec.md` is present at `d522e899`, so it is
exempt and a probe planted in it would read as a proxy that cannot fail (the
first draft planted there). This spec, `adr-batch10-enforcers.spec.md`, is
absent at `d522e899` (it arrives on the batch 10 branch), so it is covered,
and so is every spec added after the cutoff, including those added between
this draft and the workstream (the cutoff is fixed, not the merge base).
The `probes.json` row plants in `adr-batch10-enforcers.spec.md`: rename its
`## Open decisions (for review)` heading -> exit 1; delete the cue words from
one entry -> exit 1. A test also checks the cutoff commit resolves and that a
spec file present at it is exempt (a fixture spec with no section passes). Wording: unchanged. The gate holds the
section and the default; "options" and "trade-off" are not machine-
readable, and a decision made silently in the body is review's. Gap `l7d`
narrows to that residue and stays open.

### review-policy

One gate, `check:review-workflows` (`scripts/check-review-workflows.mjs`),
reads `.github/workflows/*.yml` with the `yaml` package (already a root
dependency), `REVIEW.md`, `barwise/scripts/` and the tracker, with four
named rules in one pass as `check:source-sites` does. It is an uncached
script because its inputs cross every package's turbo key. It needs no
`if:` guard: a REVIEW.md edit alone is docs-only to `changed-class`, and
`check:review-tiers` runs unguarded for the same reason.

**`review-md-owns-lanes`** (row 16, owner-restated). Now: nothing. The
rule needs a declared lane list to check "every lane", and the tree has
none. WS1 adds `barwise/review-lanes.json` (`+`): each lane with its
`source` (a workflow file, a skill directory, or `external` with a
reason) and each workflow in `.github/workflows/` that is _not_ a review
lane with the reason (`release.yml`, `tracker-conflicts.yml`). The rule:
every declared lane has a row in REVIEW.md's table and every row names a
declared lane; every workflow file is a declared lane's source or a
declared non-lane (so a new review workflow cannot appear unrecorded);
every `source` path exists; and the CI row's _When_ cell equals the
phrases derived from ci.yml's `on:` block (`Push to main` per `push:
branches: [main]`, `Pull request into main` per `pull_request: branches:
[main]`), compared after normalising case and backticks, so adding
`schedule:` to ci.yml or dropping a branch filter is a finding. Other
lanes' triggers are not compared with `on:`: the Copilot workflow lists
`pull_request_target` while its job runs only on dispatch, so `on:` alone
would pass a lane the job does not serve. The merge lane's timing stays
`merge-delegation.md#review-before-merge`.

The first run finds the known violation: the CI row reads "Every push", and
the table has no Copilot row. The pull request that lands the gate corrects
both rows (the ADR says so; this also closes `barwise-j9d`). Plants
(`probes.json`, `REVIEW.md`): restore "Every push" -> exit 1; delete the
Copilot row -> exit 1; add a workflow file with no declared lane -> exit 1
(test). Wording: unchanged. Gap `f9u` closes; `barwise-16u` and
`barwise-953` are other findings and stay.

**`copilot-requested`** (decision 1). Now: tagged tests on the job's shell
(`gates.test.mjs:5231, 5537, 5568`), which pass while the job never runs.
Enforcer, a second rule in the same gate: the `request` job's `if:` must
admit pull-request events (a non-draft `pull_request_target`), or
`copilot-review.yml` must carry a `PAUSED <date>` declaration that names
a tracker issue, and that issue must exist and be open in
`.beads/issues.jsonl`. Today the file declares `barwise-ilb`, so the gate
is green and states the pause. Resuming deletes the declaration and
restores the `if:`; closing `ilb` without restoring the `if:` goes red, which
is the failure the gap describes (a decision not carried out and tests
that pass). Plants: replace `PAUSED 2026-10-19 by the owner` with `Paused`
-> exit 1; mark `ilb` closed with the job still dispatch-only -> exit 1;
restore the `if:` and drop the note -> exit 0. Wording: unchanged; the
ADR's Consequences already records the pause. Whether a declared pause is
green is Open decision 4. Gap `7y6` closes (`ilb`, `m9q`, `gin` stay).
The two exceptions with no deciding source (`m9q`) are a behaviour
question, not an enforcer one, and the tagged tests keep pinning today's
behaviour for them.

**`copilot-never-blocks`** (decision 2). Now: nothing, "by design".
Enforcer, a third rule: no workflow other than `copilot-review.yml`
mentions the reviewer (`copilot`, case-insensitive), no workflow has a
`workflow_run` trigger naming the Copilot workflow, and no non-test
script reads Copilot's review state. What it holds: that nothing _in the
tree_ waits on Copilot. What it cannot hold: a required status or branch
rule set in repository settings, which is invisible (`barwise-raw`). The
plan's second half (the job "cannot fail a run") is wrong and dropped.
Plants: add a `workflow_run` trigger naming `Copilot review` to `ci.yml`
-> exit 1; add a step reading the Copilot review to `ci.yml` -> exit 1.
Wording: unchanged. Gap `8ya` narrows to the settings half and stays open.

**`tier-informs`** (decision 4). Now: tagged tests that `pr-risk` exits 0
on either tier and prints the routing. Enforcer, a fourth rule: a
declared reader list, each with its reason. A **reader** is matched by code,
not by text, in three places:

- A `.mjs` or `.cjs` file under `barwise/scripts/` outside `tests/`,
  parsed with the TypeScript scanner (as `check:source-sites` parses
  source): an import, export-from, `require` or dynamic import whose
  specifier ends in `review-tiers.mjs`; or a string literal that ends in
  `review-tiers.json` or contains `pr-risk.mjs`. Comments are tokens the
  scanner skips, so a comment naming `pr-risk` is not a reader.
- A workflow, parsed with `yaml` (comments dropped): a step's `run:` or
  `with:` value containing `pr-risk.mjs`, `pr:risk` or `review-tiers`.
- `barwise/package.json` and the root `package.json` `scripts` values
  with the same tokens. `probes.json`, `tested-in.json`, Markdown and
  `review-tiers.json` itself are data and prose, not scanned.

An npm script name in a `run:` (`npm run check:review-tiers`) is resolved
to its `scripts` value, so it counts as the reader it runs, not as a
new one. Run over main at `d522e899` (a scratch script, 2026-11-07), the
matcher finds exactly these readers, which are the declared list, so the
rule is green on main:

| Reader                                                 | How it reads                                         | Allowed because                              |
| ------------------------------------------------------ | ---------------------------------------------------- | -------------------------------------------- |
| `scripts/lib/review-tiers.mjs`                         | the table, as `../review-tiers.json`                 | it is the module                             |
| `scripts/pr-risk.mjs`                                  | imports it                                           | computes and prints the tier                 |
| `scripts/check-review-tiers.mjs`                       | imports it                                           | validates the table against headings         |
| `scripts/lib/spec-reader.mjs`                          | imports `matchesPattern`                             | path-glob helper only                        |
| `scripts/plan-scope.mjs`                               | imports `matchesPattern`                             | path-glob helper only                        |
| `scripts/check-spec-touches.mjs`                       | imports `matchesPattern`, `patternFault`             | path-glob helpers only                       |
| `.github/workflows/copilot-review.yml`                 | runs `pr-risk.mjs --json`; reads `.trivial`, `.tier` | `.trivial` is decision 1; `.tier` is printed |
| `.github/workflows/ci.yml`                             | `npm run check:review-tiers`                         | the table validator above                    |
| `barwise/package.json` `check:review-tiers`, `pr:risk` | scripts that name the two files                      | the two listed scripts                       |
| root `package.json` `check:review-tiers`               | forwarder                                            | generated forwarder                          |

Two further conditions. A reader outside the list is a finding. A listed
reader other than `pr-risk`, `check-review-tiers` and the module itself
that imports a binding other than `matchesPattern` or `patternFault` is a
finding (`classify`, `tierRows`, `isTrivial` are tier-bearing); the
`copilot-review.yml` row also requires that `.tier` appears only as an
argument to `echo` or `printf` and never in a test or `if`. It holds
"nothing else keys on the tier". It does not hold "author and reviewer run every group", which
nothing records (`barwise-953`). Plants (`probes.json`): add `import {
classify } from "./lib/review-tiers.mjs"` to `check-pins.mjs` -> exit 1;
add a ci.yml step running `node barwise/scripts/pr-risk.mjs --json | jq -e
'.tier == "routine"'` -> exit 1 (it is a reader outside the list). Wording:
unchanged. Gap `ehz` closes; `953` and `6mf` stay.

## Alternatives considered

- **One gate per decision.** Each would parse the same workflows or the
  same history and need its own script, step and forwarder. The batch 9
  choice stands: named rules in one pass for the review-policy rules.
  `check:merge-record` is its own script because its input (history,
  GitHub) and its failure modes differ from the file-reading gates.
- **A push-only merge step in ci.yml with an `if:`.** It needs the judge
  and `shouldRun` to learn `github.event_name == 'push'`, and a decision
  on whether a push-only step "runs on every code change". A step with no
  guard that reads `GITHUB_EVENT_NAME` inside the script keeps the judge
  and `ci:local` unchanged, at the cost that the guard is in the script.
  Chosen (owner; Open decision 8).
- **A separate `merge-record.yml` workflow with `cancel-in-progress:
  false`.** It would not lose a range to cancellation, but the judge reads
  only `ci.yml`, so the declaration would need a second reader. A
  30-merge window in ci.yml gives the same coverage.
- **`before..after` for the API half.** Loses a range when a push run is
  cancelled (#956 and #957, 12 seconds apart), and the cancellation is
  per-ref, so even `cancel-in-progress: false` keeps only one pending run.
- **Reading the whole history with the API on every run.** About 56 calls
  now, growing by about 60 a day, on every pull request too. A window
  bounds it.
- **Read the verdict from the merge commit message, not the comments.** The
  agent writes the message; a comment is a separate, earlier record, which
  is why the owner's restatement asked for it.
- **A GitHub review (`APPROVE`) in place of a comment.** `pr-review`
  section 6 explains GitHub rejects `REQUEST_CHANGES` on one's own pull
  request and the agent acts as the owner; an `APPROVED` state is
  indistinguishable from the owner's.
- **A `merge-record` workflow that reverts a bad merge.** The owner's
  restatement forbids it.
- **`edited` plus the live API for the pull-request body.** A live fetch
  makes a manual re-run pick up an edit but adds an API dependency to a
  gate that is otherwise offline; the payload is deterministic and
  reproducible. Chosen with `edited`.
- **A `plan-reviewed` check over every spec listing a changed path.**
  Withdrawn in #714; see above.
- **Gating `touches-named` behind a baseline of existing offenders.** It
  would turn 59 of 101 pull requests into baseline rows and a standing
  tax on legitimate work. Not recommended.

## Workstreams (each independently shippable)

Each workstream ends with the ADR's `Enforced-by:` and Consequences
updated, `ARCHITECTURE.md` regenerated (`npm run regen:architecture`), a
`probes.json` row or `unprobed` reason per gate entry, a PR-body plant line
per tagged decision, `tested-in.json` rows where a decision's tests span
files, and the gap issues narrowed or closed in a tracker-only follow-up.
Each runs `npm run check:architecture`, `npm run test:scripts`, `npm run
adr-probes -- --only <adr>#<id>`, `npm run fault-matrix` and `npm run
ci:local`.

### 1. `check:review-workflows` and `REVIEW.md` (review-policy)

The smallest blast radius: it reads files, writes nothing, needs no
network and no new workflow wiring beyond one unguarded step. The four
rules, `barwise/review-lanes.json`, the two REVIEW.md corrections, probes
for the four decisions and `tests` entries for the lane-table and
non-lane-workflow rules. Closes `f9u`, `7y6`, `ehz`, `j9d`; narrows `8ya`.

### 2. `check:spec-form` (plan-before-code, decision 4)

New-spec rule, one constant in `spec-reader.mjs`, one script, one step.
Narrows `l7d`.

### 3. `check:spec-first` (plan-before-code, decision 1)

The script, `BASE_SHA`/`PR_BODY` wiring, `edited` added to the
`pull_request` types, `PR_BODY` added to the `fault-matrix` step's `env`,
the local `NOT CHECKED` exit 0 (`GITHUB_ACTIONS` unset) against the CI exit 2
(set, no body), and tests in `tempRepo()` for each mode. Closes `yg7`.

### 4. `check:plan-review` hardening and `touches-named` (plan-before-code, decisions 2 and 3)

The line-introduction rule and the review-names form (both words,
annotations allowed), in the existing gate. Decision 2's last sentence
restated to "before implementation begins" (Open decision 5, resolved).
Decision 3 restated to what `check:spec-touches` holds (Open decision 3,
resolved); no new gate. Closes `8hq` and `wzl`; narrows `ogi`.

### 5. The merge hook (merge-delegation, decision 2)

`merge-guard.mjs`, its registration, the refusal tests and the
registration test, `tested-in.json`. Before WS6 so the preventive half is
live when the detective half starts judging. Closes `vl9`. The hook also refuses a `merge_method` other than `merge`.
Provisional:
whether `PreToolUse` fires for MCP tools in this harness, and the exact
tool name in a remote session, are ungrounded (unverified list).

### 6. `check:merge-record` (merge-delegation, decisions 1, 3, 4, 5) (provisional: API half not grounded)

The git half first, with the baseline and its `findings.mjs` adapter; then
the API half behind `GITHUB_EVENT_NAME == push`. The `steward` 4b and
`pr-review` section 6 edits (post every verdict; the finding-filing
command). Closes `2ds`, `2vy`, `zdd`; narrows `oof`. Unlike the
others, this gate's API half is exercised in CI only by a push to `main`,
so its first live run is the merge of its own pull request. Decision 5's
second sentence moves to Consequences (Open decision 7, resolved), which
closes `n0m` with the `Owner-directed:` form rule. Land the git
half and the stub-API tests first, then wire the API half, and read the
first push run's job summary before declaring it done.

## API and migration impact

- Five new scripts and one new lib, one new baseline file, one new
  declared-lane file, one hook. No package source changes; no package
  dependency changes (`fetch` and `yaml` are already available).
- `ci.yml` gains three unguarded steps (`check:review-workflows`,
  `check:spec-form`, `check:merge-record`) and one `pull_request`-guarded
  (`check:spec-first`); `pull_request.types` gains `edited`. The
  `check:merge-record` step needs `GITHUB_TOKEN` and, if the default is
  narrower, job-level `permissions`.
- `barwise/package.json` scripts and the root forwarders
  (`npm run regen:root-package`; `check:root-scripts` fails otherwise).
- `lib/changed-class.mjs`: none of the new gates reads only `.md`
  outside the existing docs-only exceptions except `REVIEW.md`, which the
  unguarded step covers; confirm with `check:review-tiers` that the new
  scripts have rows if required (unverified).
- `check:findings` gains a sixth adapter; the ratchet registry gains
  `merge-record`.
- Skills edited: `steward` 4b, `pr-review` 6, `pr-creation` if it states
  the verdict form.

## Open decisions (for review)

Ten decisions were put to the owner; the owner answered all of them
(2026-11-06 and 2026-11-07), and each is recorded as resolved, with the
text it changes.

1. **Is a trailerless merge a finding?** **Resolved (owner): yes, with
   baseline acceptance rows.** The other option was to check only merges
   that carry trailers, as the plan words it, which cannot fail on the
   likely violation. Each manual owner merge costs an `accepted-by-owner`
   row in `merge-record-baseline.json`.
2. **Where the cutoff sits.** **Resolved (owner): #956** (`21075c41`).
   A cutoff at #937 would flag four merges whose comments use an earlier
   spelling.
3. **`touches-named`.** **Resolved (owner): restate** decision 3 to what
   `check:spec-touches` holds; `8hq` closes; no gate (59 of 101 spec-naming
   merges change a path outside `Touches:`).
4. **Is a declared pause green for `copilot-requested`?** **Resolved
   (owner): yes.** The gate accepts a dispatch-only job with a `PAUSED
   <date>` note naming an open issue, and goes red when the issue closes with
   the job still paused.
5. **Decision 2's last sentence.** **Resolved (owner): restate** to a plan
   edited "before implementation begins". `wzl` 3 closes with the wording;
   the gate keeps comparing the body as implementation began.
6. **Which verdicts are posted.** **Resolved (owner): post every verdict**,
   as a `pr-review` section 6 and `steward` 4b edit.
7. **Decision 5's second sentence** moves to Consequences. **Resolved
   (owner): yes;** `n0m` closes.
8. **How the API half is wired.** **Resolved (owner): an unguarded step**
   that checks the event inside the script; the judge and `shouldRun` are
   not extended.
9. **`edited` in ci.yml's `pull_request` types.** **Resolved (owner):
   add it.**
10. **Which specs `check:spec-form` covers.** **Resolved (owner): new
    specs only,** by the fixed cutoff `d522e899`; the sweep of old specs is
    `barwise-1007`'s.

## Risks and testing

- **A merge-time gate that reds main.** `check:merge-record`'s git half
  reads all history since the cutoff on every pull request. One bad merge
  reds every later run until the baseline row lands. That is the intended
  loudness, with the baseline as the release valve; WS6 tests the
  baseline path (a finding with a row exits 0, a row naming a closed issue
  exits 1 through `check:findings`).
- **The API half cannot be probed in a working tree.** Its planted reds are
  `tempRepo()` histories and a stub `fetch`; the rows are `unprobed`.
  A reviewer should read the stubs' response bodies against the live shape
  (`gh api repos/semantic-praxis/barwise/issues/1000/comments`).
- **Rate limits and flakiness on every push.** About 30 pull-request
  lookups and 30 comment reads per push run (the window), against a
  1000 per hour default token limit and 15,000 for the session token.
  Exit 2 on any limit, never 1.
- **The pause-note rule can rot.** `copilot-requested` accepts a note
  naming an open issue; a closed issue with the job still paused goes red.
  Tested both ways.
- **Hooks are advisory outside the harness.** `merge-guard` stops a session
  that loads project settings; a manual merge, `--no-verify`-style
  bypass, or a session without them is invisible to it. The detective half
  exists for that reason, and the ADR's identity limit (`barwise-4q0`)
  stays.
- **New gates under `fault-matrix`.** `check:review-workflows`,
  `check:spec-form`, `check:spec-first` and `check:merge-record` join the
  matrix's git-fault and three-directory axes automatically as ci.yml
  steps; `check:merge-record`'s git half and `check:spec-first` must each
  exit 2 under a shallow clone. The matrix's CI step carries only
  `BASE_SHA`: `check:spec-first` gets `PR_BODY` added to it and
  `check:merge-record` needs nothing (see their entries). Unverified
  until `npm run fault-matrix` runs on a branch.
- **Self-checks.** Each reader has positive and negative self-cases and
  refuses on zero merges read (`MERGE_RECORD_SINCE` must resolve and the
  range be non-empty), zero workflows read, zero specs read.
- **Docs-only skips.** `check:review-workflows` and `check:spec-form` run
  unguarded because their inputs are Markdown or workflow files; the other
  two have their own event guards. `GATE_INPUT` in `changed-class.mjs`
  needs `REVIEW.md` only if a docs-only skip were added, which this spec
  does not add.

## Non-goals

- Not the audit (an independent model re-runs `pr-review` on a sample of
  merged heads; a model reads transcripts for `Owner-directed`). It is
  non-deterministic and outside CI by the owner's design; it needs its own
  spec and a tracker issue, and it is not built or filed here.
- Not an agent identity (`barwise-4q0`), branch protection or required
  checks (`barwise-raw`), or resuming the Copilot request (`barwise-ilb`).
- Not the two Copilot exceptions (`barwise-m9q`) or the quota-reset backfill
  (`barwise-gin`).
- Not the `/security-review` routing (`barwise-16u`) or any record that a
  checklist group ran (`barwise-953`, `barwise-6mf`).
- Not a sweep of old specs for Open decisions (`barwise-1007`) or `Touches:`.
- No change to what a decision decides beyond the owner-restated rows and
  the Open decisions above.

## Unverified claims

Each is a claim this draft makes and has not run to ground.

- `PreToolUse` hooks fire for MCP tool calls (`mcp__github__merge_pull_request`)
  in this harness. A reviewer registers a hook that blocks that matcher
  and tries a merge on a scratch pull request; WS5 does not start without
  it.
- The default `GITHUB_TOKEN` in ci.yml can read issue comments. A reviewer
  runs one push-triggered step that prints the status of `curl -s -o
  /dev/null -w '%{http_code}' -H "Authorization: Bearer $GITHUB_TOKEN"
  $GITHUB_API_URL/repos/$GITHUB_REPOSITORY/issues/1000/comments`.
- Edits: 2 of the 56 verdict comments have `updated_at` after `created_at`
  (#966 before the merge, #969 after it); recheck with `gh api
  repos/semantic-praxis/barwise/issues/N/comments --jq '.[] |
  select(.updated_at != .created_at)'` per pull request. What the edited
  bodies said at the merge is not recoverable from the API.
- That `merge_method` omitted would not default to `merge` in the MCP
  tool: the spec requires it present, so the default is not relied on.
- That `.husky/pre-push` status handling is as read here (status 2 becomes
  exit 1): read from `barwise/.husky/pre-push` in this checkout.
- `commits/{sha}/pulls` returns exactly one pull request for every merge
  since #956: `gh api repos/semantic-praxis/barwise/commits/<sha>/pulls
  --jq length`. Checked for #1000 only.
- The measurements (65 of 65 trailered, 56 comments, 59 of 101, 5 of 88,
  75 of 201) were made with uncommitted scripts on 2026-11-07. A reviewer
  repeats the trailer one with `git log --first-parent
  --format='%H %(trailers:key=Reviewed-head,valueonly)' 17918579^..HEAD`
  and the specs one with `git ls-files barwise/docs/specs | xargs grep -L
  '^## Open decisions'`.
- `ci:local`'s pre-push use treats exit 2 as non-blocking. `.husky/` is not
  in this checkout; a reviewer reads the installed hook after `npm run
  prepare`.
- The judge accepts an unguarded step whose script reads
  `GITHUB_EVENT_NAME`: `npm run check:architecture` after WS6's
  declaration.
- `check:review-tiers` needs rows for the new scripts: run it after WS1.
- The default branch's protection and whether `ci` is required
  (`barwise-raw`): an owner reads the repository settings.
