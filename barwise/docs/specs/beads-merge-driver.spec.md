# A merge driver for the tracker, registered where the repository is set up

Status: Draft -- no workstream implemented

Created: 2026-10-23
Last-updated: 2026-10-23
Tracking: barwise-nto

## Principle

`.gitattributes` routes `.beads/issues.jsonl` to a merge driver named
`beads` that nothing registers. Git does not report an unknown driver.
It falls back to a line merge without a word, and any two branches
that each added an issue conflict on the file. PR #704 hit that six
times in three days, and every resolution was done by hand with a
script written in the session. The rule those resolutions applied is
the steward skill's section 1: union by id, and a reused id is a
collision. It is deterministic and already decided, so it should be
solved once, centrally, rather than re-derived at every merge
(CLAUDE.md, "define errors out of existence"). The `.gitattributes`
line is the explicit declaration the repository already chose. The
defect is that the name points at nothing.

**Resolution in one sentence:** ship a three-way, field-level merge
driver for the tracker, installed by `prepare` into the clone's git
directory so it works on any branch, writing git conflict markers for
anything it cannot decide.

## How does the driver decide? (resolved: three-way, per id, then per field)

The driver reads all three versions git passes: the base (`%O`), the
current side (`%A`, written back as the result) and the other side
(`%B`). Below, "base", "current" and "other" mean those three. In a
merge, current is the branch being merged into. In a rebase, git swaps
them, and current is the upstream. The rules are symmetric except for
output order, so the swap changes nothing but the order of lines.

A two-way union, which is what PR #704 used by hand, cannot tell a
deletion from an addition, so it resurrects every issue one side
deleted. Issues are deleted: PR #704 removed `barwise-y2m` as a
duplicate with `beads-crud.mjs delete`. The base is what tells them
apart.

**Per id, the first matching rule wins:**

1. The id is in current and other with different `created_at`: a
   **collision**, reported. Two issues minted the same id. This is the
   test `check-beads.sh` already applies to a reused id (barwise-984).
   Titles are not used, because they are edited legitimately.
2. Current and other are identical, or the id is absent from both:
   keep that line, or no line.
3. The id is in base, and one side has it unchanged from base: take the
   other side, including a deletion.
4. The id is in base, one side deleted it and the other changed it:
   **conflict**, reported.
5. The id is in only one side: keep it (an addition).
6. Otherwise both sides have the id and at least one changed it: merge
   field by field, below.

**Per field** (rule 6), for each key in the union of the three objects:

- If only one side changed the field from base, take that side's value.
  This includes adding a key and removing one.
- If both sides changed it to the same value, take that value.
- `updated_at` changed on both sides: take the later value.
- `dependency_count` and `dependent_count` are derived. They are
  recomputed after the merge (below) and never compared.
- Any other field changed on both sides to different values:
  **conflict**, reported.

Values are compared as JSON, so an array such as `labels` or
`dependencies` is one value. Two sides that each append a different
label conflict rather than being unioned, because the tracker has no
rule saying a label list is a set, and inventing one here would be a
decision the driver is not entitled to make.

A whole-line "later `updated_at` wins" rule was the first draft. It
lost concurrent edits to different fields. For example, main closes an
issue in a steward follow-up while a branch later appends a note to
it. The branch's line is newer, so a whole-line merge reopens the
issue on main with no conflict shown. With the base in hand, the field
merge keeps both edits.

**After every id:** recompute `dependency_count` and `dependent_count`
for each issue in the result, from the merged `dependencies`. The
computation is the one `beads-crud.mjs` runs on write (Inventory: it
moves to a shared module and is not copied). This also stops two
branches that each added a blocker to one epic from colliding on that
epic's counts. Neither branch bumps the epic's `updated_at` when it
does that.

Within a line, keys keep the current side's order, and keys only the
other side has follow in its order. Each line is written through the
canonical serializer `beads-crud.mjs` uses. A line that comes through
unchanged is copied byte for byte.

