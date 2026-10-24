# Tell a pull request when only the tracker stands between it and main

Status: Draft -- no workstream implemented

Created: 2026-10-24
Last-updated: 2026-10-24
Tracking: barwise-ojo
Touches: +.github/workflows/tracker-conflicts.yml, +barwise/scripts/tracker-conflicts.mjs, +barwise/scripts/lib/tracker-conflicts.mjs, +barwise/scripts/tests/tracker-conflicts.test.mjs, barwise/scripts/tests/expected-counts.json, .claude/skills/steward/SKILL.md

## Principle

The merge driver (`beads-merge-driver.spec.md`) solved the tracker
conflict once, centrally, but only where git runs it: a local merge.
GitHub runs no custom driver, so a PR that added an issue can show as
conflicted after main moves, and nothing tells its owner that one local
`git merge origin/main` clears it. No event wakes an agent when main
moves under a PR, and PR #704 sat conflicted for hours at a time. The
owner chose (decision 1(c) of that spec) a workflow that notices and
comments, and pushes nothing.

**Resolution in one sentence:** when main moves, or when a PR into main
is pushed, a workflow finds each PR whose only conflict with main is the
tracker. It runs the driver's own merge on that file in-process and
keeps one comment per conflict episode on the PR saying what a local
merge will do.

## How does the workflow decide? (resolved: git's merge for the paths, the driver's own function for the tracker)

For each open PR whose base is `main`:

1. **Which paths conflict on GitHub.** `git merge-tree --write-tree
   --name-only main <pr-head>`, in a clone with no `merge.beads.*`
   config, so the tracker is line-merged as GitHub merges it. It runs in
   memory: no checkout, no index, no hooks. Probe against git 2.43: an
   undefined driver line-merges and lists the tracker as conflicted.
2. **What a local merge would do to the tracker**, only when the
   tracker is the sole conflicted path. The script reads the tracker
   from the merge base, main and the PR head (`git show <rev>:.beads/issues.jsonl`)
   and calls `resolveTracker` from `scripts/lib/beads-merge.mjs`, the
   driver's own function, in-process. When there is more than one merge
   base, it uses their common ancestor, the base
   `merge.beads.recursive=binary` gives the installed driver.

Calling the function rather than running the driver through git returns
a structured answer instead of an exit code: the ids that need a person
and the reason for each, or which version is malformed. Nothing has to
locate a driver script or parse its stderr.

**The verdict, first matching rule:**

| Conflicted paths (step 1) | Tracker (step 2)             | Verdict        | The comment says                                                                                 |
| ------------------------- | ---------------------------- | -------------- | ------------------------------------------------------------------------------------------------ |
| none                      | (not run)                    | `clean`        | (only edits an open comment: the conflict is gone)                                               |
| any path but the tracker  | (not run)                    | `other`        | (only edits an open comment: it now conflicts elsewhere too, and needs hand resolution)          |
| only the tracker          | merges with nothing reported | `resolves`     | a local merge resolves it with no hand work                                                      |
| only the tracker          | reports ids                  | `needs-person` | a local merge resolves all but these ids, each with its reason                                   |
| only the tracker          | an input is malformed        | `malformed`    | the tracker on main or on the PR is not valid, naming which; a local merge falls back to markers |

Every comment that tells someone to merge also says to run
`npm run prepare` first if their clone has not installed the driver,
since without it git line-merges the file.

## One comment per conflict episode (resolved: open while it applies, then closed)

The comment carries a hidden marker with its state:
`<!-- barwise:tracker-conflict state=open -->` or `state=closed`.

- When the verdict calls for a comment (`resolves`, `needs-person`,
  `malformed`) and the PR has an **open** marked comment, the workflow
  edits it to the current verdict and main's commit.
- When it calls for a comment and the PR has none, or only **closed**
  ones, the workflow posts a new comment. A new conflict episode is a
  new comment, because an edit sends no notification and fires no
  `issue_comment` event, and notifying is the point.
- When the verdict is `clean` or `other` and the PR has an open marked
  comment, the workflow edits it to say so and marks it closed. Nothing
  is posted for `clean` or `other` otherwise: the PR page already shows
  a non-tracker conflict.

## What triggers a run? (resolved: main moving, and a PR into main being pushed)

- **`push` to `main`**: every open PR into main is checked, because
  main moving is what conflicts them.
- **`pull_request_target`** (`opened`, `synchronize`, `reopened`) on a
  PR into main: that PR alone is checked. This closes an open comment
  as soon as the owner pushes the merge, and catches a PR whose own push
  made the conflict.
- **`workflow_dispatch`**: every open PR into main, for a manual
  re-check.

One `concurrency` group per PR number for the PR trigger, and one for
the full scan, each cancelling the older run.

## Why is this safe with a write token? (resolved: no PR code runs)

`REVIEW.md` lists "a workflow that runs PR code with a write token" as a
security trigger, so this spec answers it directly.

- **Checkout.** Every trigger checks out `main` explicitly (`ref:` set
  to the default branch, as `copilot-review.yml` does), so the script
  and the driver function always come from main. That holds under
  `workflow_dispatch` from another branch and under
  `pull_request_target`.
- **What the PR supplies.** The PR head is fetched as
  `refs/pull/<n>/head`, which lives in the base repository for fork PRs
  too. It is read as data: by `git merge-tree`, which runs no hooks and
  checks nothing out, and by `git show`, which prints a blob.
- **`.gitattributes` is the one PR-controlled input git acts on.** With
  no `merge.*` config in the clone, any driver it names is undefined and
  git line-merges. Drivers, filters and their commands live in git
  config, never in the tree, so a PR cannot name a command to run.
