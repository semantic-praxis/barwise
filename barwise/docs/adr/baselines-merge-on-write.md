# Baseline writers merge verdicts

Scope: process
Date: 2026-10-23
Tracking: barwise-ubc, barwise-1026, barwise-qs8, barwise-eu6, barwise-5ij,
barwise-tko, barwise-rh3, barwise-80d,
docs/specs/baseline-write-preserves-verdicts.spec.md
Enforced-by: tests (merge-not-regenerate, specs-write-on-ask, findings-order,
duplication-no-writer), none (barwise-ym8.fi5: merge-not-regenerate),
none (barwise-ym8.3yv: one-merge-owner), none (barwise-ym8.nhy: findings-order),
none (barwise-ym8.79m: duplication-no-writer)

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

1. **A writer merges, and never regenerates over recorded verdicts.**{#merge-not-regenerate}
   For each id the detector still produces, it keeps the row's
   human-owned fields and refreshes its derived fields. Only a new id
   gets the placeholder. A row no longer detected is reported and not
   written. There is one exception. When an `audit:specs` row gains
   commits its verdict never covered, `--write` reopens the note as
   `TODO: re-read -- <commits> ... Previous note: <old note>`, and
   `--check` fails until someone re-reads it. A row reopened again
   merges the commit lists and keeps the original note, not the
   intermediate `TODO`.
2. **The merge has one owner.**{#one-merge-owner} Every writer calls
   `scripts/lib/baseline-merge.mjs` to read the existing rows, merge
   them and print the summary. Each writer declares its own
   human-owned fields and placeholders in `preserve`.
3. **`audit:specs` writes only when asked.**{#specs-write-on-ask} A bare invocation reports
   and writes nothing; `--write` writes.
4. **Row order depends only on the findings.**{#findings-order} Rows are sorted by id,
   so rewriting an unchanged baseline changes nothing. The writer says
   how many verdicts it kept, how many rows are new, and which rows
   are no longer detected.
5. **`audit-duplication` has no writer.**{#duplication-no-writer} Its baseline is edited by
   hand.

## Consequences

- `test:scripts` is a CI step guarded by
  `if: steps.changes.outputs.docs_only != 'true'`, so it is skipped on
  a docs-only pull request, and like any step it is skipped once an
  earlier step fails. `ci:local` applies the same condition and keeps
  going after a failure. It tests:
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
- The summary misreports a reopen: `audit-spec-status` counts a
  reopened verdict as kept, on that write and on later ones, while
  `--check` fails on it (barwise-80d). The writers also report rows
  still unclassified, which the spec's third Open decision left to the
  reviewer and never resolved; the code added it.
- Decision 4's report of rows no longer detected is tested only for
  `audit-corrections`. For `audit-rubric` and `audit-spec-status`
  nothing checks it (barwise-5ij).
- Decision 2 has no gate beyond decision 5's test.
  `trial/lib/gate.mjs --write` is a fourth writer, and it does not use
  the helper, which breaks decision 2. Existing verdicts survive and
  its rows are sorted, but it never refreshes derived fields and keeps
  rows no longer detected (decision 1), and prints no summary
  (decision 4) (barwise-tko).
- Apart from the reopen, a writer refreshes derived fields under a
  kept verdict and reports nothing about it. The spec left this as an
  unresolved Open decision ("Recommend silent refresh for now and a
  count in the summary line"). The code has the silent refresh but no
  count. This is open, not decided here (barwise-rh3).
- `scripts/tests/expected-counts.json` also has a `--write` writer
  that does not use the helper. It holds only derived counts and no
  verdict. No source says whether this rule covers it (barwise-tko).
- Until they are replaced with links (barwise-5h3; the root `CLAUDE.md` states
  the rule in one line with a link since architecture-index WS5), these places
  also state this rule:
  - `baseline-write-preserves-verdicts.spec.md`, without the reopen
    exception;
  - the `baseline-merge.mjs` header, its `mergeBaselineRows` docblock
    and sort comment, and the `baseline-merge.test.mjs` header;
  - the comments in the three writers where they call the helper,
    plus `audit-spec-status`'s survey and reopen comments;
  - the comments on the `gates.test.mjs` writer tests.
