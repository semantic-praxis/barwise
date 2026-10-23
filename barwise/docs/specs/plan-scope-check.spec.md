# Report how a pull request's diff compares with the plan its spec wrote down, and how big it is

Status: Draft -- no workstream implemented

Created: 2026-10-23
Last-updated: 2026-10-23
Tracking: barwise-2jy

In one sentence: a report-only script reads the spec a pull request names,
lists every changed file the spec did not name, and states the PR's size
with generated and recorded content excluded, so scope drift and an
oversized diff are visible before review starts instead of being
discovered in round ten.

## Principle

Explicit over implicit. A barwise spec already declares what a change will
touch: 112 of the 141 specs have an Inventory section, and 848 of its 941
rows name a path in their first column. A PR is meant to be "one
workstream of a spec and names which" (`pr-creation`). Nothing then
compares the diff with that declaration, so the plan states the scope and
the diff silently exceeds it. Agents in particular write more code than
the plan asked for, and the cost lands on the reviewer, who must
reconstruct which files were intended. The largest recent PRs ran 10 to 13
review rounds (#621, #662).

The same comparison answers a second question: is the plan itself still
the plan? The root `plan.md` describes a "Phase 6" that CLAUDE.md records
as complete, and nothing flags it. A plan that is never read back against
the diff decays the same way.

## Should the check fail a build? (resolved: no -- it reports)

Line count and "files outside the plan" are shadows in CLAUDE.md's sense:
they correlate with review cost through a mechanism (more surface, more
unplanned decisions) and diverge from it exactly where that mechanism is
bypassed. A 1,148-line test file (#678's `NormaConstraintIds.test.ts`) is
large and cheap to review; a 40-line change to a contract with live
consumers is small and expensive. `pr-creation` already warns that "a
forced split is overhead in the costume of rigour". A gate on either
number adds the pressure that turns the divergence into gaming (split a
PR to pass the count, name every file in the spec to empty the "outside"
list). The script reports; the author and the reviewer decide.

Measured over the 122 merged PRs since 2026-09-23, with the paths in
Open decision 2 excluded (snapshot of 2026-10-23, command in "Evidence"):

| Measure                                  | Value  |
| ---------------------------------------- | ------ |
| PRs with zero non-excluded lines changed | 42     |
| Median lines changed (all 122)           | 160    |
| 75th percentile                          | 493    |
| 90th percentile                          | 1,010  |
| Largest (#509, trial fixtures, see OD 2) | 36,676 |

Size does move with churn. Splitting the 80 non-empty PRs into size
quartiles, the median number of commits per PR is 2, 3, 5 and 6. Commits
are a weak stand-in for review rounds: bigger work needs more commits
before any review happens, so this supports reporting size and does not
support any threshold.

## Scope

In scope:

- When `npm run plan-scope` runs on a branch, the system shall find the
  specs the branch names: every `barwise/docs/specs/*.spec.md` the diff
  changes, and every spec file name that a commit message on the branch
  mentions.
- When at least one spec is found, the system shall list each changed,
  non-excluded file that none of those specs names, either as a file or as
  a directory containing it.
- When no spec is found and the diff changes non-excluded files, the
  system shall say that no plan was found and list nothing as outside it.
- The system shall report the lines and files changed with excluded paths
  removed, and where that size falls among the last 100 merged PRs on the
  base branch.
- When git cannot list the changed files or cannot resolve the base, the
  system shall exit 2 and print no report (CLAUDE.md, "A gate that cannot
  see its input must not print PASS").
- The system shall exit 0 whenever it produces a report, whatever the
  report says.

Out of scope: blocking a merge on size or scope (see the resolved question
above); judging whether an unplanned file was a good addition, which stays
with the reviewer; generating a spec's file list from a diff after the
fact, which would defeat the comparison.

## Inventory

| Area                                    | Current state                                                                                                                                                                  | Verdict                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `barwise/scripts/audit-spec-status.mjs` | Holds `namedPaths`, the one reader of "which repo paths a spec names": backticked tokens with a code extension, tried at three roots, kept if git knows them; barrels excluded | Moves to a shared lib; behaviour unchanged for the audit                |
| `barwise/scripts/lib/spec-paths.mjs`    | Does not exist                                                                                                                                                                 | New: `namedPaths`, plus a directory-prefix mode the scope check needs   |
| `barwise/scripts/plan-scope.mjs`        | Does not exist                                                                                                                                                                 | New: the report                                                         |
| `barwise/scripts/lib/changed-class.mjs` | `committedPaths(base)` lists a branch's changed files; CI's change classifier uses it                                                                                          | Reused for the file list                                                |
| `.gitattributes`                        | One line: the beads merge driver                                                                                                                                               | Gains `linguist-generated` marks, if Open decision 2 takes its default  |
| `barwise/review-tiers.json`             | `trivial.globs` is one exact path, chosen for "skip the Copilot review", a different question                                                                                  | Untouched: not the exclusion list (OD 2)                                |
| `barwise/scripts/check-file-size.mjs`   | Warn-only report of large source files, exit 0 always                                                                                                                          | Untouched; the precedent for a report that never gates                  |
| `.claude/skills/pr-creation/SKILL.md`   | Split rule keyed on spine files (more than five), fallout patterns, and reading time                                                                                           | Gains one readiness line: run the report, explain anything outside plan |
| `.claude/skills/pr-review/SKILL.md`     | Section 1 reads the spec and issue before the diff                                                                                                                             | Gains the report as an input to the scope-drift check in section 3      |
| `plan.md` (repo root)                   | A Phase 6 implementation plan; the work it describes is complete                                                                                                               | Deleted (OD 3)                                                          |

Looks affected and is not: the spec template. Its Inventory already
carries the plan; this spec reads what is there rather than adding a
second list.

## Where the plan's file list lives (resolved: the spec as it stands)

A spec's named paths, read by the existing `namedPaths`, are the plan.
Three findings settle it:

- **The data exists.** 108 of the 112 Inventory sections name at least one
  path; 800 of the 905 path tokens in Inventory first columns resolve to a
  tracked file or directory. The 105 that do not are brace and ellipsis
  shorthand (`llm/src/providers/{anthropic,openai,ollama}.ts`), files the
  spec plans to create, and files since moved.
- **A reader exists.** `audit-spec-status` already decides which paths a
  spec names, and is gated in CI. A second parser for the same question is
  the must-agree copy CLAUDE.md forbids, so WS2 moves it to a lib both
  scripts import.
- **Whole spec, not only the Inventory.** The audit reads the whole spec,
  and so does this check. Inventory-only would be a second reading of
  "what a spec names", and Inventory first columns vary in header (Area,
  Module, File, Piece, Gate). Reading the whole spec makes "outside the
  plan" more lenient, since a path cited only as context counts as
  planned; that errs toward fewer false reports.

Two gaps in the existing reader matter here and not to the audit, which
looks only at code files a spec names:

- **Directories.** `namedPaths` keeps only tokens with a code extension, so
  a spec saying `barwise/packages/cli/` plans nothing. The scope check
  needs "a named directory covers the files under it". WS2 adds this as an
  option, leaving the audit's default unchanged.
- **Planned new files.** A path that does not exist yet is dropped by the
  "git knows it" filter. When the branch creates it, the check must count
  the spec as having named it. WS3 resolves names against the branch's
  tree, not the base's.

Brace shorthand stays unresolved. The report lists such files as outside
the plan, and the author either spells the paths out or explains them;
expanding braces in a reader shared with a gate is not worth the risk for
the size of the gap.

## How a PR names its spec (resolved: the diff and the commit messages)

Of the 122 merged PRs since 2026-09-23, 46 name a spec file somewhere in
their commit messages. The PR body is not available to a local script
without a GitHub call, so the check reads two local sources: spec files
the diff changes (a spec's own PR, or a Status update in the workstream
that ships it) and spec file names in the branch's commit messages
(`Spec: barwise/docs/specs/x.spec.md` is the usual form, though no
skill prescribes it). When neither finds a spec, the report says so. That is itself
the useful answer for a substantive PR, since `pr-creation` requires a PR
to name its workstream.

## Target architecture

```
barwise/scripts/lib/spec-paths.mjs
  namedPaths(text, { directories = false, exists }) -> string[]
      the one reader of "paths a spec names" (moved from audit-spec-status)

barwise/scripts/audit-spec-status.mjs   imports namedPaths; output unchanged
barwise/scripts/plan-scope.mjs          npm run plan-scope [-- --base <ref>]
  changed  = committedPaths(base) minus files git check-attr marks generated
  specs    = specs in the diff + spec names in `git log base..HEAD` messages
  planned  = union of namedPaths(spec, { directories: true }) at HEAD
  outside  = changed files under no planned path
  size     = numstat over `changed`; rank among the last 100 first-parent
             merges on base, measured the same way
  exit 0 with the report; exit 2 when git cannot answer

Report (plain text):
  Plan: plan-scope-check.spec.md (named in 3 commits)
  Outside the plan (2 of 14 files):
    barwise/scripts/lib/tracked.mjs
    barwise/package.json
  Size: 412 lines in 14 files, excluding generated -- larger than 71% of
        the last 100 merged PRs.
```

## Alternatives considered

- **A declared file list in the PR body or a new spec header field.**
  Exact and cheap to parse. Lost because it is a third list beside the
  Inventory and the reading guide, written by the same author at the same
  moment. It would match the diff by construction, since the author writes
  it after the code exists, so it would measure nothing.
- **A size gate.** Fail above a fixed line count, as many teams do. Lost on
  the evidence above: the median PR is 160 lines and the 90th percentile
  1,010. A threshold low enough to matter fails legitimate test-heavy PRs
  (#678), and the 36,676-line PR was fixtures. `pr-creation` already has a
  seam rule (spine files, fallout patterns, reading time) that measures
  review cost more directly than lines do.
- **A model judging whether the diff matches the plan.** It would read
  intent and cope with brace shorthand and renamed files. Lost for now: it
  puts a non-deterministic call in the author's pre-PR path, and the
  deterministic comparison is cheap and has not yet been shown
  insufficient. It is the natural next step if the report's "outside"
  lists turn out to be mostly noise (Tripwires).

## Workstreams (each independently shippable)

### 1. Delete the root `plan.md`

The smallest change and independent of the rest. The work it plans is
complete (CLAUDE.md, "All development phases are complete") and git keeps
it. If Open decision 3 goes the other way, it moves to
`barwise/docs/specs/archive/` with a Status line instead.

### 2. Move `namedPaths` to `barwise/scripts/lib/spec-paths.mjs`

A refactor with one new option. `audit-spec-status` imports it and its
`--check` output over the current tree is byte-identical before and after;
the existing script tests pin that. Add `directories: true`, which keeps a
backticked token ending in `/` when git knows the directory. Tests: the
directory mode on and off, and a planted spec whose named directory covers
a changed file.

### 3. `plan-scope.mjs` and its npm script (provisional: not yet grounded)

The report above, with sandbox tests in `scripts/tests/` for:

- a spec found through the diff;
- a spec found through a commit message;
- no spec found;
- a planned new file;
- a named directory;
- excluded paths;
- git failing, which exits 2.

The percentile reads 100 merges; its cost has not been measured and is
the first thing to check when grounding this workstream.

### 4. Mark generated and recorded paths in `.gitattributes`

Depends on Open decision 2. Add `linguist-generated=true` for each path in
the agreed list, read through `git check-attr`. Add a drift test that
every `regen:*` script's output path carries the mark, so a new
regenerator cannot ship unmarked. WS3 can land first with an empty
exclusion list, and then reports inflated sizes until this lands.

### 5. Wire the report into `pr-creation` and `pr-review` (provisional)

- `pr-creation` readiness: run `npm run plan-scope`, and account in the
  reading guide for every file it lists as outside the plan.
- `pr-review` section 3, scope drift: read the report rather than
  re-deriving the file list.

A non-blocking CI step that prints the report to the job summary is
deferred until the report has been used on real PRs.

## Open decisions (for review)

1. **Must a plan be reviewed before code?** Since 2026-07-01, 90 of the 120
   merged PRs that added a spec also changed code in the same PR, so
   `spec-writer` step 8 ("land the spec for review, then implement") is
   the exception in practice. Options:
   - (a) Enforce it everywhere. Doubles the PR count for small specs.
   - (b) Leave it as is. The spec is reviewed alongside code it was meant
     to shape.
   - (c) Require a spec-only PR when the spec makes a decision that is
     expensive to reverse: a metamodel or `schemaVersion` change, a public
     interface, a new dependency, a pattern others will copy. Allow other
     specs to land with their first workstream, reviewed spec-first
     (`pr-review` section 1 already orders it so).

   **Recommended: (c).** This spec does not implement it; it belongs in
   `spec-writer`, and the decision is the owner's.
2. **What counts as generated or recorded, and where the list lives.**
   REVIEW.md (PR #712) lists regenerated outputs and recorded data in
   prose. `review-tiers.json`'s `trivial` block answers a different
   question ("skip the Copilot review"). Neither names `barwise/trial/`
   fixtures, which made #509 the largest PR of the window. Options:
   - (a) `linguist-generated` in `.gitattributes`. Git-native, readable
     through `git check-attr`, and GitHub collapses those files in PR
     diffs, which helps human reviewers too. REVIEW.md would then point
     at it.
   - (b) A new block in `review-tiers.json` read through
     `lib/review-tiers.mjs`.
   - (c) Hard-code the list in the script.

   **Recommended: (a).** It is one owner for three readers: this script,
   the review service, and GitHub's diff view. Whether `barwise/trial/`
   fixtures belong on it is part of the decision; marking them collapses
   them in review, which is wrong if a reviewer should read them.
3. **The root `plan.md`: delete, or archive.** **Recommended: delete**
   (WS1). It is not in spec format and its work is done.
4. **Should an ad hoc `PLAN.md` be refused?** Agents in plan mode write plan
   files, and one that lands outside `docs/specs/` gets no review and no
   Status. **Recommended: report it, not refuse it.** WS3 lists an added
   `plan.md` or `PLAN.md` outside `barwise/docs/specs/` at the top of its
   report.

## Risks and testing

- WS2 must not change the audit. Its `--check` over the current tree and
  the existing script tests are the guard, run before and after.
- The report's "outside the plan" list is only as good as specs' path
  naming. 54 of the 108 path-naming Inventories resolve completely today;
  the rest list some files falsely. That is acceptable for a report and
  is why it must not become a gate.
- A new script test file needs `npm run test:scripts -- --write` in the
  same commit, or the pre-push hook refuses the push.

## Evidence

Snapshot of 2026-10-23 on `1a32f9c7` (origin/main).

- Spec and Inventory counts: a one-off script (not committed) applying
  `namedPaths`'s three-root resolution to the first column of each
  `## Inventory` table. WS2's tests replace it.
- Spec-with-code: for each first-parent merge since 2026-07-01, whether
  `git diff --name-only --diff-filter=A M^1 M -- 'barwise/docs/specs/*.spec.md'`
  is non-empty, and whether the same diff changes anything outside
  `barwise/docs/` and `.beads/`.
- Sizes: for each first-parent merge since 2026-09-23,
  `git diff --numstat M^1 M`, summed over files outside Open decision 2's
  candidate list (the REVIEW.md skip paths). The commits are
  `git rev-list --count M^1..M^2`.
- Spec named in commits: `git log --format=%B M^1..M^2` matching
  `[a-z0-9-]+\.spec\.md`.

## Tripwires

- If most "outside the plan" entries on real PRs are files the spec
  plainly meant (brace shorthand, renames), revisit the model-judged
  alternative or brace expansion in `spec-paths`.
- If authors start naming every file in the spec to empty the list, the
  report has become a target. Stop showing the count and show only the
  list.

## Non-goals

- No change to `pr-creation`'s split rule or to who decides a split.
- No gate on size, scope, or the presence of a spec.
- No change to the spec template.
