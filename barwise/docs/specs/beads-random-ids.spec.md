# beads-crud mints random issue ids

Status: Implemented 2026-09-26 -- the single workstream

Created: 2026-09-26
Last-updated: 2026-09-26
Tracking: barwise-w1u

`node scripts/beads-crud.mjs create` names a new issue with the highest
number in the local `.beads/issues.jsonl`, plus one. A branch behind
main reads a stale file by construction, so two branches open at once
mint the same id for different issues. That has happened at least five
times (barwise-w1u's notes, barwise-984). The last was PR #564's
barwise-1071 against main's barwise-1071 on 2026-09-26. Detection
already exists: `check:beads` rejects a duplicate id, and it rejects an
id that main and a branch each created at a different time (the
`created_at` rule, barwise-984). What is left is the cause. After this
change, `create` mints a random three-character suffix, the form the
owner approved for the trial's issues, so collisions become improbable
instead of routine.

## Principle

**Define errors out of existence.** A counter read from a file that is
stale on every branch will collide; checking harder at merge time only
finds the damage sooner. A random name removes the shared counter.

## Requirements

- **R1.** A new top-level issue shall get
  `<prefix>-<s>`, where `<s>` is three characters from `[0-9a-z]`,
  drawn from `node:crypto`, that are not all digits and not an id already
  in the file. All-digit suffixes stay reserved, so a random id can never
  equal an existing or future sequential one.
- **R2.** A child (`--parent P`) shall get `P.<s>` under the same rule.
  Two branches adding a child to one parent collide the same way today.
- **R3.** `create` shall retry on a taken suffix, and refuse (exit 1,
  say why) after 100 tries rather than loop, which could only happen
  near a full namespace.
- **R4.** Existing ids are unchanged. Numeric ids keep working with
  every subcommand, and nothing is renumbered.

## Scope

In: `beads-crud.mjs` allocation, its tests, and the spec that owns it
(`beads-issue-crud-scripts.spec.md`, whose "best-effort (read current
max, add one)" non-goal this replaces). Out: the `bd` binary, which is
not installed in these sessions, and the existing detection.

## Workstream (single)

The allocator is `scripts/lib/beads-ids.mjs`, a pure function with the
random draw injectable so the retry limit is testable; `beads-crud.mjs`
calls it for both top-level and child ids.

## Risks and testing

- **Residual collisions.** 46,656 three-character suffixes, minus the
  1,000 all-digit ones and the ~140 in use. Two branches each minting
  ten ids collide with probability about 100/45,500, roughly 0.2
  percent, and the existing `check:beads` rules still catch that case.
  A fourth character would cut it to about 0.006 percent at the cost of
  the house style. Three is the recommendation because detection
  already covers the remainder.
- **Ordering.** A random id does not sort by creation. `list` already
  shows ids with their status and title, and `created_at` carries the
  order.
- Tests: fifty creates in a throwaway tracker are all distinct, all
  match the pattern, and none is all digits; a child gets `P.<s>`; the
  retry limit refuses. The existing beads tests pass unchanged.

## Open decisions

None. Suffix length is three, matching the existing random ids; it is
one constant (`SUFFIX_LENGTH`) if the residual rate ever argues for
four.
