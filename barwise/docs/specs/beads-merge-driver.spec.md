# A merge driver for the tracker, registered where the repository is set up

Status: Implemented 2026-10-24 -- the single workstream

Created: 2026-10-23
Last-updated: 2026-10-24
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
them, and current is the upstream. The rules are symmetric, so the swap decides nothing: it changes the
order of lines and, within an issue merged field by field, the order of
its keys.

A two-way union, which is what PR #704 used by hand, cannot tell a
deletion from an addition, so it resurrects every issue one side
deleted. Issues are deleted: PR #704 removed `barwise-y2m` as a
duplicate with `beads-crud.mjs delete`. The base is what tells them
apart.

"Identical" and "unchanged" below compare parsed objects, ignoring key
order and the two derived count fields (`dependency_count`,
`dependent_count`). Byte comparison would make a line that was only
re-serialized, or whose counts moved because another issue gained a
`blocks` edge on it, look like an edit. For example, a branch adds an
issue that blocks X, which raises X's `dependent_count`; if main
deleted X, byte comparison would report a delete-versus-edit conflict
instead of the dangling dependency it is.

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
- `updated_at` or `closed_at` changed on both sides: take the later
  value. Both are when an event happened, and two sides that each closed
  an issue agree that it is closed (added in implementation: a steward
  follow-up closing an issue the branch also closed is routine).
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
around two candidate lines, and the driver exits 3. For a field
conflict, the candidates are the field-merged object with current's
value, then with other's value, for the conflicting fields only, so
keeping either candidate keeps every field the driver did merge. Raw
side lines would make a person who keeps one side lose the other
side's non-conflicting edits, which is the loss the field merge exists
to prevent. For a collision or a delete-versus-edit conflict the
candidates are the two sides' lines, and an absent side is an empty
candidate. `check-beads.sh` already rejects a line beginning with
`<<<<<<<`, `=======` or `>>>>>>>`. So a reported case cannot be
committed by a careless `git add`: pre-commit, pre-push and CI all
refuse the file until a person resolves the block. The first draft
wrote a marker-free "best guess" for a conflict, and a plain `git add`
would have accepted it with nothing downstream able to tell.

**Every other failure falls back to git's own line merge.** Git treats
any non-zero driver exit as a conflict and keeps whatever is in `%A`.
If the driver crashes, cannot parse an input, or cannot start (node
missing from `PATH`, a broken copy), `%A` still holds the current side
unmarked, and `git add` would silently drop every issue the other side
added -- worse than today's line merge, whose markers at least fail
validation. So the registered command is a small `sh` wrapper, not
node. It runs the driver and passes through exit 0 (clean) and exit 3
(conflict blocks written, reported to git as 1). On any other status
it runs `git merge-file -L current -L base -L other "$A" "$O" "$B"`,
which writes a marked line merge into `%A`, and exits 1. Exit 3 is
chosen because node itself exits 1 for an uncaught exception and a
missing module, so 1 cannot mean "the driver decided". A malformed
input line (not valid JSON, or no `id`) is a driver failure on this
path: it exits 2 after naming the input and the line, and the person
gets today's markers rather than a silent loss. The driver writes `%A`
once, at the end, so a crash cannot leave a half-written file for the
fallback to merge.

**A criss-cross merge** has more than one merge base, and git builds a
virtual base by merging them first, using `merge.beads.recursive` for
that inner merge. Left unset, git would run this driver there, and a
reported case would put markers into the virtual base, which the outer
run would then refuse as malformed. The installer sets
`merge.beads.recursive` to `binary`, which takes the bases' common
ancestor for that inner merge without conflict. The outer run then sees
the changes both bases made as changes on both sides, and rule 2 and
the per-field rules treat equal changes as agreement. (Checked with a
criss-cross probe: with two merge bases and `recursive = binary`, the
driver ran once, for the outer merge, and its `%O` was the bases'
common ancestor.)

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
  driver shall resolve it by the rules above. It shall exit 0 only
  when nothing was reported.
- When the driver reports a case, it shall write a conflict block for
  that id, name every reported id on stderr with the reason and the
  steward procedure, and exit 3.
