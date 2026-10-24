# Report how a pull request's diff compares with the plan its spec wrote down, and how big it is

Status: Workstreams 1-6 implemented 2026-10-24 (plan.md deleted; the shared
spec reader, Touches: read by audit:specs, check:spec-touches; the
plan-scope report; generated marks in .gitattributes; the skill wiring;
check:plan-review and the plan-review rule in spec-writer, pr-creation and
the template)

Created: 2026-10-23
Last-updated: 2026-10-24
Tracking: barwise-2jy
Plan-reviewed: 45f824a9 (code-review, pr-review)
Touches: -plan.md, .gitattributes, barwise/review-tiers.json,
barwise/scripts/audit-spec-status.mjs, +barwise/scripts/lib/spec-reader.mjs,
barwise/scripts/plan-scope.mjs, barwise/scripts/lib/generated.mjs, REVIEW.md,
barwise/scripts/check-spec-touches.mjs,
+barwise/scripts/check-plan-review.mjs, barwise/scripts/tests/,
barwise/package.json, package.json, .github/workflows/ci.yml,
.claude/skills/pr-creation/SKILL.md, .claude/skills/pr-review/SKILL.md,
.claude/skills/spec-writer/SKILL.md, .claude/skills/spec-writer/template.spec.md

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
- When a spec carries a `Touches:` header, the system and `audit:specs`
  shall read its plan from that header alone; when it does not, from the
  paths its text names.
- When a `Touches:` entry is neither a tracked path, a path the branch
  adds, nor a pattern matching a tracked path, `check:spec-touches` shall
  exit 1 naming the spec and the entry.
- When a PR names a spec (the spec file is in its diff, or its file name
  is in a commit message on the branch) and changes a path in that spec's
  `Touches:` while the spec's Status at the merge base claims nothing is
  built, and the spec has no `Plan-reviewed:`
  line naming an ancestor of the first such change that contains the
  spec, `check:plan-review` shall exit 1 naming the spec.
- When either check cannot read git or a spec, it shall exit 2.

Out of scope: blocking a merge on size or scope (see the resolved question
above; the plan-review rule is a gate because it checks the property, not
a proxy); judging whether an unplanned file was a good addition, which stays
with the reviewer; generating a spec's file list from a diff after the
fact, which would defeat the comparison.

## Inventory

| Area                                          | Current state                                                                                                                                                                  | Verdict                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `barwise/scripts/audit-spec-status.mjs`       | Holds `namedPaths`, the one reader of "which repo paths a spec names": backticked tokens with a code extension, tried at three roots, kept if git knows them; barrels excluded | Moves to a shared lib; behaviour unchanged for the audit                                         |
| `barwise/scripts/lib/spec-reader.mjs`         | Does not exist                                                                                                                                                                 | New: `namedPaths` with its four options, `header()`, `touches()`                                 |
| `barwise/scripts/plan-scope.mjs`              | Does not exist                                                                                                                                                                 | New: the report                                                                                  |
| `changed-class.mjs`                           | `committedPaths(base)` runs a two-dot `git diff base HEAD`, right for CI's merge commit and wrong locally once `main` has moved                                                | Not reused; the file list is a three-dot diff, as `pr-risk` reads it                             |
| `.gitattributes`                              | One line: the beads merge driver                                                                                                                                               | Gains `linguist-generated` marks, if Open decision 2 takes its default                           |
| `review-tiers.json`                           | `trivial.globs` answers a different question; its "generated output" row names a path that does not exist                                                                      | Its generated row is checked against the marks (WS4)                                             |
| `check-file-size.mjs`                         | Warn-only report of large source files, exit 0 always                                                                                                                          | Untouched; the precedent for a report that never gates                                           |
| `.claude/skills/pr-creation/SKILL.md`         | Split rule keyed on spine files (more than five), fallout patterns, and reading time                                                                                           | Gains one readiness line: run the report, explain anything outside plan                          |
| `.claude/skills/pr-review/SKILL.md`           | Section 1 reads the spec and issue before the diff                                                                                                                             | Gains the report as an input to the scope-drift check in section 3                               |
| `.claude/skills/spec-writer/SKILL.md`         | Step 8 says to land the spec for review first; nothing records that it was                                                                                                     | Step 8 requires `/code-review` and `/pr-review` on the spec, and the `Plan-reviewed:` line (WS6) |
| `.claude/skills/spec-writer/template.spec.md` | Header has Status, Created, Last-updated, Tracking                                                                                                                             | Documents `Touches:` (WS2) and `Plan-reviewed:` (WS6)                                            |
| `barwise/scripts/check-spec-touches.mjs`      | Does not exist                                                                                                                                                                 | New: every `Touches:` entry resolves (WS2)                                                       |
| `barwise/scripts/check-plan-review.mjs`       | Does not exist                                                                                                                                                                 | New: implementation follows a recorded plan review (WS6)                                         |
| `ci.yml`                                      | Runs neither check                                                                                                                                                             | Runs both, each with its root `package.json` forwarder                                           |
| `plan.md` (repo root)                         | A Phase 6 implementation plan; the work it describes is complete                                                                                                               | Deleted (OD 3)                                                                                   |