**A reported case** is written into the result as a git conflict block
around the two candidate lines (current, then other), and the driver
exits non-zero. `check-beads.sh` already rejects a line beginning with
`<<<<<<<`, `=======` or `>>>>>>>`. So a reported case cannot be
committed by a careless `git add`: pre-commit, pre-push and CI all
refuse the file until a person resolves the block. The first draft
wrote a marker-free "best guess" for a conflict, and a plain `git add`
would have accepted it with nothing downstream able to tell.

**A dependency is the one case per-id rules cannot see.** One side
deletes an issue that the other side added a dependency on. Each input
is valid alone, and the merged file has a dangling `depends_on_id`.
The driver does not re-implement that check, because a second copy of
`check-beads.sh`'s rule would have to be kept in step with it. The
validation hook below runs `check-beads.sh` itself on the merge commit.
On a rebase, which runs no merge hook, the pre-push gate and CI run it.

## Scope

In scope:

- When git merges `.beads/issues.jsonl` and both sides changed it, the
  driver shall resolve it by the rules above. It shall exit zero only
  when nothing was reported.
- When the driver reports a case, it shall write a conflict block for
  that id and name every reported id on stderr, with the reason and the
  steward procedure.
- When an input has a line that is not valid JSON or has no `id`, the
  driver shall leave the current side's file unchanged, name the input
  and the line, and exit non-zero. Blank lines are skipped, as
  `check-beads.sh` and `beads-crud.mjs` already skip them. An empty
  base (both sides added the file) is valid.
- When `npm run prepare` runs, it shall copy the driver and the modules
  it imports into `$(git rev-parse --git-common-dir)/barwise-merge/`,
  and register that copy by absolute path as `merge.beads.driver`, with
  `merge.beads.name`. Running it again shall replace both.
- When the session-start hook runs `prepare`, it shall also read back
  `merge.beads.driver`, and warn if it is unset, the way it already
  warns about `core.hooksPath`.
- When git records a merge commit that changes the tracker, the
  `pre-merge-commit` hook shall run the same staged-tracker validation
  the pre-commit hook runs. Both hooks shall call one shared script.
  Git runs pre-commit, not pre-merge-commit, when a conflicted merge
  is concluded with `git commit`, so between them every merge commit is
  covered.
- When `.gitattributes` names a merge driver for the tracker, a test
  shall fail unless `prepare` registers a driver of that name.

Out of scope:

- The conflict GitHub shows on a pull request. GitHub runs no custom
  merge driver, so a PR stays marked conflicted until someone merges
  the base into it locally. With this spec that merge needs no hand
  resolution. Noticing it is needed is decision 1, a comment workflow
  tracked as barwise-ojo.
- One file per issue (decision 2: deferred).
- Changing what `beads-crud.mjs` writes. Only where two of its
  functions live changes.

## Why install a copy into the git directory? (resolved: the branch being merged into may predate the driver)

Git runs the configured command in the work tree being merged into.
The first draft registered the driver by its path in the work tree
(`node barwise/scripts/beads-merge-driver.mjs`). A branch cut before
the driver landed has no such file, so a later `git merge origin/main`
on that branch would call a missing script. Node would exit 1, and git
would leave the current side's file whole and unmarked. A `git add`
would then drop every issue main added, which is worse than today's
line merge, whose markers at least fail validation. A copy under the
git common directory exists for every branch and every linked
worktree, and `prepare` refreshes it.

## Inventory

