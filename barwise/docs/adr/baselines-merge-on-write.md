# Baseline writers merge verdicts

Scope: process
Date: 2026-10-23
Tracking: barwise-ubc, barwise-1026, barwise-qs8, barwise-eu6, barwise-5ij,
barwise-tko, barwise-rh3,
docs/specs/baseline-write-preserves-verdicts.spec.md

## Context

A ratchet baseline's verdict fields record that each finding was
judged. The three baseline writers used to rebuild their rows from the
detector alone. So the documented way to add one row also replaced
every verdict in the file: in the spec's measurement, 90 of 90 across
the three baselines (74, 10 and 6 rows). The loss surfaced only
because a later `--check` happened to fail (barwise-1026), and
`audit:specs` wrote even on a bare invocation. The measurements, why
the merge rule follows from the row id, and the four alternatives the
spec rejected are in the spec above. The one exception, a reopened
note, was decided when barwise-qs8 closed.

## Decision

1. **A writer merges, and never regenerates over recorded verdicts.**
   For each id the detector still produces, it keeps the row's
   human-owned fields and refreshes its derived fields. Only a new id
   gets the placeholder. A row no longer detected is reported and not
   written. There is one exception. When an `audit:specs` row gains
   commits its verdict never covered, `--write` reopens the note as
   `TODO: re-read -- <commits> ... Previous note: <old note>`. The old
   text is kept whole, and `--check` fails until someone re-reads it.
2. **The merge has one owner.** Every writer calls
   `scripts/lib/baseline-merge.mjs` to read the existing rows, merge
   them and print the summary. Each writer declares its own
   human-owned fields and placeholders in `preserve`.
3. **`audit:specs` writes only when asked.** A bare invocation reports
   and writes nothing; `--write` writes.
4. **Row order depends only on the findings.** Rows are sorted by id,
   so rewriting an unchanged baseline changes nothing. The writer says
   how many verdicts it kept, how many rows are new or still
   unclassified, and which rows are no longer detected.
5. **`audit-duplication` has no writer.** Its baseline is edited by
   hand.

## Consequences

- `test:scripts` is a CI step guarded by
  `if: steps.changes.outputs.docs_only != 'true'`. CI runs on pushes
  to main and on pull requests into main. The step runs in every such
  run that reaches it, and like any step it is skipped once an earlier
  step fails. `ci:local` also runs it, and keeps going after a
  failure. It tests:
  - the helper on its own;
  - each writer run over its committed baseline: verdicts are
    unchanged, apart from the reopen, and a second run changes
    nothing;
  - the reopen, and that `--check` then fails;
  - that a bare `audit-spec-status` writes nothing;
  - that `audit-duplication.mjs` contains no `writeFileSync`.
- CI runs `test:scripts` before `npm run build`. The `audit-rubric`
  writer test needs `packages/promptlab/dist`, so it skips in CI and
  in the pre-push `ci:local --commit`, which uses a fresh worktree. It
  runs only where a build already exists (barwise-eu6).
- Decision 4's report of rows no longer detected is tested only for
  `audit-corrections`. For `audit-rubric` and `audit-spec-status`
  nothing checks it (barwise-5ij).
- Decision 2 has no gate beyond decision 5's test.
  `trial/lib/gate.mjs --write` is a fourth writer, and it does not use
  the helper. Existing verdicts survive, but it breaks decisions 1 and
  4: it never refreshes derived fields, it keeps rows no longer
  detected, and it prints no kept/new/unclassified summary (barwise-tko).
- Apart from the reopen, a writer refreshes derived fields under a
  kept verdict and reports nothing about it. The spec left this as an
  unresolved Open decision ("Recommend silent refresh for now and a
  count in the summary line"). The code has the silent refresh but no
  count. This is open, not decided here (barwise-rh3).
- `scripts/tests/expected-counts.json` also has a `--write` writer. It
  holds only derived counts and no verdict, so this rule does not
  cover it.
- Until architecture-index WS5 replaces them with links, these places
  also state this rule (barwise-ubc, WS5):
  - the root `CLAUDE.md` conventions;
  - `baseline-write-preserves-verdicts.spec.md`;
  - the `baseline-merge.mjs` header;
  - the comments in the three writers where they call the helper,
    plus `audit-spec-status`'s survey and reopen comments;
  - the comments on the `gates.test.mjs` writer tests.
