---
name: steward
description: Use when driving a barwise PR to green - acting on CI failures, review events, or merge conflicts as the PR's agent, and before merging it. Carries the repo-specific mechanics the generic drive-to-green rules cannot know, and the owner's condition for merging; conventions themselves live in CLAUDE.md, AGENTS.md, and the scripts this file points at.
---

# Stewarding a barwise PR

Scope note: this file adds barwise mechanics on top of the generic
PR-driving rules; it does not restate them. Where a rule here names a
command or an order, the cited file is the authority and this is the
pointer (spec: `docs/specs/steward-skill.spec.md`).

## 1. Tracker conflicts: `.beads/issues.jsonl`

The issue tracker is a git-native JSONL file; a merge conflict there
is data to reconstruct, not hunks to pick.

- **A local merge resolves it for you.** `npm run prepare` installs a
  merge driver (`scripts/beads-merge-driver.mjs`,
  `docs/specs/beads-merge-driver.spec.md`) into the clone's git
  directory, and `.gitattributes` routes the tracker to it. So
  `git merge origin/main` on a branch whose PR GitHub shows as
  conflicted on the tracker completes without hand work. GitHub runs
  no custom driver, which is why the PR page still says conflicted
  until that merge is pushed. If the session-start hook warned that the
  driver is not installed, run `npm run prepare` from `barwise/`
  first.
- **What the driver decides.** It merges three-way, per issue and then
  per field: a field only one side changed takes that side's value,
  `updated_at` and `closed_at` take the later value, and an issue one side deleted and
  the other left alone stays deleted. It does NOT keep "the line with
  the later `updated_at`" wholesale: that rule lost concurrent edits to
  different fields, such as a closure on main and a later note on a
  branch.
- **What it reports instead of deciding**, each as a conflict block
  naming the id, with the reason on stderr:
  - the same id with a different `created_at` on the two sides -- a
    collision, two issues minted one id (barwise-984). Titles are not
    the test, because titles are edited. Keep main's line, re-file the
    branch's issue under a fresh id with
    `node barwise/scripts/beads-crud.mjs create`, and rewrite the
    branch's references to it. PR #486 lost main's barwise-981 and its
    own barwise-982 by treating a collision as an edit.
  - an issue deleted on one side and edited on the other: decide
    whether the deletion or the edit stands.
  - a field both sides changed to different values: each candidate
    line already carries every field the driver merged, so keep the
    candidate with the value you want, or edit it.
- If the driver itself fails (a malformed line, a crash), the file
  holds git's ordinary line-merge markers instead; resolve by hand as
  above, by issue id.
- Never commit merge markers -- the validator rejects them -- and never
  resolve by keeping one side wholesale.
- Write lines only through `scripts/beads-crud.mjs` -- canonical form
  (compact JSON, `&<>` escaped) is what the validator enforces.
- Gate: `npm run check:beads -- --strict` must pass before the
  resolution is committed. The pre-commit and pre-merge-commit hooks
  run it on the staged file, which catches what no per-issue rule can
  see: a dependency on an issue the other side deleted. CI runs it on
  every PR, and is the only check on a rebase.

## 2. Generated files: regenerate, never hand-edit

A conflict or a failing drift test in a generated file
(`builtins.generated.ts`, `examples/output/`, tutorial or reference
output, golden files) is fixed by rerunning its regenerator on the
merged source, not by editing the output. The failing drift test's
message names its regenerator; the full list is the `regen:*` scripts
in `barwise/package.json` (`regen:builtins`, `regen:examples`,
`regen:tutorial`, `regen:references`), plus `UPDATE_GOLDEN=1` for the
golden tests that document it.

## 3. The duplication ratchet can fire on your own fix

`npm run audit:duplication -- --check` fails on any new unclassified
candidate and on a stale entry for a finding your diff resolved. Both
are yours: update `barwise/audit-baseline.json` in the same commit
(classify the new candidate, or delete the stale entry). The rubric
is the `duplication-audit` skill.

## 4. Before pushing a fix

Run from `barwise/`, cheap checks first -- the order and full set are
owned by `.github/workflows/ci.yml`:

```sh
npm run fmt && npm run check:beads -- --strict
npm run oxlint && npm run depcruise && npm run check:depcruise-gate
npm run check:parity && npm run audit:duplication -- --check
npm run lint && npm run build && npm test
```

Three traps:

- A per-package `tsc --noEmit` reads its dependencies' `dist`, not
  their source -- run `npm run build` from `barwise/` first whenever a
  change crossed a package boundary (root `CLAUDE.md`).
- The pre-commit hook formats staged files and runs build plus
  affected tests; on failure it restores the staged state, discarding
  fixes it applied -- re-stage and commit again rather than assuming
  the fixes stuck.
- The pre-push hook runs `ci:local`, which runs the gates CI will run
  for this change and lists the ones it skips. For a source change the
  command above is a subset of what the push will check anyway; for a
  Markdown or `.beads/`-only change the push skips build, lint and
  tests, as CI does. Budget ~30s warm, ~3min when sources changed.

A PR touching only Markdown and `.beads/` takes CI's docs-only path
(formatting and tracker checks only), so tracker-only and docs-only
pushes are cheap. The required status check is `ci`; the Node version
comes from `.nvmrc`, not the check name.

## 4a. A stacked PR gets no CI, and merging its parent does not start one