- When an input has a line that is not valid JSON or has no `id`, the
  driver shall name the input and the line and exit 2, and the wrapper
  shall fall back to a marked line merge. Blank lines are skipped, as
  `check-beads.sh` and `beads-crud.mjs` already skip them. An empty
  base (both sides added the file) is valid.
- When the driver exits with any status other than 0 or 3, or cannot
  start, the wrapper shall write `git merge-file`'s marked line merge
  into `%A` and exit 1.
- When `npm run prepare` runs, it shall copy the wrapper, the driver
  and the modules it imports into
  `$(git rev-parse --git-common-dir)/barwise-merge/`, and register
  `sh "$(git rev-parse --git-common-dir)/barwise-merge/driver.sh" %O %A %B %P`
  as `merge.beads.driver`, with `merge.beads.name` and
  `merge.beads.recursive = binary`. The path is resolved by git at merge
  time and quoted, so a clone that is moved, or whose path has a space,
  keeps working (checked with a probe in a linked worktree under a
  directory named `my dir`). Running it again shall replace all three.
- When the installed copy carries a higher `DRIVER_VERSION` than the
  one `prepare` would install, `prepare` shall keep the installed copy
  and say so. The copy is shared by every worktree of the clone, so
  without this a `prepare` run from an older branch would change how
  every later merge in the clone resolves. Equal versions are
  replaced, so a fix that forgets to bump the constant still installs.
- When the session-start hook runs `prepare`, it shall also read back
  `merge.beads.driver` and check that the installed wrapper exists,
  and warn if either is missing, the way it already warns about
  `core.hooksPath`.
