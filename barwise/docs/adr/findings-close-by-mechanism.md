# Findings close by mechanism

Scope: process
Date: 2026-08-29
Tracking: barwise-ubc, barwise-903, barwise-910, barwise-2af, barwise-uuy,
barwise-uuh, barwise-u5d,
docs/specs/duplication-drift-guards.spec.md,
docs/specs/correction-record-ratchet.spec.md

## Context

A hand sweep runs once, and the next edit brings back what it found.
The 2026-08-29 rubric audit found three defects and was nearly left as
a throwaway script with a note. The rule was written that day, along
with the ratchet that replaced the note (barwise-903). Later the same
thing happened to spec Status headers (barwise-910) and to the
spec-correction taxonomy (`correction-record-ratchet.spec.md`).
Workstream 5 of the drift-guards spec explains why a baseline with a
verdict on every row is safe to gate on, when raw detection is not.

## Decision

1. **A finding is closed by a mechanism, not by a document.** The rule
   for must-agree copies applies to anything an audit turns up. In the
   same commit, land a check that fails if the finding comes back, or a
   baseline row that has to be removed when the finding is fixed. A
   findings document can record the reasoning, but it does not close
   the finding.
2. **A ratchet fails both ways.** A detector reports candidates, and a
   committed baseline holds a verdict for each. `--check` fails on a
   new candidate with no row and on a row no longer detected, so the
   baseline always lists exactly what is open.
3. **A script detects, and a person classifies.** The detector assigns
   no verdict. A person records each verdict once, in the baseline:
   `tracked:<issue>` for an open finding, or a classification with its
   reason.
4. **An audit's ratchet is wired into CI.**

## Consequences

- Four ratchets are CI steps. CI runs on pushes to main and on pull
  requests into main.
  - `audit:duplication`, `audit:specs` and `audit:corrections` have no
    `if:` guard. They run in every CI run that reaches them; a step
    with no guard is still skipped once an earlier step fails.
  - `audit:rubric` is guarded by
    `if: steps.changes.outputs.docs_only != 'true'`, because "it scores
    through the built promptlab" (ci.yml).
  - The pre-push hook runs whichever of the four CI would select for
    the change, through `ci:local`, which keeps going after a
    failure. `git push --no-verify` skips the hook.
- Decision 2: each of the four implements both directions. A test
  covers the stale-row direction only for `audit:corrections` (barwise-2af).
- Decision 4 has no gate.
  - `trial:gate` ratchets `trial-baseline.json`, but only the trial's
    unit tests run in CI. The enterprise-trial spec plans the small
    tier for CI in its WS6, and defers that wiring "not in this PR"
    (barwise-uuy).
  - The gate prints PASS over results older than inputs the runner
    refused to grade (barwise-e0q).
  - Some planned sweeps would run on a schedule rather than per pull
    request: the medium trial tier, and the full duplication sweep the
    drift-guards spec recommends in an unresolved Open decision.
    Whether a scheduled run satisfies decision 4 is open, not decided
    here.
- Decision 1 has no gate. The only review step that asks whether a
  finding became a mechanism is `session-review` (each entry names its
  mechanism, or says it has none). The `duplication-audit` skill still
  calls its deliverable "a dated findings doc" (barwise-uuh).
- Decision 3 has no gate on who classifies.
  - `audit:corrections` checks a verdict's form: `caught_by` must come
    from a fixed list.
  - `audit:specs` checks form too: it rejects an empty or `TODO` note.
  - `trial:gate` requires a note, an issue and a reproduction
    directory.
  - `audit:rubric` and `audit:duplication` never read the verdict at
    `--check`. A `test:scripts` case rejects a placeholder in
    `rubric-baseline.json`.
  - No ratchet checks that a named issue exists in the tracker, or that
    it is open (barwise-u5d).
- Open findings that no mechanism holds yet, each tracked:
  - the mutation score (barwise-994);
  - the assertion-audit fixture pass (barwise-1073);
  - specs marked Implemented whose Open decisions read undecided
    (barwise-1007);
  - closure placement and deferred closure (barwise-1032,
    barwise-1044).
- `audit:specs` can answer differently on a branch head than on its
  merge ref (barwise-dm0), and it misses a Status of "Not implemented"
  (barwise-1048).
- Until architecture-index WS5 replaces them with links, these places
  also state this rule (barwise-ubc, WS5):
  - the root `CLAUDE.md` conventions;
  - the `assertion-audit` and `session-review` skills;
  - the headers of the five ratchets, and of `baseline-merge.mjs`;
  - the ci.yml comments on the four ratchet steps.