- **No PR-controlled string reaches a shell.** PR numbers and SHAs come
  from the event or the API and are validated as an integer and 40 hex
  characters before use. Titles and branch names are never used. Comment
  bodies are built from the verdict and from issue ids, which are
  checked against the tracker's id pattern before they are quoted.
- **Token scope.** `contents: read` and `pull-requests: write`, the
  second only to post and edit the comment. It cannot push to a branch.

## Scope

In scope:

- When a run checks a PR, the workflow shall assign it a verdict by the
  table above and act on the comment rules.
- When a PR's base is not `main`, the workflow shall skip it.
- When fetching or classifying one PR fails, the workflow shall record
  that PR as unchecked, with the reason, in the job summary and as a
  warning annotation, and go on to the rest.
- When every PR in a run went unchecked, or the PR list itself cannot be
  read, the script shall exit 2, "could not answer"
  (`gate-refusal-contract.spec.md`). One unreadable PR does not turn
  every later run red, which would teach readers to ignore the color.
- When `git merge-tree` does not support `--write-tree` (git older than
  2.38), the script shall exit 2, naming the version it needs.

Out of scope:

- Pushing the merge for the PR's owner (decision 1(b) of the driver
  spec). It needs write access to people's branches. It can follow if
  these comments turn out to be ignored.
- PRs into branches other than `main`. Stacked PRs merge into their own
  base, and a verdict against main would be wrong.

## Inventory

| Path                                               | Current state                | Verdict                                                                                                                        |
| -------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `.github/workflows/tracker-conflicts.yml`          | does not exist               | new: the three triggers; checkout of `main` with full history; setup-node from `.nvmrc`; runs the script                       |
| `barwise/scripts/lib/tracker-conflicts.mjs`        | does not exist               | new, pure: `verdict(conflictedPaths, trackerResult)`, `commentAction(verdict, existingComments)`, `commentBody(verdict, ...)`  |
| `barwise/scripts/tracker-conflicts.mjs`            | does not exist               | new: lists PRs, fetches heads, runs `merge-tree`, reads the three tracker versions, calls `resolveTracker`, posts or edits     |
| `barwise/scripts/lib/beads-merge.mjs`              | the driver's pure resolution | untouched: imported and called, as the driver calls it                                                                         |
| `barwise/scripts/tests/tracker-conflicts.test.mjs` | does not exist               | new: every verdict and comment rule against the pure lib; real `merge-tree` and `git show` in temp repos; a fake GitHub client |
| `barwise/scripts/tests/expected-counts.json`       | registered test counts       | gains the new file's count                                                                                                     |
| `.claude/skills/steward/SKILL.md` section 1        | says GitHub runs no driver   | one sentence: the workflow's comment is the cue to merge main                                                                  |

## Alternatives considered

- **Run the driver through `git merge-tree` a second time.** The first
  draft did this. An exit code cannot tell a real disagreement from a
  malformed file or a driver that never started, so a failure read as
  "issues both sides changed differently". Calling `resolveTracker`
  returns which of those it is.
- **GitHub's `mergeable` flag alone.** It says a PR conflicts, not on
  which paths, and it is computed lazily, so it is often `null` right
  after a push.
- **Check out each PR and run `git merge`.** This is heavier for the
  same answer, runs hooks, and gives PR content a working directory.
- **Edit one comment forever.** The first draft did this. A PR that
  conflicts a second time would be updated silently, because GitHub
  sends no notification for an edit.
- **A scheduled run.** Main moving and the PR moving are the causes, so
  triggering on them answers when it matters. A schedule adds latency.

## Workstreams

### 1. The workflow, the script, and the steward sentence

One PR. Acceptance:

- When the test suite runs, every verdict row and every comment rule
  shall have a case against the pure lib. Each verdict shall also have a
  case running the real `merge-tree` and `git show` in a temp
  repository. Each case shall have been seen failing first, through
  `mutate.mjs`.
- When a PR conflicts on the tracker a second time after its comment
  was closed, the script shall post a new comment and leave the closed
  one alone.
- When an open comment's PR moves to `other` or `clean`, the script
  shall edit that comment and mark it closed.
- When one PR cannot be fetched, the others shall still be checked, the
  summary shall name it, and the script shall exit 0. When none can be
  checked, it shall exit 2.
- When a PR's base is not `main`, it shall not be checked.
- The workflow shall check out `main` explicitly under every trigger
  and have `permissions: contents: read, pull-requests: write`.
  `/security-review` shall run on the PR, per `REVIEW.md`.

## Decisions (owner, 2026-10-24)

1. **Comment on a real tracker disagreement? Decided: yes.** The PR
   still needs only a local merge to show what is left, and silence
   would leave the case that most needs a person without a cue. The
   comment names the ids, which the in-process call makes available.
2. **When the conflict is gone? Decided: edit the comment, do not
   delete it.** An edited comment records what happened for someone
   reading an old notification. A later conflict gets a new comment, by
   the episode rule above.

## Risks and testing

- **A wrong `resolves` verdict sends someone to merge a PR with a real
  conflict.** Guarded: the paths come from git's own merge, and the
  tracker verdict from the same function the driver runs. The tests run
  both for real.
- **Comment noise.** At most one open comment per PR, and a new one only
  for a new episode. The marker and its state are pinned by tests.
- **Runner git too old for `merge-tree --write-tree`.** The script
  refuses with exit 2.

## Non-goals

- No change to the driver or to how the tracker is merged.
- No write access to any branch.
