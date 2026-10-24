# Tell a pull request when only the tracker stands between it and main

Status: Draft -- no workstream implemented

Created: 2026-10-24
Last-updated: 2026-10-24
Tracking: barwise-ojo
Touches: +.github/workflows/tracker-conflicts.yml, +barwise/scripts/tracker-conflicts.mjs, +barwise/scripts/lib/tracker-conflicts.mjs, +barwise/scripts/tests/tracker-conflicts.test.mjs, barwise/scripts/tests/expected-counts.json, .claude/skills/steward/SKILL.md

## Principle

The merge driver (`beads-merge-driver.spec.md`) solved the tracker
conflict once, centrally, but only where git runs it: a local merge.
GitHub runs no custom driver, so after every push to main a PR that
added an issue can show as conflicted, and nothing tells its owner that
one local `git merge origin/main` clears it. No event wakes an agent
when main moves under a PR, and PR #704 sat conflicted for hours at a
time. The owner chose (decision 1(c) of that spec) a workflow that
notices and comments, and pushes nothing.

**Resolution in one sentence:** on every push to main, a workflow
test-merges each open PR with `git merge-tree`, with and without the
driver. Where the tracker is the only conflict, it posts one comment on
that PR, saying a local merge resolves it, and edits that same comment
on later runs instead of adding another.

## How does the workflow know the tracker is the only conflict? (resolved: two in-memory test merges)

GitHub's `mergeable` flag says that a PR conflicts, not where. So the
workflow merges each open PR's head with main itself, twice, using
`git merge-tree --write-tree --name-only`:

1. **Without the driver**: the runner's clone has no `merge.beads.*`
   config, so git line-merges the tracker as GitHub does. The conflicted
   paths are what the PR page is complaining about.
2. **With the driver**: the same merge with
   `-c merge.beads.driver="sh barwise/scripts/beads-merge-driver.sh %O %A %B %P"`
   and `-c merge.beads.recursive=binary`, from main's checkout. The
   conflicted paths are what a local merge would leave.

`merge-tree` merges in memory: no checkout, no index, no hooks. It
honours `.gitattributes` and a driver given on the command line. Both
were checked with probes against git 2.43: an undefined driver
line-merges and reports the conflict, and a configured one resolves the
tracker and reports only the other paths.

**Per open PR, the first matching rule decides:**

| Without driver           | With driver    | Action                                                                                  |
| ------------------------ | -------------- | --------------------------------------------------------------------------------------- |
| no conflict              | (not run)      | none                                                                                    |
| any path but the tracker | (not run)      | none: a conflict a person must resolve anyway, and the PR page already says so          |
| only the tracker         | no conflict    | comment: a local `git merge origin/main` resolves it with no hand work                  |
| only the tracker         | still conflict | comment: a local merge resolves everything except issues both sides changed differently |

The comment carries a hidden marker, `<!-- barwise:tracker-conflict -->`.
When a marked comment already exists, the workflow edits it, recording
main's commit and the current verdict, and never posts a second. When a
PR stops conflicting, the existing comment is edited to say so, so a
reader never acts on a stale instruction.

## Why is this safe with a write token? (resolved: no PR code runs)

`REVIEW.md` lists "a workflow that runs PR code with a write token" as a
security trigger, so this spec answers it directly.

- **Trigger and checkout.** The workflow runs on `push` to `main` (and
  `workflow_dispatch`). It checks out main. Both the driver it registers
  and the script it runs come from main.
- **What the PR supplies.** Each PR's head is fetched as
  `refs/pull/<n>/head` and passed to `git merge-tree` as data. merge-tree
  runs no hooks and checks nothing out.
- **The one PR-controlled input git acts on is `.gitattributes`.** A PR
  can route other files to the `beads` driver, which only runs main's
  driver on more data. Drivers, filters and their commands live in git
  config, not in the tree, so a PR cannot name a command to run.
- **No PR-controlled string reaches a shell.** PR numbers arrive from
  the API as integers. Titles and branch names are never used.
- **Token scope.** `contents: read` and `pull-requests: write`. The
  second is only for posting and editing the comment. It cannot push to
  any branch.

## Scope

In scope:

- When main receives a push, the workflow shall classify every open PR
  by the table above and act on its row.
- When a PR's row calls for a comment and a marked comment exists, the
  workflow shall edit that comment instead of posting another.
- When a PR with a marked comment no longer conflicts, the workflow
  shall edit the comment to say the conflict is gone.