The spec template gains two header fields, `Touches:` and `Plan-reviewed:`,
by the owner's decisions below. The Inventory stays as the reader's
explanation of each planned change; `Touches:` is its machine-checked
summary, and specs without one fall back to the Inventory's paths.

## Where the plan's file list lives (resolved: a `Touches:` header, with the spec's text as the fallback)

The owner's decision of 2026-10-23: a spec declares the paths it plans to
change, explicitly, so the answer is the same every time it is asked
(next section). For a spec without that declaration -- every spec written
before it -- the plan is the spec's named paths, read by the existing
`namedPaths`. Three findings settle the fallback:

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

Four gaps in the existing reader matter here and not to the audit, which
looks only at code files a spec names. The 800-of-905 figure above counts
tokens that resolve; it does not apply `namedPaths`' filters, so the
reader keeps fewer than that:

- **Directories.** `namedPaths` keeps only tokens with a code extension, so
  a spec saying `barwise/packages/cli/` plans nothing. The scope check
  needs "a named directory covers the files under it".
- **Markdown and other non-code files.** `.md` is not in its extension
  list, so a skill, a CLAUDE.md, a doc or `.gitattributes` named in a spec
  is never planned. A process spec whose Inventory is all Markdown would
  report every changed file as outside its plan; this spec's own Inventory
  would flag three of its rows.
- **Bare names.** A token with no `/` is skipped, so a root file such as
  `plan.md` is never matched.
- **Barrels.** `index.ts` and `registration.ts` are dropped on purpose for
  the audit, and should count as planned for this check.

WS2 adds each as an option (`{ dirs, anyExtension, bare, barrels }`),
leaving the audit's default behaviour unchanged.

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

## Which paths does a spec plan to change? (resolved: a `Touches:` header line)

The owner's decision of 2026-10-23, asked for consistency and
repeatability. Inferring a spec's subject from every backticked path
fails both ways: `audit:specs` reads a path cited as context (`ci.yml`,
a gate test) as the spec's subject, so an unrelated PR that edits it trips
the audit; and this check would read the same context path as planned.
The three specs in PR #714 had to name such files bare to stay clear of
the audit, which is a writing convention, not a mechanism.

So a spec declares its plan in its header, beside `Status:` and
`Tracking:`:

```text
Touches: barwise/scripts/audit-spec-status.mjs, +barwise/scripts/plan-scope.mjs,
  -plan.md, .github/workflows/ci.yml
```

- **Entries.** Comma-separated repo-rooted paths, a trailing `/` for a
  directory, and the review-tiers pattern shapes for globs. The field may
  wrap, as `Tracking:` does.
- **Planned changes are marked.** `+path` is a file the plan creates and
  `-path` one it deletes. An unmarked entry must be tracked (or, for a
  pattern, match a tracked path); a `+` entry may be absent and a `-`
  entry may already be gone. Without the marks, `check:spec-touches` would
  fail on `main` for every Draft spec that plans a new file, because on
  `main` there is no branch to add it.
- **Shared wiring files are planned but not owned.** Nearly every
  workstream adds a step to `ci.yml`, a script to the two `package.json`
  files, a test to `scripts/tests/`, or a line to the root `CLAUDE.md`.
  Listing them is right for the scope report, but if `audit:specs`
  treated them as a spec's subject, every commit touching `ci.yml` would
  make every Draft spec that lists it look stale. So
  `lib/spec-reader.mjs` keeps one `WIRING` list (`.github/workflows/`,
  `package.json`, `barwise/package.json`, `CLAUDE.md`,
  `barwise/scripts/tests/`, `barwise/docs/specs/`, `.beads/`), and the
  audit ignores `Touches:` entries under it. `check:plan-review` does not
  need it: it covers only PRs that name the spec (next section). `audit-spec-status` already
  makes the same move for barrels (`HUB`); this is the declared form of
  it. `audit:specs` also keeps its code-extension filter, so a Markdown
  entry such as a skill counts for the report and for plan review, and not
  for the audit, as today. `barwise/docs/specs/` is wiring because a
  workstream that updates Status or a pointer in other specs is
  documenting decisions already made, not implementing one.