`ci.yml` triggers on `pull_request: branches: [main]`, so a PR based on
another branch gets **zero** check runs -- not pending ones, none at
all. That much is visible. The part that is not: when the parent merges
and GitHub retargets the child to `main`, the retarget fires
`pull_request.edited`, which is outside the workflow's default activity
types (`opened`, `synchronize`, `reopened`). So the retargeted PR still
has no CI, now looks like an ordinary PR against `main`, and sits
waiting on a required check that nothing will ever report.

Push a merge of `main` into the branch once the parent has merged. That
is a `synchronize`, it starts the run, and it is a real commit rather
than the forbidden empty one -- `main` has moved by at least the
parent's merge commit, and the merge records that these commits were
validated against the `main` they will land on. Do it as soon as the
parent merges, not at review time.

The cheaper option is to avoid the stack: a workstream whose PR does not
need its predecessor's code in the diff is better cut against `main`
directly. Stack only when the later work genuinely will not compile or
test without the earlier, and then expect this step.

## 4b. Before merging: `/code-review` and `/pr-review`, on the head being merged

The owner lets the agent driving a PR merge it, on one condition
(2026-10-18): the `pr-review` skill, which runs `/code-review` as its
correctness engine, has recommended `merge` on the exact head being
merged. This is the one permission rule in this file, because it is a
delegation the owner made for this repo, which no generic rule can know.

- **Review the current head, then merge that SHA.** Run the `pr-review`
  skill, delivered in the session. On `merge`, merge with the reviewed
  SHA pinned (the GitHub MCP merge's `expectedHeadSha`, or `gh pr
  merge --match-head-commit`), so a commit pushed after the review is
  refused rather than merged; once merged, post one PR comment naming
  the SHA and the recommendation. On anything else, fix what it lists,
  push, and review the new head. Any push needs a new review.
- **Ask the owner instead** when the review cannot tell, when
  `/code-review` could not run, when the PR body leaves the owner a
  decision they have not answered, or after two reviews of this PR that
  did not recommend `merge` -- a fresh review always finds something to
  say, and chasing it ran 28 rounds on one PR (barwise-q93). The owner's
  answer decides, and resets the count.
- **The owner's instruction overrides this.** The rule is a condition
  on a delegation; when the owner says to merge a PR, merge it.
- **No exemption by size.** Tracker-only and docs-only PRs, including
  section 5's follow-up, get the review too; PR #679 only closed two
  issues and merged without it, which is how this rule came to be
  written down. Nothing mechanical enforces it yet (barwise-zdd).

## 5. After the PR merges

Close the issues it resolved via
`node barwise/scripts/beads-crud.mjs close <id> --reason "..."` in a
tracker-only follow-up PR -- not in the code PR, whose body should
say the closures follow. That follow-up is a PR like any other: section
4b applies before merging it. `npm run check:tracker-closes` (a CI step on every
pull request, and part of the pre-push run) fails a diff that closes an
issue and changes anything outside `.beads/`, docs included. Then push and verify per the Session
Completion section of the root `CLAUDE.md`: work is not done until
`git status` shows up to date with origin. If the merge deleted the
branch, prune first -- see 6, because until you do that is a question
about a ref the remote no longer has.

## 6. After the branch is deleted: `git remote prune origin`

Merging with "delete branch" leaves this clone holding
`refs/remotes/origin/<branch>` pointing at a commit the remote no
longer has. **Naming a branch on a `fetch --prune` does not remove
it.** Measured on git 2.43.0 against a throwaway remote with two
deleted branches:

| Command                                                          | Stale refs removed          |
| ---------------------------------------------------------------- | --------------------------- |
| `git fetch --prune origin feat-one`                              | none -- not even `feat-one` |
| `git fetch --prune origin feat-one:refs/remotes/origin/feat-one` | none                        |
| `git fetch --prune origin`                                       | both                        |

Naming a ref narrows the refspec, and a ref the remote has already
deleted cannot be fetched, so the fetch errors out before the prune
half runs at all. The bare `git fetch --prune origin`, or
`git remote prune origin`, is what clears them. `git fetch origin
<branch>` is the form the harness's git rules ask for, so this is the
one place to deviate -- or rather, to add a second command after it.

Three symptoms, one cause, and none of them says "stale ref":

- `git push` on a branch that plainly exists reports `[new branch]`.
- `--force-with-lease` is rejected for "stale info" against a ref
  nobody else has touched.
- A session hook reports unpushed commits on a branch whose work is
  pushed -- the expensive one, because the remedy it suggests (push
  again) is the one that cannot work.

So prune when a PR merges, before reading any of those three as
evidence about the remote. Nothing checks this; barwise-1033 carries
the question of whether a check is worth it and where one could
usefully run.

## 7. A Copilot refusal is not a review, and nothing waits on it

A Copilot review is requested on every non-trivial pull request except
Dependabot's (Copilot drops a request on those), and nothing blocks on
that review (`docs/specs/tiered-pr-review.spec.md`, "The decision of
2026-09-23"). When its quota is exhausted it posts a refusal AS a review
-- "Copilot was unable to review this pull request because the user who
requested the review has reached their quota limit." That is not a
finding and not a blocker: there is nothing to reply to, fix or wait
for, so carry on and drive the pull request on CI and any human review.
Do not request Copilot again by hand; the Copilot review workflow asks
again on the next push. A quota reset triggers nothing by itself: the
workflow has no schedule, so a pull request with no push after the reset
is not reviewed. That is the accepted cost -- never an empty commit to
force a run; if one pull request's review matters, say so to the owner.

The findings Copilot does post are fixed on the pull request, and they
are also the corpus for WS6 of that spec, which classifies them by
failure mode to prevent the most common one upstream. Replying to each
finding with what was wrong and why is what makes that later
classification possible.
