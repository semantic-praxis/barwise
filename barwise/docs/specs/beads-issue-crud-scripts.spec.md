# Direct-JSONL CRUD for .beads/issues.jsonl (no bd binary required)

Status: Implemented (with this spec)
Created: 2026-08-26
Last-updated: 2026-08-26
Tracking: barwise-860, barwise-861 (filed because the authoring session's
container had no `bd`)

## Principle

Explicit over implicit, applied to a derived field rather than a
declared one. `.beads/issues.jsonl` already has one piece of code that
is the single source of truth for what "correctly formed" means:
`scripts/check-beads.sh`, which reproduces bd's own Go export format
byte-for-byte so any environment can verify the file even without the
`bd` binary installed. Verification-only was enough until sessions
without `bd` started needing to _write_ to the file by hand.

barwise-860 and barwise-861 are the evidence this is already going
wrong: both were filed by a session with no `bd`, both hand-added a
`dependencies` entry, and both left `dependency_count` /
`dependent_count` at `0` -- silently wrong, and invisible to
`check-beads.sh`, which validates structure but not derivation. A
derived field computed correctly in one place and copy-pasted wrong by
every session that lacks the real tool is exactly the failure mode
"explicit over implicit" and "define errors out of existence" argue
against: the fix is one piece of code that computes the derivation,
not a convention every session is expected to reproduce by hand.

## Scope

In scope:

- When a session without the `bd` binary needs to create an issue, the
  system shall append a canonically-formatted line to
  `.beads/issues.jsonl` with an auto-allocated id, required fields
  populated, and `dependency_count` / `dependent_count` /
  `comment_count` computed rather than hand-typed.
- When a session needs to read one or more issues, the system shall
  print them (single issue as full JSON via `show`, filtered sets as a
  compact table via `list`) without requiring `bd`.
- When a session updates an issue's fields (title, description,
  status, priority, issue_type, owner, acceptance_criteria, notes,
  labels, assignee, design), the system shall rewrite that issue's
  line in place, bump `updated_at`, and recompute any derived counts
  the change affects.
- When a session closes an issue, the system shall set
  `status: closed`, stamp `closed_at`, and record `close_reason`.
- When a session adds a `blocks`/`parent-child`/`discovered-from`/etc.
  dependency edge between two issues, the system shall append the
  dependency record to the source issue and recompute
  `dependency_count` on the source and `dependent_count` on the
  target.
- When a session creates a child issue under `--parent <id>`, the
  system shall allocate the next `<parent>.<n>` id and add the
  `parent-child` dependency edge automatically.
- When a session deletes an issue that other issues still `blocks`-depend
  on, the system shall refuse unless `--force` is given.
- Every write shall produce a line byte-identical to what
  `check-beads.sh --strict`'s canonical-form check accepts (compact
  separators, `&`/`<`/`>` escaped as `\uXXXX`, one JSON object per
  line, trailing newline).

Out of scope, deferred:

- Comments / `interactions.jsonl`. That file is empty in this repo
  today (0 bytes) and no in-scope workflow needs it; a comment-CRUD
  workstream can follow the same pattern later if that changes.
- `bd sync` / Dolt database sync. This tool only ever touches
  `.beads/issues.jsonl`; getting that file committed and pushed stays
  the operator's job exactly as it is today (`git add`, `git commit`).
- Full `bd` parity: no `bd ready` (computed ready-work ordering), no
  cycle detection beyond what `check-beads.sh` already flags, no
  search. This is a write path for the common CRUD cases, not a bd
  reimplementation.
- Concurrent-session id allocation is best-effort (read current max,
  add one) with no locking. Two sessions creating an issue at the same
  moment in different worktrees can collide; a collision surfaces as
  `check-beads.sh`'s existing duplicate-id error at merge time, same
  as any other file conflict in this git-native tracker.

## Inventory

| Module                   | Current state                                      | Verdict                                        |
| ------------------------ | -------------------------------------------------- | ---------------------------------------------- |
| `scripts/check-beads.sh` | Read-only validator; canonical-form oracle         | Unchanged -- used as the compatibility check   |
| `scripts/beads-crud.mjs` | Does not exist                                     | New: create/show/list/update/close/delete      |
| `package.json`           | No entry point for issue writes                    | Add one `bd` script forwarding to the new tool |
| `.beads/issues.jsonl`    | Hand-edited by bd-less sessions, sometimes wrongly | Unchanged format; now has a correct writer     |