- **Only the header block is read.** The reader takes header fields from
  the lines between the title and the first `##` heading, never from the
  body, so an example inside a code block (like the one above) is never
  read as the spec's own field. `audit-spec-status`'s `header()` matches
  the first such line anywhere in the file, which is safe today only
  because no spec quotes a header field at column 0; WS2 narrows it.
- **Fallback.** `audit:specs` and this report read `Touches:` when it is
  present and fall back to `namedPaths` when it is not, so no existing
  spec changes.
- **Kept live.** `check:spec-touches` (WS2) fails, exit 1, on an unmarked
  entry that matches nothing tracked, so the declaration cannot rot the
  way a `review-tiers.json` glob did (barwise-fs0); exit 2 when it cannot
  list tracked files.
- The spec template documents the field and `spec-writer` asks for it.

## Is a plan reviewed before its code? (resolved: yes, with `/code-review` and `/pr-review`)

The owner's decision of 2026-10-23: a plan must be reviewed with both the
`/code-review` and `/pr-review` skills before its implementation is
committed. It replaces Open decision 1's options. Measured: 90 of 120
spec-adding PRs since 2026-07-01 shipped code in the same PR, so today the
spec is reviewed, if at all, beside the code it was meant to shape.

The review is recorded in the spec's header block:

```text
Plan-reviewed: <commit> (code-review, pr-review)
```

`check:plan-review` (WS6) applies the rule to a diff:

- **Which specs it covers.** A spec is covered when the PR names it --
  the spec file is in the diff, or its file name is in a commit message on
  the branch, the same rule the scope report uses to find a PR's plan --
  and the diff changes one of its `Touches:` entries, and either the spec
  is new in the diff or its Status at the merge base claims nothing is
  built. An unrelated PR names no Draft spec, so editing a shared file
  never makes it answer for one (Open decision 5, resolved). Reading Status at the base, not the head, matters:
  `template.spec.md` tells authors to update Status in the commit that
  lands a workstream, so a head-side reading would exempt every compliant
  first-workstream PR.
- **What it requires.** A `Plan-reviewed:` line naming a commit that is an
  ancestor of the diff's first change to a `Touches:` entry, and at which
  the
  spec's body -- everything but the header block -- is identical to the
  body as that first change began, in its parent (WS6 says why not the
  first change itself). A review of an earlier draft does not cover
  a plan rewritten afterwards; this PR is the example, where the owner's
  decisions were written after the first `/code-review` round, so only a
  review of the head that carries them counts.
- **Its answers.** Exit 1 naming the spec when the line is missing, names
  a non-ancestor, or names a commit whose body differs. Exit 2 when it
  cannot read git, when a spec cannot be read, or when the clone is
  shallow, since ancestry in a truncated history is not an answer
  (`audit-spec-status` refuses a shallow clone through
  `requireFullHistory` for the same reason).

Unlike size and scope, this is a gate. Size is a shadow of review cost;
whether the plan was reviewed is the property itself, and the owner made
it a rule. What the line cannot prove is that the reviews ran well, any
more than `steward` 4b's merge comment does. It ties the claim to a named
commit and a body that can be compared, so a later reader can check it.

## Target architecture

