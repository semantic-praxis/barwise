# A merge driver for the tracker, registered where the repository is set up

Status: Draft -- no workstream implemented

Created: 2026-10-23
Last-updated: 2026-10-23
Tracking: barwise-nto

## Principle

`.gitattributes` routes `.beads/issues.jsonl` to a merge driver named
`beads` that nothing registers, so the declaration is a promise with no
mechanism behind it. Git does not report an unknown driver. It falls
back to a line merge without a word, and any two branches that each
added an issue conflict on the file. PR #704 hit that conflict six
times in three days. Each time it was resolved by hand, with a script
written in the session, applying a rule the steward skill states in
prose (section 1): union by id, the later `updated_at` wins, and two
issues that share an id are a collision, not an edit. That rule is deterministic and already
decided, which makes it something to solve once, centrally, rather
than re-derive at every merge (CLAUDE.md, "define errors out of
existence"). The `.gitattributes` line is also the explicit
declaration the repository already chose; the defect is only that the
name points at nothing.

**Resolution in one sentence:** ship the steward rule as a three-way
merge driver, register it in the `prepare` step that every documented
setup path already runs, and keep the `.gitattributes` line pointing at
it.

## Should the driver be three-way, or the union PR #704 used? (resolved: three-way)

A plain union of both sides by id resurrects a deleted issue: when one
side deletes a row and the other side never touched it, the union
puts the row back. Issues are deleted. PR #704 removed `barwise-y2m` as
a duplicate, and `beads-crud.mjs` has a `delete` subcommand that is
used for exactly this. A union driver would reverse every such
deletion silently. The base version (`%O`) is what tells "the other
side deleted this" from "this side added it", so the driver reads all
three versions and decides per id. In the table, B, O and T are an id's
line in the base (`%O`), ours (`%A`, the branch being merged into) and
theirs (`%B`, the branch being merged in). "Unchanged" means
byte-identical to B; the tracker writes canonical lines, so a byte
comparison is exact. The first matching row wins:

| Row | Base   | Ours           | Theirs         | Result                                                          |
| --- | ------ | -------------- | -------------- | --------------------------------------------------------------- |
| 1   | any    | identical to T | identical to O | that line, or no line if both deleted it                        |
| 2   | any    | present        | present        | **conflict** if O and T differ in `created_at`: an id collision |
| 3   | B      | unchanged      | T or absent    | T, or no line (theirs deleted it)                               |
| 4   | B      | O or absent    | unchanged      | O, or no line (ours deleted it)                                 |
| 5   | B      | absent         | T (edited)     | **conflict**: deleted on one side, edited on the other          |
| 6   | B      | O (edited)     | absent         | **conflict**: the same, mirrored                                |
| 7   | any    | O              | T              | both edited, or both added: the later `updated_at` wins         |
| 8   | absent | O              | absent         | O (only ours added it)                                          |
| 9   | absent | absent         | T              | T (only theirs added it)                                        |

Row 2 checks `created_at`, not the title, because that is the test
`check-beads.sh` already applies to a reused id (barwise-984), and
titles are edited legitimately. If row 7's timestamps are equal, the
driver reports a conflict rather than picking a side (decision 3).

The table is per id, so one case it cannot see is a dependency: one
side deletes an issue that the other side added a dependency on. Each
input is valid alone, and the merged file has a dangling
`depends_on_id`. The driver does not re-implement that check, because a
second copy of `check-beads.sh`'s rule would have to be kept in step
with it. The `pre-merge-commit` hook (Scope) runs `check-beads.sh`
itself on the merge commit, rejects the dangling id, and leaves the
merge in progress for a person to resolve.

## Scope

In scope:

- When git merges `.beads/issues.jsonl` and both sides changed it, the
  driver shall resolve every id according to the table above.
- When the driver writes a result, it shall copy each kept line
  byte for byte from the version it came from, keep the order of the
  current side (`%A`), and append ids that exist only on the other side
  in that side's order. Every kept line is therefore canonical, and no
  id appears twice. A dangling dependency is left to the
  `pre-merge-commit` hook, as above. The derived count fields `beads-crud.mjs` maintains on
  write are not recomputed (Non-goals); `check-beads.sh` does not
  validate them.
- When an id falls into a conflict row, the driver shall still write
  its best result, keeping the current side's line for that id. It
  shall name every conflicting id on stderr, with the reason and the
  steward procedure, and exit non-zero, so git marks the file
  conflicted and refuses to commit it unresolved.
- When any input line is not valid JSON or has no `id`, the driver
  shall leave the current side's file unchanged, say which version and
  which line, and exit non-zero.
- When `npm run prepare` runs (README's setup step, and the
  session-start hook, which calls it), it shall register the driver in
  the clone's git config as `merge.beads.driver` and set
  `merge.beads.name`.
- When `.gitattributes` names a merge driver for the tracker, a test
  shall fail unless `prepare` registers a driver of that name.
- When git is about to record a merge commit that changes
  `.beads/issues.jsonl`, the `pre-merge-commit` hook shall run
  `check:beads --strict` and abort the commit if it fails. That is the
  same validation pre-commit already applies to an ordinary commit.

Out of scope:

- Resolving the conflict GitHub shows on a pull request. GitHub runs no
  custom merge driver, so a PR stays marked conflicted until someone
  merges the base into it locally. With this spec that merge needs no
  hand resolution; noticing it is still needed is decision 1, a comment
  workflow tracked as barwise-ojo.
- One file per issue, which would remove the conflict class altogether
  (decision 2: deferred).
- Any change to `beads-crud.mjs`'s write path or to `check-beads.sh`.

## Inventory

| Path                                         | Current state                                                 | Verdict                                                                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.gitattributes`                             | `merge=beads`, comment "Use bd merge"                         | keeps the attribute; the comment names the script and its registration                                                                                 |
| `barwise/package.json` `prepare`             | `cd .. && husky barwise/.husky`                               | also runs the registration                                                                                                                             |
| `barwise/scripts/lib/beads-merge.mjs`        | does not exist                                                | new: the pure three-way resolution over three line arrays, no I/O                                                                                      |
| `barwise/scripts/beads-merge-driver.mjs`     | does not exist                                                | new: the `%O %A %B %P` entry point; reads, calls the lib, writes `%A`, sets the exit code                                                              |
| `barwise/scripts/install-merge-driver.mjs`   | does not exist                                                | new: `git config merge.beads.{name,driver}`, idempotent; refuses outside a git work tree                                                               |
| `barwise/scripts/tests/beads-merge.test.mjs` | does not exist                                                | new: every table row against the lib, plus one real `git merge` in a temp repo through `.gitattributes` and the driver                                 |
| `.claude/skills/steward/SKILL.md` section 1  | the rule in prose, applied by hand; collision tested by title | says the driver applies it; tests a collision by `created_at`, as `check-beads.sh` does; keeps the hand procedure for the conflicts the driver reports |
| root `CLAUDE.md`, Beads section              | no mention of merging                                         | one sentence: the driver and where it is registered                                                                                                    |
| `barwise/.husky/pre-merge-commit`            | does not exist; pre-commit does not run for a merge commit    | new: the pre-commit hook's tracker validation, for merge commits                                                                                       |
| `.claude/hooks/session-start.sh`             | already runs `npm run prepare`                                | untouched; it gains the registration through `prepare`                                                                                                 |
| `barwise/scripts/beads-crud.mjs`             | owns `canonicalLine`                                          | untouched; the driver copies lines and never serializes, so it needs no copy of the canonical form                                                     |

The driver needs no canonical serializer, and that is a deliberate
choice. Copying input lines verbatim means there is no second copy of
the canonical form to keep in step with `beads-crud.mjs` and
`check-beads.sh`.

## Target architecture

```
.gitattributes            .beads/issues.jsonl merge=beads
git config (per clone)    merge.beads.driver =
                            node barwise/scripts/beads-merge-driver.mjs %O %A %B %P
                          set by scripts/install-merge-driver.mjs, run from `prepare`

beads-merge-driver.mjs    read %O %A %B -> lines
                          resolveTracker(base, ours, theirs)   (lib/beads-merge.mjs, pure)
                            -> { lines, conflicts: [{ id, reason }] }
                          write lines to %A
                          conflicts.length ? print them, exit 1 : exit 0
```

Git runs a merge driver from the top of the work tree, so the
repo-relative path works in every clone and linked worktree. Git
passes `%O`, `%A` and `%B` as temporary files, and the result must be
written to `%A`.

## Alternatives considered

- **Union by id with no base.** What PR #704 ran by hand. It loses to
  three-way because it reverses deletions with no signal (see the
  resolved question).
- **Git's built-in `merge=union`.** It keeps both sides' lines. A row
  edited on both sides then appears twice with one id, which
  `check:beads` rejects. So this swaps a conflict git reports for a
  duplicate-id failure that surfaces only at the next validation.
- **Register in the pre-commit or pre-push hook.** Too late. The driver
  runs during `git merge`, before any commit or push hook fires.
- **Install `bd` and keep `bd merge`.** CLAUDE.md made `beads-crud.mjs`
  the interface precisely so that no container needs `bd`. Requiring it
  for merges would reverse that decision for one operation.

## Workstreams (each independently shippable)

### 1. The driver, its registration, and the docs that describe it

Everything in the Inventory, in one PR. The pieces are useless apart:
an unregistered driver is the current defect, and registering a driver
that does not exist breaks every merge of the file. Acceptance:

- When the test suite runs, every row of the table shall have a case.
  Each case shall have been seen failing first, through `mutate.mjs`
  on the lib.
- When a temp repo with this `.gitattributes`, the registration and two
  branches that each added an issue runs `git merge`, the merge shall
  complete with no conflict, and the file shall hold both issues and
  pass `check:beads --strict`.
- When the same repo merges a delete on one side against an edit on
  the other, `git merge` shall stop with the file conflicted, and
  stderr shall name the id.
- When `npm run prepare` runs twice, `git config --get
  merge.beads.driver` shall print the same single value.
- When a clean merge would commit a tracker that fails
  `check:beads --strict`, the commit shall not be created. A test makes
  one side delete an issue the other side added a dependency on and checks that `git merge` exits
  non-zero, so the hook has been seen failing.

## API and migration impact

- No package changes. Only scripts, the `prepare` script, and two
  documents change.
- Existing clones pick up the driver the next time `npm run prepare`
  runs. Session containers run it on every start. A clone that never
  runs it behaves exactly as today, which is no worse than the current
  state.
- A clone with `bd` installed may have its own `merge.beads.driver`.
  `prepare` overwrites it with this one. That is intended: the repo's
  rule is the steward rule, and CLAUDE.md says `bd` is not part of the
  interface.

## Decisions (owner, 2026-10-23)

All three were answered on PR #718; each records the options it chose
among, so a later reader can see what was set aside.

1. **Who merges the base into a pull request that conflicts only on
   the tracker? Decided: (c), a comment, as its own spec (barwise-ojo).** No event wakes an agent when a change to main makes a
   PR conflict, and GitHub does not run the driver. Options:
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
   rewrites of `beads-crud.mjs` and `check-beads.sh`, and a 598-file
   directory. Deferred because, with the driver in place, the
   remaining conflicts are real disagreements, which a per-file layout
   would surface in the same way.
3. **Equal `updated_at` with different lines? Decided: report a
   conflict.** The other option was to prefer one side.
   The timestamps have one-second resolution, so a tie means two edits
   in the same second on two branches, which is rare and better shown
   to a person than guessed.

## Risks and testing

- **A driver bug corrupts the tracker on every merge.** Guarded by the
  per-row tests, the end-to-end `git merge` test, and the new
  `pre-merge-commit` hook. Git does not run the pre-commit hook for the
  commit a clean merge makes (checked with a probe hook in a temp repo:
  it never ran), so until now a merge that wrote the tracker reached
  history without `check:beads --strict` seeing it. That check
  surfaced only in CI. `pre-merge-commit` is the hook git runs at that
  point.
- **The driver silently picks the wrong side.** Every non-trivial
  choice (later `updated_at`, deletion on one side) is a table row with
  a test. Every case the rule cannot decide exits non-zero. Nothing is
  resolved without either a rule or a person.
- **A clone never runs `prepare`.** It keeps today's behaviour. Nothing
  regresses, but nothing improves for that clone.

## Non-goals

- No change to how issues are written, validated, or numbered.
- No recomputation of the derived count fields `beads-crud.mjs` keeps
  (`dependency_count`, `dependent_count`, set by `recomputeCounts`). A
  merged file can carry a stale count until the
  next `beads-crud.mjs` write; the validator does not check them.
- No server-side resolution of a pull request's conflict state.