## Derived-field rule (verified against the live file)

`dependency_count` and `dependent_count` are not "length of the
`dependencies` array" -- every `parent-child` and `discovered-from`
edge in the live file leaves both counts untouched. Checked against
every non-zero example in the current 193-issue file (36 issues with a
`blocks` edge, all matching, zero exceptions):

- `dependency_count(X)` = number of entries in `X.dependencies` with
  `type: "blocks"`.
- `dependent_count(X)` = number of `type: "blocks"` entries, across
  every issue in the file, whose `depends_on_id` is `X`.

This is inferred from data, not documented by bd, so it is called out
explicitly rather than asserted as obvious (see Open decisions).

## Alternatives considered

- **Extend `check-beads.sh` (bash + inline python) with write
  subcommands.** Rejected: id allocation, in-place line rewriting, and
  derived-count recomputation are JSON-shaped logic that bash makes
  awkward; every other multi-step tool in `scripts/` (`audit-gate.mjs`,
  `arch-triage.mjs`, `check-file-size.mjs`) is already Node, so a
  second Node script fits the existing convention better than growing
  the bash+python file into two responsibilities.
- **Shell out to the real `bd` binary.** Rejected on the stated
  premise: this is needed precisely because some session containers do
  not have `bd` installed, which is the situation barwise-860 and
  barwise-861 were filed under.

## Workstreams (each independently shippable)

### 1. `beads-crud.mjs`: create / show / list / update / close / delete

Single workstream -- one small, self-contained tool with no consumers
to coordinate with. Implements canonical-line writing (mirroring
`check-beads.sh`'s `go_compact`), id allocation (top-level and
`--parent`-relative), the derived-count rule above, and the six
subcommands. Ships with `check-beads.sh --strict` as the acceptance
check: every subcommand's output must pass it on the real file.

## Open decisions (for review)

- **Blocks-only derived counts.** Recommended default: yes, per the
  Derived-field rule section -- it matches 100% of the live file's
  non-zero examples. If bd's real behavior later turns out to also
  count `conditional-blocks` / `waits-for` (both present in bd's type
  vocabulary per `check-beads.sh`'s `DEADLOCK` set, but absent from
  this file's history so far), this rule should be revisited against
  a file that actually contains one.
- **Hard delete vs. close-only.** Recommended default: support both,
  with `close` as the soft path bd itself exposes conceptually and
  `delete` as a hard removal gated on `dependent_count == 0` unless
  `--force`. An alternative is to drop `delete` entirely and route
  everything through `close`, matching bd's own CLI surface (which has
  no delete command); recommendation is to keep `delete` since a
  hand-filed issue created by mistake is a real case this tool will
  hit immediately, but this is the reviewer's call.

## Risks and testing

- Every mutation is checked against `scripts/check-beads.sh --strict`
  before this spec is considered validated -- run it on a scratch copy
  of the real `.beads/issues.jsonl`, not the live file, then re-run it
  on the live file after any real write the implementation session
  makes.
- Round-trip risk: reading a line, mutating the parsed object, and
  re-serializing must not perturb untouched fields or their values --
  verified by diffing every other line in the file before/after a
  single-issue update.
- No test package covers `scripts/`; consistent with
  `check-beads.sh`/`audit-gate.mjs`/`arch-triage.mjs`, which also ship
  without a `.test.ts` file. Correctness here is proven by running the
  tool against real data and validating with `check-beads.sh`, not by
  a unit suite.

## Implementation notes

- Verified against the live 193-issue `.beads/issues.jsonl` in a
  scratch git repo: `create` (plain, `--depends-on ...:blocks`,
  `--parent`), `update` (field edits, `--depends-on`), `close`, and
  `delete` (blocked-without-`--force`, then `--force`) all produced
  lines that passed `check-beads.sh --strict` with zero errors, and
  every untouched line stayed byte-identical before/after.
- One cleanup beyond the original design: `delete` now removes an
  issue's `dependencies` key entirely when stripping the deleted id's
  edges leaves it empty, rather than leaving a stray `"dependencies":
  []`, to match how `create`/`update` never emit that key when there
  are no edges.

## Non-goals

- No `bd sync` / Dolt integration.
- No comment/interaction CRUD (interactions.jsonl is unused today).
- No `bd ready` / dependency-cycle / search reimplementation.