- When the GitHub API or a fetch fails for one PR, the workflow shall
  report that PR as unchecked and go on to the rest. It shall exit
  non-zero at the end if any PR went unchecked, so the run is red rather
  than silently partial (`gate-refusal-contract.spec.md`).
- When two pushes to main arrive close together, the workflow shall
  cancel the older run (one `concurrency` group).
- When `git merge-tree` is too old to support `--write-tree`, the script
  shall refuse with exit 2, naming the version it needs.

Out of scope:

- Pushing the merge for the PR's owner (decision 1(b) of the driver
  spec). It needs write access to people's branches. It can follow if
  these comments turn out to be ignored.
- Naming the issues behind a real tracker disagreement in the comment.
  The local merge names them, and parsing driver stderr in CI adds a
  second consumer of a message format meant for people.
- Fork PRs whose head cannot be fetched with the default token. They
  are reported as unchecked, by the rule above.

## Inventory

| Path                                               | Current state                     | Verdict                                                                                                               |
| -------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/tracker-conflicts.yml`          | does not exist                    | new: on push to main; checkout with full history; setup-node from `.nvmrc`; runs the script                           |
| `barwise/scripts/lib/tracker-conflicts.mjs`        | does not exist                    | new, pure: `classify(without, with)` returning the table's action, and `commentBody(verdict, mainSha)`                |
| `barwise/scripts/tracker-conflicts.mjs`            | does not exist                    | new: lists open PRs, fetches heads, runs the two merge-trees, posts or edits comments; GitHub client injectable       |
| `barwise/scripts/tests/tracker-conflicts.test.mjs` | does not exist                    | new: `classify` for every row; real merge-trees in temp repos for each row; posting and editing against a fake client |
| `barwise/scripts/tests/expected-counts.json`       | registered test counts            | gains the new file's count                                                                                            |
| `.claude/skills/steward/SKILL.md` section 1        | says GitHub runs no driver        | one sentence: the workflow's comment is the cue to merge main                                                         |
| `barwise/scripts/beads-merge-driver.sh`            | the wrapper; finds its node files | untouched: run in place from the repository, where it finds the driver beside itself                                  |

## Alternatives considered

- **GitHub's `mergeable` flag alone.** It says a PR conflicts, not on
  which paths. It is also computed lazily, so right after a push it is
  often `null`.
- **Check out each PR and run `git merge`.** This touches a work tree
  and runs hooks, which is heavier for the same answer and gives PR
  content a working directory. merge-tree needs neither.
- **`pull_request_target` on each PR.** The trigger is main moving, not
  the PR changing. A PR-triggered workflow would miss exactly the case
  this exists for.
- **A scheduled run.** Main moving is the cause, so a push trigger
  answers at the moment it changes. A schedule adds latency and runs
  when nothing moved.

## Workstreams

### 1. The workflow, the script, and the steward sentence

One PR. Acceptance:

- When the test suite runs, every row of the table shall have a case
  against `classify`, and a case running both real merge-trees in a temp
  repository. Each case shall have been seen failing first, through
  `mutate.mjs`.
- When the script runs against a fake client for a PR with no marked
  comment, it shall post one; with one, it shall edit it and post none.
- When a PR with a marked comment no longer conflicts, the script shall
  edit the comment to say so.
- When fetching one PR fails, the others shall still be classified, and
  the script shall exit non-zero naming the unchecked PR.
- The workflow shall have `permissions: contents: read,
  pull-requests: write`, and `/security-review` shall run on the PR, per
  `REVIEW.md`.

## Decisions (owner, 2026-10-24)

1. **Comment on a real tracker disagreement (the table's last row)?
   Decided: yes.** The PR still needs only a local merge to show what is
   left, and silence would leave the case that most needs a person
   without a cue. The alternative was to comment only when the driver
   resolves everything.
2. **When the conflict is gone? Decided: edit the comment, do not
   delete it.** An edited comment records what happened for someone
   reading an old notification; a deleted one leaves them nothing.

## Risks and testing

- **A wrong "only the tracker" verdict sends someone to merge a PR with
  a real conflict.** Guarded: the verdict comes from git's own merge,
  run twice, and the tests run real merge-trees for every row.
- **Comment noise.** One comment per PR, edited in place. The marker is
  the key, and the tests pin it.
- **Runner git too old for `merge-tree --write-tree` (needs 2.38).** The
  script refuses with exit 2 rather than misreporting.

## Non-goals

- No change to the driver or to how the tracker is merged.
- No write access to any branch.
