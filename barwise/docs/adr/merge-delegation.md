# Merge delegation

Scope: process
Date: 2026-10-18
Tracking: barwise-zdd, barwise-4q0, barwise-raw, docs/specs/steward-skill.spec.md,
docs/specs/pr-skills.spec.md
Enforced-by: npm run check:merge-record (review-before-merge,
no-size-exemption, owner-overrides, ask-owner), tests (pinned-merge),
none (barwise-ym8.oof: ask-owner)

## Context

Most pull requests here are opened and driven by agents, and the owner
holds the merge decision and its accountability. On 2026-10-18 the
owner delegated merging to the agent driving a pull request, on one
condition, after PR #679 closed two issues and merged with no review at
all. The condition is stated in the `steward` skill, section 4b, and
pointed at by the root `CLAUDE.md` conventions; why it is the one
permission rule in that skill is in `steward-skill.spec.md`, and the
review it depends on is defined in `pr-skills.spec.md`. Which reviews
run on which changes is a separate decision, owned by the root
`REVIEW.md`; this one says only who may merge and on what condition.

## Decision

1. **Before the agent driving a pull request merges it, a comment on the
   pull request names the head being merged and the `pr-review` verdict
   on that head.**{#review-before-merge} Only `merge` licenses the
   merge, and the merge commit carries `Reviewed-head: <sha>` and
   `Review: merge` trailers. `pr-review` runs `/code-review` as its
   correctness engine; its verdicts are `merge`, `merge after`, `do not
   merge`, `cannot tell` and `code-review unavailable`, so every
   condition decision 4 names is in the record.
2. **The merge is pinned to the reviewed commit.**{#pinned-merge} The
   agent merges with that SHA as the expected head (`expectedHeadSha`,
   or `gh pr merge --match-head-commit`), so a later push is refused
   rather than merged. Any push after the review needs a new review.
3. **Decision 1's verdict comment and trailers are required on every
   pull request, tracker-only and docs-only included.**{#no-size-exemption}
4. **The agent asks the owner instead of merging**{#ask-owner} when the
   verdict is `cannot tell` or `code-review unavailable`, when the pull
   request's body leaves the owner a decision not yet answered, or after
   two verdicts on the pull request other than `merge`. The agent posts
   the owner's answer as an `Owner-answer:` comment quoting it; the
   answer decides, and only the verdicts after the last such comment
   count.
5. **When the owner says to merge a pull request, the agent merges it
   with an `Owner-directed:` trailer in place of the review
   trailers.**{#owner-overrides}

## Consequences

- The decisions were restated on 2026-11-06 (`adr-refactor.spec.md`,
  rows 7, 8, 9 and 20) so each names a record a check can read: the
  verdict comment, the merge commit's trailers, and the
  `Owner-answer:` comment. Before that, decision 1 asked for the
  review in the session and decision 2 for a comment after the merge,
  so whether the review ran could not be read from the record. An
  independent re-run of `pr-review` on sampled merged heads is the
  audit, reported and never gated.
- `npm run check:merge-record` reads that record (batch 10 of that
  spec). Its git half reads every first-parent merge from the merge of
  PR #956 (the first whose comment spelling the gate reads) on every CI
  event: two parents; `Reviewed-head` equal to the second parent and
  `Review: merge`; or an `Owner-directed:` trailer with text, with
  which the review trailers are optional and, if present, still hold. A
  merge with none of the three is a finding, so the owner's own manual
  merges need a row in `barwise/merge-record-baseline.json`
  (`accepted-by-owner` or `tracked:<issue>`, with a note), because a
  merge cannot be amended. Its API half runs on pushes to `main` only
  and is detective: for the last 30 merges without `Owner-directed:`
  it requires a verdict comment naming the merged head, dated at or
  before the merge, saying `merge`, and no two non-`merge` verdicts
  after the last `Owner-answer:`. Every verdict is posted, not only the
  one before the merge, or that count sees none. It cannot read what a
  comment said at the merge, since the API keeps no edit history: a
  comment edited after the merge is reported in the job summary and is
  not a finding. A 403, a rate limit or an unreachable API is exit 2,
  never a finding.
- The `merge-guard` hook is the preventive half (decision 2, tested):
  it refuses a merge call with no head pin, a method other than
  `merge`, auto-merge, or no `merge` verdict comment on the pinned
  head, in a session that loads `.claude/settings.json`. A session that
  never loads project hooks or `steward` can still merge without the
  review, as #679 did before section 4b existed; the git half is what
  sees it afterwards.
- Decision 2's pin holds only when the agent passes the SHA; GitHub then
  refuses a merge whose head has moved. The hook requires the pin; a
  moved head shows afterwards as `Reviewed-head` not equal to the second
  parent.
- A reviewer who is not the driving agent recommends, and never approves
  or merges. Nothing can check this: every action shows the owner's
  login (barwise-4q0), so no gate tells the reviewer's merge from the
  owner's. It moved here from decision 5, which keeps the
  `Owner-directed:` sentence the record can show.
- An agent's merge cannot be told from the owner's: a session acts as
  the owner, so every merge shows the owner's login, and the owner may
  merge without the comment decision 1 asks of the agent. The trailers
  mark the merges the agent claims, so the record shows whether those
  followed the rule; an agent's merge with no trailer at all still reads
  as the owner's, and nothing can tell the two apart (barwise-4q0).
- Whether `main` requires the `ci` check is unsettled: `steward`
  section 4a says it does, and the rulesets a session can read show only
  deletion and non-fast-forward rules (barwise-raw). This ADR's
  condition does not include CI, because neither source states it.
- The two-review cap in decision 4 governs reviews before a merge. The
  local `/code-review` loop before a pull request opens still has no
  stopping rule (barwise-q93).
- Left to the owner as approval policy, and not decided here
  (`review-md.spec.md`, the rows marked owner): section 4b sets no risk
  tier limit, so the agent may merge a pull request of any tier, and an
  open finding blocks a merge only by convention, because blocking needs
  branch protection.
- The condition vouches that the review recommended `merge` on that
  head. It cannot show the review was done well; that is `pr-review`'s
  own discipline.
- Until they are replaced with links (barwise-5h3; the root `CLAUDE.md` states
  the rule in one line with a link since architecture-index WS5), `steward`
  section 4b, the `pr-review` skill, `REVIEW.md` and `pr-creation`
  also state parts of this rule.