- When git records a merge commit that changes the tracker, the
  `pre-merge-commit` hook shall run the same validation the pre-commit
  hook runs. Both hooks shall call one shared script, and that script
  shall validate the staged copy (`git show :.beads/issues.jsonl`,
  written to a temp file and passed to `check-beads.sh`), not the
  working-tree file. Today's pre-commit check reads the working tree,
  so a broken file that was staged and then fixed without restaging is
  committed broken. Git runs pre-commit, not pre-merge-commit, when a
  conflicted merge is concluded with `git commit` (both checked with
  probe hooks in a temp repository), so between them every merge commit
  is covered.
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
line merge, whose markers at least fail validation (checked with a
probe: a driver registered at a missing path left the current side's
file unmarked and the other side's line gone). A copy under the git
common directory exists for every branch and every linked worktree,
and `prepare` refreshes it. The wrapper's fallback covers a driver
copy that is broken or cannot run. It cannot cover its own absence:
if `driver.sh` itself is gone, `sh` exits 127 having written nothing,
which is the silent case again. That is why the session-start hook
checks the file exists, not only that the config is set.

## Inventory

| Path                                            | Current state                                                 | Verdict                                                                                                                                               |
| ----------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.gitattributes`                                | `merge=beads`, comment "Use bd merge"                         | keeps the attribute; the comment names the driver and where it is installed                                                                           |
| `barwise/package.json` `prepare`                | `cd .. && husky barwise/.husky`                               | also runs the installer                                                                                                                               |
| `barwise/scripts/lib/beads-jsonl.mjs`           | does not exist                                                | new: `canonicalLine` and `recomputeCounts`, moved out of `beads-crud.mjs`, which imports them                                                         |
| `barwise/scripts/beads-crud.mjs`                | owns `canonicalLine` and `recomputeCounts`                    | imports both from `lib/beads-jsonl.mjs`; output unchanged                                                                                             |
| `barwise/scripts/lib/beads-merge.mjs`           | does not exist                                                | new: the pure resolution (`resolveTracker`), no I/O                                                                                                   |
| `barwise/scripts/beads-merge-driver.mjs`        | does not exist                                                | new: the `%O %A %B %P` entry point; exits 0, 3 (conflict blocks written) or 2 (malformed input); carries `DRIVER_VERSION`                             |
| `barwise/scripts/beads-merge-driver.sh`         | does not exist                                                | new: the registered wrapper; passes 0 and 3 through, falls back to `git merge-file` on anything else                                                  |
| `barwise/scripts/install-merge-driver.mjs`      | does not exist                                                | new: copies the wrapper, the driver and its imports into the git common directory and sets the config; never downgrades; refuses outside a repository |
| `barwise/scripts/hooks/check-staged-tracker.sh` | does not exist; the logic is inline in pre-commit             | new: validates the index copy of the tracker, keeping the `GIT_DIR`/`GIT_WORK_TREE` pin (barwise-hud)                                                 |
| `barwise/.husky/pre-commit`                     | validates the working-tree tracker when it is staged          | calls the shared script                                                                                                                               |
| `barwise/.husky/pre-merge-commit`               | does not exist; pre-commit does not run for a clean merge     | new: calls the shared script                                                                                                                          |
| `.claude/hooks/session-start.sh`                | runs `npm run prepare`; reads back only `core.hooksPath`      | also reads back `merge.beads.driver` and checks the installed wrapper exists; warns if either is missing                                              |
| `barwise/scripts/tests/beads-merge.test.mjs`    | does not exist                                                | new: the rules against the lib, and real `git merge` runs in temp repositories                                                                        |
| `.claude/skills/steward/SKILL.md` section 1     | the rule in prose, applied by hand; collision tested by title | says the driver applies it; collision by `created_at`; the field rule; the hand procedure for reported cases                                          |
| root `CLAUDE.md`, Beads section                 | no mention of merging                                         | one sentence: the driver and where it is installed                                                                                                    |

`canonicalLine` and `recomputeCounts` move to a shared module rather
than being copied into the driver, because CLAUDE.md forbids a copy
that must agree with other code. The driver must write the same
canonical form and the same counts `beads-crud.mjs` writes, or the
next `beads-crud.mjs` write would rewrite every merged line.

## Target architecture

```
.gitattributes            .beads/issues.jsonl merge=beads
git config (per clone)    merge.beads.driver =
                            sh "$(git rev-parse --git-common-dir)/barwise-merge/driver.sh" %O %A %B %P
                          merge.beads.recursive = binary
                          written by scripts/install-merge-driver.mjs, run from `prepare`

driver.sh                 node beads-merge-driver.mjs "$@"
                          0 -> exit 0;  3 -> exit 1
                          anything else -> git merge-file (marked line merge) into %A, exit 1

beads-merge-driver.mjs    read %O %A %B -> lines (blank lines skipped; malformed -> exit 2)
                          resolveTracker(base, current, other)   (lib/beads-merge.mjs, pure)
                            -> { lines, reported: [{ id, reason }] }
                          counts via recomputeCounts, lines via canonicalLine
                            (lib/beads-jsonl.mjs, shared with beads-crud.mjs)
                          write lines, with a conflict block per reported id, to %A, once
                          reported.length ? list them on stderr, exit 3 : exit 0

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
- **Register a bare `node` command.** The third draft. Any failure to
  start or finish leaves `%A` as the current side, unmarked, which a
  `git add` commits as a silent loss. The wrapper turns every failure
  into markers.
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
- When both sides change one field of an issue to different values,
  and each side also changes a different field of it, both candidate
  lines in the conflict block shall carry both of those other edits.
- When the branch being merged into has no
  `barwise/scripts/beads-merge-driver.mjs`, the merge shall still use
  the installed copy and complete.
- When the installed driver throws, or an input line is malformed,
  the file shall hold `git merge-file`'s markers and the merge shall
  stop; no driver failure shall leave `%A` unmarked.
- When one side deletes an issue the other side added a `blocks`
  dependency on (so the deleted issue's `dependent_count` moved on the
  other side), the driver shall merge without a conflict and the merge
  commit shall be refused by the validation hook with
  `check-beads.sh`'s dangling-dependency error.
- When a broken tracker is staged and the working-tree file is then
  fixed without restaging, the commit shall be refused.
- When a criss-cross merge with two merge bases runs, the driver shall
  run once and resolve against the bases' common ancestor.
- Every `check-beads.sh` run in these tests shall be the repository's
  own script, run with the temp repository's tracker path as its
  argument, and shall assert the specific error text, not only a
  non-zero exit.
- When `npm run prepare` runs twice, `git config --get
  merge.beads.driver` shall print one value, and the wrapper it names
  shall exist. When the installed copy has a higher `DRIVER_VERSION`,
  `prepare` shall leave it in place.
- When the clone sits under a directory whose name contains a space,
  and when the merge runs in a linked worktree, the driver shall run.

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