| Path                                            | Current state                                                 | Verdict                                                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `.gitattributes`                                | `merge=beads`, comment "Use bd merge"                         | keeps the attribute; the comment names the driver and where it is installed                                            |
| `barwise/package.json` `prepare`                | `cd .. && husky barwise/.husky`                               | also runs the installer                                                                                                |
| `barwise/scripts/lib/beads-jsonl.mjs`           | does not exist                                                | new: `canonicalLine` and `recomputeCounts`, moved out of `beads-crud.mjs`, which imports them                          |
| `barwise/scripts/beads-crud.mjs`                | owns `canonicalLine` and `recomputeCounts`                    | imports both from `lib/beads-jsonl.mjs`; output unchanged                                                              |
| `barwise/scripts/lib/beads-merge.mjs`           | does not exist                                                | new: the pure resolution (`resolveTracker`), no I/O                                                                    |
| `barwise/scripts/beads-merge-driver.mjs`        | does not exist                                                | new: the `%O %A %B %P` entry point                                                                                     |
| `barwise/scripts/install-merge-driver.mjs`      | does not exist                                                | new: copies the driver and its imports into the git common directory and sets the config; refuses outside a repository |
| `barwise/scripts/hooks/check-staged-tracker.sh` | does not exist; the logic is inline in pre-commit             | new: the shared staged-tracker validation, keeping the `GIT_DIR`/`GIT_WORK_TREE` pin (barwise-hud)                     |
| `barwise/.husky/pre-commit`                     | validates a staged tracker inline                             | calls the shared script                                                                                                |
| `barwise/.husky/pre-merge-commit`               | does not exist; pre-commit does not run for a clean merge     | new: calls the shared script                                                                                           |
| `.claude/hooks/session-start.sh`                | runs `npm run prepare`; reads back only `core.hooksPath`      | also reads back `merge.beads.driver` and warns if it is unset                                                          |
| `barwise/scripts/tests/beads-merge.test.mjs`    | does not exist                                                | new: the rules against the lib, and real `git merge` runs in temp repositories                                         |
| `.claude/skills/steward/SKILL.md` section 1     | the rule in prose, applied by hand; collision tested by title | says the driver applies it; collision by `created_at`; the field rule; the hand procedure for reported cases           |
| root `CLAUDE.md`, Beads section                 | no mention of merging                                         | one sentence: the driver and where it is installed                                                                     |

`canonicalLine` and `recomputeCounts` move to a shared module rather
than being copied into the driver, because CLAUDE.md forbids a copy
that must agree with other code. The driver must write the same
canonical form and the same counts `beads-crud.mjs` writes, or the
next `beads-crud.mjs` write would rewrite every merged line.

## Target architecture

```
.gitattributes            .beads/issues.jsonl merge=beads
git config (per clone)    merge.beads.driver =
                            node <git-common-dir>/barwise-merge/beads-merge-driver.mjs %O %A %B %P
                          written by scripts/install-merge-driver.mjs, run from `prepare`

beads-merge-driver.mjs    read %O %A %B -> lines (blank lines skipped)
                          resolveTracker(base, current, other)   (lib/beads-merge.mjs, pure)
                            -> { lines, reported: [{ id, reason }] }
                          counts via recomputeCounts, lines via canonicalLine
                            (lib/beads-jsonl.mjs, shared with beads-crud.mjs)
                          write lines, with a conflict block per reported id, to %A
                          reported.length ? list them on stderr, exit 1 : exit 0

.husky/pre-commit         -> scripts/hooks/check-staged-tracker.sh
.husky/pre-merge-commit   -> scripts/hooks/check-staged-tracker.sh
```

Git runs a merge driver from the top of the work tree, even when the
merge is started from a subdirectory. It passes `%O`, `%A` and `%B` as
temporary files, and the result must be written to `%A`.

## Alternatives considered

- **Union by id with no base.** What PR #704 ran by hand. It reverses
  deletions with no signal.
- **Whole-line "later `updated_at` wins".** The first draft. It loses
  concurrent edits to different fields of one issue.
- **Git's built-in `merge=union`.** It keeps both sides' lines, so an
  issue edited on both sides appears twice with one id. That swaps a
  conflict git reports for a duplicate-id failure found only at the
  next validation.
- **Register the work-tree path.** The second draft. It breaks on any
  branch that predates the driver, and breaks silently.
- **Register in the pre-commit or pre-push hook.** Too late. The driver
  runs during `git merge`, before any commit or push hook fires.
- **Install `bd` and keep `bd merge`.** CLAUDE.md made `beads-crud.mjs`
  the interface so that no container needs `bd`.

## Workstreams (each independently shippable)

### 1. The driver, its installation, the shared validation hook, and the docs

Everything in the Inventory, in one PR. The pieces are useless apart:
an unregistered driver is the current defect, and a registered driver
with no hook lets a dangling dependency through a clean merge.
Acceptance:

- When the test suite runs, every rule above shall have a case,
  including one run as a rebase. Each case shall have been seen failing
  first, through `mutate.mjs` on the lib.
- When two branches that each added an issue are merged in a temp
  repository with this `.gitattributes` and the installed driver, the
  merge shall complete with no conflict, and the file shall hold both
  issues.
