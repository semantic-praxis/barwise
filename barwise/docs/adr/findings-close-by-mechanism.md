# Findings close by mechanism

Scope: process
Date: 2026-08-29
Tracking: barwise-ubc, barwise-903, barwise-910, barwise-2af, barwise-uuy,
barwise-uuh, barwise-u5d, barwise-iil,
docs/specs/duplication-drift-guards.spec.md,
docs/specs/correction-record-ratchet.spec.md
Enforced-by: npm run audit:specs -- --check (person-classifies),
tests (ratchet-both-ways), none (barwise-ym8.1b2: mechanism-closes),
none (barwise-ym8.k4d: ratchet-both-ways), none (barwise-ym8.h0l: person-classifies),
none (barwise-ym8.ld2: ratchet-in-ci)

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

1. **A finding is closed by a mechanism, not by a document.**{#mechanism-closes} The rule
   for must-agree copies applies to anything an audit turns up. In the
   same commit, land a check that fails if the finding comes back, or a
   baseline row that has to be removed when the finding is fixed. A
   findings document can record the reasoning, but it does not close
   the finding.
2. **A ratchet fails both ways.**{#ratchet-both-ways} A detector reports candidates, and a
   committed baseline holds a verdict for each. `--check` fails on a
   new candidate with no row and on a row no longer detected, so the
   baseline always lists exactly what is open.
3. **A script detects, and a person classifies.**{#person-classifies} The detector assigns
   no verdict. A person records each verdict in the baseline:
   `tracked:<issue>` for an open finding, or a classification with its
   reason. (`audit:specs --write` reopens a verdict whose commits
   grew, asking for it again; barwise-qs8.)
4. **An audit's ratchet is wired into CI.**{#ratchet-in-ci}

## Consequences

- Four audit ratchets are CI steps. CI runs on pushes to main and on
  pull requests into main.
  - `audit:duplication`, `audit:specs` and `audit:corrections` have no
    `if:` guard. They run in every CI run that reaches them; a step
    with no guard is still skipped once an earlier step fails.
  - `audit:rubric` is guarded by
    `if: steps.changes.outputs.docs_only != 'true'`, because "it scores
    through the built promptlab" (ci.yml), so it is skipped on a
    docs-only pull request.
  - The pre-push hook runs whichever of these CI would select for the
    change, through `ci:local`, which keeps going after a failure.
    `git push --no-verify` skips the hook.
  - Two other gates follow the same shape with an allowlist instead of
    a baseline: `check:instruction-refs` (from the 2026-10-04 prompt
    audit) and `check:python-uv` each fail on a stale allowlist row, so
    a fixed site forces its row out.
- Decision 2: each of the four audit ratchets implements both
  directions. A test covers the stale-row direction only for
  `audit:corrections` (barwise-2af).
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
- Decision 1 has no gate. It is held in review: `session-review` has
  each entry name its mechanism or say it has none, the pull request
  template and `pr-creation` require that section, and the `pr-review`
  checklist checks each entry names where it landed. The
  `duplication-audit` skill still calls its deliverable "a dated
  findings doc" (barwise-uuh).
- Decision 3 has no gate on who classifies, and verdict content is
  checked only partly.
  - `audit:corrections` checks a verdict's form: `caught_by` must come
    from a fixed list.
  - `audit:specs` checks form too: it rejects an empty or `TODO` note.
  - `trial:gate` requires a note and an issue, and a reproduction
    directory for a definite finding; a `could_not_answer` row needs
    none.
  - `audit:duplication` reads the verdict to word its message but
    does not validate it, and a row with no `status` crashes `--check`;
    `audit:rubric` never reads it. A `test:scripts` case (guarded by
    the same docs-only condition) rejects a placeholder in
    `rubric-baseline.json`.
  - No ratchet checks that a named issue exists in the tracker, or that
    it is open (barwise-u5d).
  - `pr-review`'s "Ratchets silenced" item and its checklist ask the
    reviewer to report a row added to make a ratchet pass, while
    `REVIEW.md`'s "Do not report" tells reviewers to skip the
    duplication ratchet (barwise-iil).
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
- Until they are replaced with links (barwise-5h3; the root `CLAUDE.md` states
  the rule in one line with a link since architecture-index WS5), these places
  also state this rule:
  - the `assertion-audit`, `session-review` and `duplication-audit`
    skills, and `steward` section 3;
  - `duplication-drift-guards.spec.md` WS5;
  - the headers of the five ratchets, of `baseline-merge.mjs` and of
    `check-instruction-refs.mjs`;
  - the `$comment` fields of `audit-baseline.json`,
    `correction-baseline.json` and `rubric-baseline.json` (the last
    written from `BASELINE_COMMENT` in `audit-rubric.mjs`);
  - the ci.yml comments on the four ratchet steps.
