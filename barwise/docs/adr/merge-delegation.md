# Merge delegation

Scope: process
Date: 2026-10-18
Tracking: barwise-zdd, barwise-4q0, barwise-raw, docs/specs/steward-skill.spec.md,
docs/specs/pr-skills.spec.md

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

1. **The agent driving a pull request may merge it only after the
   `pr-review` skill has recommended `merge` on the exact head being
   merged.** `pr-review` runs `/code-review` as its correctness engine.
   "Merge after", "do not merge" and "cannot tell" do not license a
   merge, and neither does a review run where `/code-review` was
   unavailable.
2. **The merge is pinned to the reviewed commit.** The agent merges
   with that SHA as the expected head (`expectedHeadSha`, or `gh pr
   merge --match-head-commit`), so a later push is refused rather than
   merged, and then posts one comment naming the SHA and the
   recommendation. Any push after the review needs a new review.
3. **No pull request is exempt by size.** Tracker-only and docs-only
   pull requests, including the closure follow-up after a merge, get the
   same review before merging.
4. **The agent asks the owner instead of merging** when the review
   cannot tell, when `/code-review` could not run, when the pull
   request's body leaves the owner a decision not yet answered, or after
   two reviews of the pull request that did not recommend `merge`. The
   owner's answer decides and resets the count.
5. **The owner's instruction overrides the condition.** When the owner
   says to merge a pull request, the agent merges it. A reviewer who is
   not the driving agent recommends and never approves or merges.

## Consequences

- Nothing mechanical enforces decisions 1, 3 or 4 (barwise-zdd). No
  hook inspects a merge: the GitHub MCP merge tool matches no hook in
  `.claude/settings.json`, and `gh pr merge` passes through the Bash
  hooks, which do not look at merges. A session that never loads
  `steward` can merge, as #679 did.
- Decision 2's pin holds only when the agent passes the SHA; GitHub then
  refuses a merge whose head has moved. Nothing requires the pin or the
  comment (barwise-zdd).
- An agent's merge cannot be told from the owner's: a session acts as
  the owner, so every merge shows the owner's login, and the owner may
  merge without the comment decision 2 asks of the agent. Whether this
  rule is followed cannot be measured from the record (barwise-4q0).
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
- Until architecture-index WS5 replaces them with links, `steward`
  section 4b, the `pr-review` skill, `REVIEW.md` and `pr-creation`
  also state parts of this rule (barwise-ubc, WS5).