```
barwise/scripts/lib/spec-reader.mjs
  namedPaths(text, { dirs, anyExtension, bare, barrels, exists }) -> string[]
      the one reader of "paths a spec names" (moved from audit-spec-status)

barwise/scripts/audit-spec-status.mjs   imports namedPaths; output unchanged
barwise/scripts/plan-scope.mjs          npm run plan-scope [-- --base <ref>]
  changed  = git diff --name-status -z --no-renames base...HEAD (three dots,
             as pr-risk reads it: a two-dot diff counts main's own new
             commits as this branch's changes) minus files git check-attr
             marks generated
  specs    = specs in the diff + spec names in `git log base..HEAD` messages
  planned  = union over specs of touches(spec) when it has a Touches:
             header, else namedPaths(spec, all four options on), at HEAD
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

- **A declared file list in the PR body.** Exact and cheap to parse. Lost
  because the author writes it after the code exists, so it matches the
  diff by construction and measures nothing. The first draft of this spec
  rejected a spec header field on the same ground; the owner chose one
  (`Touches:`), and the objection is answered by the plan-review rule,
  which fixes the header before any implementation is committed.
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
it.

### 2. Move `namedPaths` to `barwise/scripts/lib/spec-reader.mjs`

A refactor plus the `Touches:` reader. `audit-spec-status` imports
`namedPaths` and `header()` from the lib, and its `--check` output over
the current tree is byte-identical before and after; the existing script
tests pin that. Add the four reader options (`dirs`, `anyExtension`,
`bare`, `barrels`), `touches(text)`, and `check:spec-touches` with its
root forwarder. `audit-spec-status` reads `Touches:` when present. Tests:
each option on and off; a `Touches:` entry that resolves, one the branch
adds, and a dead one seen failing; and a Draft spec citing `ci.yml` as
context with a `Touches:` that omits it, which an edit to `ci.yml` no
longer trips.

### 3. `plan-scope.mjs` and its npm script

The report above. The npm script lands with its root `package.json`
forwarder, regenerated by `regen-root-package.mjs`, or
`check:root-scripts` fails. Sandbox tests in `scripts/tests/` cover:

- a branch behind a `main` that has moved since it was cut, whose
  changes must not include `main`'s new commits;
- a spec found through the diff;
- a spec found through a commit message;
- no spec found;
- a planned new file;
- a named directory;
- excluded paths;
- git failing, which exits 2.

The percentile reads 100 merges. Grounded 2026-10-24: 100 `git diff
--numstat` calls over the first-parent merges take about 2 seconds, so
the report computes it on every run rather than caching it. Two forms
plan the same thing: an ad hoc `plan.md` or `PLAN.md` the branch adds
outside `barwise/docs/specs/` is listed first (Open decision 4), and a
named spec counts as part of its own plan. First run, on the branch that
became #729 (architecture-index WS2): three files outside a `Touches:`
header that had not been updated as the work grew, which is the report
doing its job.

### 4. Mark generated and recorded paths in `.gitattributes`

Depends on Open decision 2. Add `linguist-generated=true` for each path in
the agreed list, read through `git check-attr`. Add a drift test that
every `regen:*` script's output path carries the mark, so a new
regenerator cannot ship unmarked. A regenerator that writes only a section
of a hand-written file (as `architecture-index.spec.md` proposes for
ARCHITECTURE.md) is exempt by name in that test: marking the whole file
would hide its hand-written body from diffs and from this report.

The same test makes `.gitattributes` the one owner of the generated list:
it asserts that the "When generated output changed" row's globs in
`review-tiers.json` match the marked paths. Today that row has already
drifted: it names a `prompts/` directory in `@barwise/llm`, and the file
lives under `prompt/artifacts/` there, so the glob has matched
nothing since it was written on 2026-09-18 and no check said so
(barwise-fs0). WS3 can land first with an empty
exclusion list, and then reports inflated sizes until this lands.

### 5. Wire the report into `pr-creation` and `pr-review`

- `pr-creation` readiness: run `npm run plan-scope`, and account in the
  reading guide for every file it lists as outside the plan.
- `pr-review` section 3, scope drift: read the report rather than
  re-deriving the file list.

A non-blocking CI step that prints the report to the job summary is
deferred until the report has been used on real PRs.

### 6. The plan-review rule and `check:plan-review` (implemented 2026-10-24)

The owner's rule, written where authors and agents read it, and checked:

- `spec-writer` step 8: run `/code-review` and `/pr-review` on the spec
  before committing any implementation, then add the `Plan-reviewed:`
  line naming the reviewed head.
- `pr-creation` readiness: a PR that adds a spec and implements it shows
  the plan-review commit before the first implementation commit.
- The spec template documents `Touches:` and `Plan-reviewed:`.
- `check:plan-review` in `ci.yml`, with its root forwarder, applying the
  requirement in Scope. It reads `Touches:` through `lib/spec-reader.mjs`,
  so it needs WS2. Sandbox tests: implementation with no review line,
  with a line naming a later commit, with a line naming a commit that
  lacks the spec, the passing order, and git failing (exit 2), each seen
  red first through `mutate.mjs`.

Grounded 2026-10-24 on `4c28e58d` (origin/main):

- **Day one: no open spec fails.** Ten specs' Status claims nothing is
  built, and none of them declares `Touches:`, so none is in reach. The
  four specs that declare it (architecture-index, masked-exit-report,
  review-routing, this one) all claim some work built already.
- **Over history: 2 of 408.** Run over every first-parent merge since
  2026-07-01 (`--base M^1 --head M^2`, each spec's header as of that
  PR), two would have exited 1: #714 and #715, which edited ADRs that
  `architecture-index.spec.md` lists in `Touches:` before it carried a
  `Plan-reviewed:` line. The four PRs that implemented a spec carrying
  one (#721, #723, #724, #728) pass.
- **Reach is the open question, not strictness.** Of those 408 merges,
  146 named a spec that was new or claimed nothing built and changed
  something outside `barwise/docs/` and `.beads/`; 140 of the 146 named
  only specs with no `Touches:`, which the rule cannot see. `Touches:`
  is optional, so a spec without it is outside the rule entirely. Until
  `spec-writer` makes it required for new specs, or a check refuses a
  new spec without it, the gate covers what authors opt into.
- **The body is compared at the first change's parent.** Read literally,
  "the body at that first change" includes that commit's own edits.
  Measured on #721: its first implementation commit also amended the
  spec, so the literal reading failed it, while the same amendment one
  commit later would have passed, since later edits are never compared.
  The parent -- the plan as implementation began -- is the reading under
  which the two agree.
- **Merge commits, not squash.** The named commit must stay an ancestor,
  which holds because PRs here merge with a merge commit. Rebasing a
  branch after its plan review rewrites the named commit, and the line
  must then be re-pointed at the reviewed head's new id.

## Open decisions (for review)

1. **Must a plan be reviewed before code?** **Resolved 2026-10-23 by the
   owner: yes, with `/code-review` and `/pr-review`** ("Is a plan reviewed
   before its code?" above). The options as they were weighed: since
   2026-07-01, 90 of the 120
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

   **Resolved 2026-10-24 by the owner: (a), and `barwise/trial/`
   fixtures are not marked** -- a reviewer may need to read them, and a
   mark would collapse them in GitHub's diff. One owner for three readers:
   this script (through `lib/generated.mjs`), REVIEW.md (which now points
   at the file rather than restating the list), and GitHub's diff view. A
   drift test (`scripts/tests/generated-marks.test.mjs`) holds every
   `regen:*` output to the mark and the review-tiers generated row to the
   marked files. One output is exempt from the row by name: the tiers
   pattern language has no partial-segment wildcard, so the reference
   models (`evals/*.reference.orm.yaml`) cannot be spelled without also
   routing the hand-written `suite.yaml` beside them.
3. **The root `plan.md`: delete, or archive.** **Resolved 2026-10-23 by
   the owner: delete** (WS1). It is not in spec format and its work is
   done.
4. **Should an ad hoc `PLAN.md` be refused?** Agents in plan mode write plan
   files, and one that lands outside `docs/specs/` gets no review and no
   Status. **Resolved 2026-10-24 by the owner: report it, not refuse
   it.** WS3 lists an added
   `plan.md` or `PLAN.md` outside `barwise/docs/specs/` at the top of its
   report.

5. **Which PRs does `check:plan-review` cover?** **Resolved 2026-10-23 by
   the owner: (b), only PRs that name the spec.** As first written, any PR
   that changed a file a Draft spec owns in `Touches:`. Six review findings
   across three rounds on PR #714 were one recurring failure of that
   rule: an unrelated PR edits a shared file (`ci.yml`, a skill,
   `review-tiers.json`, an eval suite) that some Draft spec lists, and
   fails for want of that spec's plan review. The `WIRING` list patches
   it one file at a time, and widening it to skills weakened the rule
   for skill-only workstreams. Options:
   - (a) Keep the rule and keep growing `WIRING`.
   - (b) Cover only PRs that name the spec: its file is in the diff, or
     its file name is in a commit message on the branch. That is the
     rule this spec already uses to find a PR's plan, and `pr-creation`
     already requires a PR to name the workstream it implements. An
     unrelated PR names no Draft spec, so it is never covered; `WIRING`
     then matters only to `audit:specs`.

   It fixes the cause rather than the instances. Its risk is a PR that implements a spec without naming it; the scope
   report prints "no plan found" for a substantive PR, and `pr-review`
   already checks that a PR names its workstream.

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
  alternative or brace expansion in `spec-reader`.
- If authors start naming every file in the spec to empty the list, the
  report has become a target. Stop showing the count and show only the
  list.

## Non-goals

- No change to `pr-creation`'s split rule or to who decides a split.
- No gate on size, scope, or the presence of a spec. The two gates this
  spec adds check the `Touches:` declaration and the plan-review order,
  not size or scope.