- When main closes an issue and a branch later appends a note to it,
  the merged issue shall be closed and keep the note.
- When one side deletes an issue the other side edited, `git merge`
  shall stop with a conflict block in the file, and `check-beads.sh`
  shall reject the file with its conflict-marker error.
- When the branch being merged into has no
  `barwise/scripts/beads-merge-driver.mjs`, the merge shall still use
  the installed copy and complete.
- When one side deletes an issue the other side added a dependency on,
  the merge commit shall be refused by the validation hook with
  `check-beads.sh`'s dangling-dependency error.
- Every `check-beads.sh` run in these tests shall be the repository's
  own script, run with the temp repository's tracker path as its
  argument, and shall assert the specific error text, not only a
  non-zero exit.
- When `npm run prepare` runs twice, `git config --get
  merge.beads.driver` shall print one value, naming an absolute path
  that exists.

## API and migration impact

- No package changes. Only scripts, hooks, the `prepare` script, and
  two documents change.
- Existing clones get the driver at their next `npm run prepare`.
  Session containers run it at every start. A clone that never runs it
  behaves exactly as today, and the session-start hook now says so.
- A clone with `bd` installed may have its own `merge.beads.driver`.
  `prepare` replaces it. That is intended: CLAUDE.md says `bd` is not
  part of the interface.
- **The steward rule changes in substance, not only in who applies
  it.** A field-level merge replaces "the later `updated_at` wins", and
  `created_at` replaces the title as the collision test. The PR that
  lands this names both in its body for the owner.

## Decisions (owner, 2026-10-23)

All three were answered on PR #718. Each records the options it chose
among, so a later reader can see what was set aside.

1. **Who merges the base into a pull request that conflicts only on
   the tracker? Decided: (c), a comment, as its own spec
   (barwise-ojo).** No event wakes an agent when a change to main makes
   a PR conflict, and GitHub does not run the driver. Options:
   - (a) Leave it to the PR's agent and to the steward skill's
     check-ins. Cost: hours of latency, as on PR #704.
   - (b) A workflow on every push to `main` that, for each open PR
     whose only conflicting path is `.beads/issues.jsonl`, merges main
     with this driver and pushes. Cost: a bot that pushes to people's
     branches. It also needs a token that can write to them, which
     `REVIEW.md` counts as a `/security-review` trigger.
   - (c) The same workflow, but it only comments on the PR. This fixes
     the noticing and leaves the push to whoever owns the branch.

   (c) closes the detection gap with no write access, and (b) can
   follow if the comments turn out to be ignored.
2. **One file per issue? Decided: deferred.** Storing each issue as
   `.beads/issues/<id>.json` would make concurrent additions touch
   different files, so they could never conflict. Ids are already
   random (`beads-random-ids.spec.md`). Cost: `bd` compatibility,
   rewrites of `beads-crud.mjs` and `check-beads.sh`, and a directory
   of about 600 files. Deferred because, with the driver in place, the
   remaining conflicts are real disagreements, which a per-file layout
   would surface in the same way.
3. **Equal `updated_at` with different content? Decided: report a
   conflict.** The other option was to prefer one side. Under the field
   rule this generalizes: a field both sides changed to different
   values is reported whatever the timestamps say, and `updated_at`
   itself takes the later value.

## Risks and testing

- **A driver bug corrupts the tracker on every merge.** Guarded by the
  per-rule tests, the end-to-end `git merge` tests, and the
  `pre-merge-commit` hook. Git does not run the pre-commit hook for
  the commit a clean merge makes (checked with a probe hook in a temp
  repository: it never ran), so until now a merge that wrote the
  tracker reached history without `check:beads --strict` seeing it
  until CI. A rebase runs no merge hook either; there the pre-push gate
  and CI are the guard.
- **The driver silently picks the wrong side.** Every choice it makes
  is a rule with a test. Every case the rules cannot decide becomes a
  conflict block, which no gate accepts.
- **A clone never runs `prepare`.** It keeps today's behaviour, and
  the session-start hook warns.

## Non-goals

- No change to how issues are written, validated, or numbered.
- No server-side resolution of a pull request's conflict state.
