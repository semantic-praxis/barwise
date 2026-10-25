# Merge delegation

Scope: process
Date: 2026-10-25
Tracking: barwise-zdd, barwise-q93, docs/specs/steward-skill.spec.md,
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

- Nothing mechanical enforces decisions 1 to 3 (barwise-zdd). A merge
  goes through the GitHub API, outside every repository hook, and the
  agent hooks in `.claude/settings.json` match only Bash. The `main`
  ruleset forbids deletion and non-fast-forward pushes and requires no
  status check and no review, so a session that never loads `steward`
  can merge, as #679 did.
- The record decision 2 asks for is not reliably there, and an agent's
  merge cannot be told from the owner's: of the 15 most recent merged
  pull requests (#785 to #798), 2 carry a comment naming the merged
  head, and all 15 show the owner's login as the merger, because a
  session acts as the owner (barwise-zdd).
- The SHA pin is the one mechanical part, and it holds only when the
  agent passes it: GitHub then refuses a merge whose head has moved.
- The two-review cap in decision 4 answers barwise-q93 for an agent
  driving its own pull request; REVIEW.md's "Re-reviews must converge"
  points back to it. A general stopping rule for local review is still
  open there.
- Deliberate, as approval policy the owner kept (`review-md.spec.md`,
  "Does the Claude Code team's own practice change this?"): the agent
  may merge a pull request of any risk tier, and an open finding blocks
  a merge by convention, not by branch protection.
- The condition vouches that the review recommended `merge` on that
  head. It cannot show the review was done well; that is `pr-review`'s
  own discipline.
