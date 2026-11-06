# Findings close by mechanism

Scope: process
Date: 2026-11-06
Tracking: barwise-ubc, barwise-903, barwise-910, barwise-2af, barwise-uuy,
barwise-uuh, barwise-u5d, barwise-iil,
docs/specs/duplication-drift-guards.spec.md,
docs/specs/correction-record-ratchet.spec.md,
docs/specs/audit-finding-reader.spec.md
Enforced-by: npm run audit:specs -- --check (person-classifies),
npm run check:findings (mechanism-closes, person-classifies),
tests (ratchet-both-ways, ratchet-in-ci),
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

1. **A finding an audit ratchet records is held by its baseline row.**{#mechanism-closes}
   Every open finding (`tracked:<issue>`, or a trial row's `issue`)
   names a beads issue that exists and is not closed, and a closed issue
   keeps no open finding. The five baselines keep their files and
   vocabularies; `scripts/lib/findings.mjs` reads every row as
   `{ id, source, state, issue, classification, note }` so the rule is
   checked once, by `check:findings`, which also holds the trial
   catalog's issues to it.
2. **A ratchet fails both ways.**{#ratchet-both-ways} A detector reports candidates, and a
   committed baseline holds a verdict for each. `--check` fails on a
   new candidate with no row and on a row no longer detected, so the
   baseline always lists exactly what is open.
3. **A detector never invents a verdict.**{#person-classifies} A new row gets its
   writer's placeholder, `--check` fails while a placeholder remains,
   and every verdict comes from its audit's declared list, with a note.
   (`audit:specs --write` reopens a verdict whose commits grew, asking
   for it again; barwise-qs8.) Each audit's placeholder and list live in
   `scripts/lib/findings.mjs`, which the ratchets import.
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
- `RATCHETS` in `scripts/lib/findings.mjs` lists one ratchet per
  baseline the findings reader reads, with the `ci.yml` line that runs
  it. A test fails when a baseline has no ratchet, when a ratchet's line
  is not a step that can fail CI (run in `barwise/`, not
  continue-on-error, under a guard that runs it on every code change, as
  `adr-judge.mjs` judges a declared gate), when its npm script runs a
  different file, or when a ratchet has no stale-row case:
  - `audit:duplication`, `audit:specs` and `audit:rubric` get a row
    planted in their real baseline and must fail `--check` naming it;
    the rubric case needs the built promptlab, so it skips in CI, which
    runs `test:scripts` before the build (barwise-ym8.k4d, with
    barwise-ym8.fi5);
  - `audit:corrections` and `trial:gate` are covered by tests that
    plant a stale row in a sandbox, which the registry names and checks
    exist;
  - `trial:gate` alone has no CI step: a run needs `trial:offline`
    results, which no CI job produces (barwise-ym8.ld2).
- The other half of decision 2, a new candidate with no row, is tested
  for `audit:corrections` only (barwise-ym8.k4d).
- Decision 4 beyond the registry:
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
- `findings-close-by-mechanism.md#mechanism-closes` and
  `findings-close-by-mechanism.md#person-classifies` are held by
  `check:findings` (a CI step with no `if:`), over all five baselines
  and the trial catalog:
  - an open row naming an issue that is missing or closed fails; an
    `in_progress` issue counts as live, as `adr-judge.mjs` decides for
    ADR gap issues;
  - a row with its writer's placeholder fails, in every baseline,
    `rubric-baseline.json` and `audit-baseline.json` included;
  - a verdict outside its audit's list fails: `accepted-benign` or
    `tracked` for duplication and rubric, `CAUGHT_BY` for
    corrections, a `catalog.json` class for trial. A spec-status note
    is free text, checked only for being present and not a placeholder.
  - Spec-status and correction rows name no issue; an issue their notes
    mention is prose, not a claim the gate checks.
  - A recorded verdict needs a note (a spec-status note is the verdict
    itself), and a row that says `tracked` without naming an issue fails.
  - The ratchets' own `--check` still differ, and `check:findings` is
    what holds the verdict rules for all of them: `audit:duplication`
    crashes on a row with no `status` rather than reporting it, and
    `audit:rubric --check` reads ids only.
- The broader rule the first decision once stated, that any finding an
  audit turns up is closed by a mechanism and not by a document, is now
  prose held in review: `session-review` has each entry name its
  mechanism or say it has none, the pull request template and
  `pr-creation` require that section, and the `pr-review` checklist
  checks each entry names where it landed. The `duplication-audit`
  skill still calls its deliverable "a dated findings doc"
  (barwise-uuh).
- Whether a verdict is right is not checked: the decision's derived
  verdicts (syntax-tree sameness, differential tests, the package-graph
  rule) wait on the mechanical duplication spec (barwise-ym8.h0l,
  barwise-ym8.gc9.7fb). `pr-review`'s "Ratchets silenced" item asks
  the reviewer to report a row added to make a ratchet pass, while
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
