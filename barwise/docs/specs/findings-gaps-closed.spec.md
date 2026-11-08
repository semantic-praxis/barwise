# Closing the batch 4 findings and baseline gaps

Status: Draft -- no workstream implemented

Created: 2026-11-08
Last-updated: 2026-11-08
Tracking: barwise-ym8.fi5, barwise-ym8.k4d, barwise-ym8.nhy, barwise-eu6, barwise-tko (barwise-ym8.h0l is out of scope: it waits on barwise-ym8.gc9.7fb)
Touches: .github/workflows/ci.yml,
barwise/scripts/tests/gates.test.mjs,
barwise/scripts/tests/adr-model.test.mjs,
barwise/scripts/tests/check-eval-coverage.test.mjs,
barwise/scripts/tests/expected-counts.json,
barwise/trial/lib/gate.mjs,
+barwise/trial/tests/gate-write.test.mjs,
barwise/docs/adr/baselines-merge-on-write.md,
barwise/docs/adr/findings-close-by-mechanism.md,
barwise/docs/ARCHITECTURE.md

## Principle

A check that cannot see its input must not report a pass (explicit over
implicit; `gate-refusal-contract`). Three of the four open gaps are that
shape. The audit-rubric tests skip in CI because `test:scripts`
(`ci.yml:452`) runs before `npm run build` (`ci.yml:468`), and an
untagged skip is invisible to `check:adr-tests`. The new-candidate half
of `ratchet-both-ways` is proven by name for four of six ratchets in
ways no registry holds. The trial writer prints no summary, so a reader
cannot tell what it kept. The fourth gap, `h0l`, is a decision that
cannot be restated until another spec exists.

## Scope

In scope:

- When `test:scripts` runs in CI, the system shall run the rubric writer
  and stale-row tests, or fail naming the missing `dist`; it shall not
  skip them (WS1).
- When a baseline row is removed while its detector still reports the
  finding, each of the six ratchets' `--check` shall exit 1 naming that
  candidate, and a registry test shall fail for a ratchet with no such
  case (WS2).
- When `trial/lib/gate.mjs --write` runs, it shall print how many
  verdicts it kept, how many rows are new, how many are still
  unclassified and which rows it kept although no longer open (WS3).

Out of scope:

- **`barwise-ym8.h0l`.** Its notes say what remains is the derived-verdict
  half of row 5 (syntax-tree sameness, differential tests, the
  package-graph rule). `barwise-ym8.gc9.7fb`, which defines those
  verdicts, is open (P2, feature) and its acceptance is "a spec ... plan-reviewed
  before code"; no such spec exists in `docs/specs/`. Nothing is
  checkable until it lands, and a gate written now would invent the
  verdict table that issue exists to design. The ADR keeps
  `none (barwise-ym8.h0l: person-classifies)`.
- The related issues `barwise-80d` (reopen counted as kept), `barwise-rh3`
  (silent refresh of derived fields) and `barwise-5ij` (dropped-row report
  tested for one writer): separate from every gap here.

## Inventory

| Item                                                         | Current state                                                                                                     | Verdict                               |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `gates.test.mjs` `BASELINE_WRITERS` rubric entry             | `needsDist`; skips in CI; its two tests drop the `[adr:...]` tag when `needsDist` is set                          | WS1: runs, tag unconditional          |
| `gates.test.mjs` `STALE_CASES.rubric`                        | same skip, same dropped tag                                                                                       | WS1                                   |
| `ci.yml` `test:scripts` (line 452) and `npm run build` (468) | scripts tests first, build after                                                                                  | WS1: swap                             |
| `adr-model.test.mjs`, `check-eval-coverage.test.mjs`         | headers say test:scripts "runs before the build and sees them skip"; they skip on absent `core`/`learn` `dist`    | WS1: they now run; comments corrected |
| `gates.test.mjs` `STALE_CASES` + registry test               | stale half pinned for all six ratchets                                                                            | WS2: add `NEW_CASES`                  |
| `merge-record.test.mjs:296`, `oracles.test.mjs:460`          | a merge with no trailer is a finding; `evaluateGate` reports `fresh`; neither is tagged or named in a registry    | WS2: named by `testedBy`, tagged      |
| `trial/lib/gate.mjs` `runGate`                               | paths fixed (`BASELINE_PATH`, `resultsPath(tier)`); prints a matched count, a written count, `STALE ROW`; no test | WS3: injectable paths, summary, test  |
| `expected-counts.json` `--write` (`run-script-tests.mjs`)    | holds derived counts, no verdict, no helper                                                                       | WS3: named as outside the rule        |

Untouched: `baseline-merge.mjs` (WS3 chooses not to change it),
`findings.mjs` (`RATCHETS` already lists the six ratchets), and
`audit-rubric.mjs` itself.

## Workstreams

Ordered by dependency: WS1 first, because WS2's rubric case needs the
rubric tests to run in CI. WS3 is independent.

### WS1. The rubric tests run in CI (fi5, k4d rubric half, eu6)

Cause, verified: `ci.yml` runs `npm run test:scripts` at line 452 and
`npm run build` at line 468. `audit-rubric.mjs` imports
`packages/promptlab/dist/index.js` and exits 2 without it. The three
rubric cases (`gates.test.mjs` writer round trip, writer order and
summary, stale row) test `t.skip` on the missing `dist`. The pre-push
`ci:local --commit` derives its order from `ci.yml` and runs in a fresh
worktree, so it skips too. Both tests also omit the
`[adr:baselines-merge-on-write#...]` tag when `needsDist` is set, so
`check:adr-tests` does not count them; the ADR's `none (barwise-ym8.fi5)`
is accurate.

Change (recommended alternative, see Alternatives and Open decision 1):

1. Move `- run: npm run test:scripts` to immediately after
   `- run: npm run build`, keeping its `docs_only` condition.
2. In `gates.test.mjs`, one helper `needDist(t, path)`: when the path is
   absent and `process.env.CI` is set, it throws (the test fails naming
   the path); otherwise it skips as now. Three sites use it (writer
   round trip, order and summary, stale row), replacing the three inline
   skips, including the "dist exists but will not load" skip.
3. The tag is unconditional on both writer tests and the stale test.
4. A test asserts, from `ciSteps()` (`lib/ci-gates.mjs`), that when any
   registry entry in `gates.test.mjs` carries `needsDist`, the step
   running `npm run test:scripts` comes after the step running
   `npm run build`.
5. Correct the comment on the `BASELINE_WRITERS` rubric entry
   ("`npm test` builds before it gets here"), and the headers of
   `adr-model.test.mjs` and `check-eval-coverage.test.mjs`.
6. ADR `baselines-merge-on-write`: drop `none (barwise-ym8.fi5: ...)` and
   the CI-order Consequences bullet; restate that the rubric tests run
   after the build. Edit in place, as `barwise-eu6` asks.

Plants proving it goes red:

- Swap the two steps back in `ci.yml`: the order test (item 4) fails.
- Delete `packages/promptlab/dist` and run with `CI=1`: the three rubric
  tests fail instead of skipping (the tests plant this in a child
  process whose `dist` path is overridden; the real `dist` is not
  touched).
- Run `check:adr-tests` over a `test:scripts` report in which the rubric
  tests are skipped: it must name the decision untested (today the tag is
  absent when they skip, so they are never counted; after item 3 a skip
  leaves the tag missing from the passed set).

Closes `barwise-ym8.fi5` and `barwise-eu6`.

### WS2. New-candidate cases for every ratchet (k4d)

`STALE_CASES` already maps each source in `RATCHETS` to a planted stale
row or a named test, and a registry test requires the keys to equal
`RATCHETS`. Add `NEW_CASES` beside it with the same shape and the same
registry assertion. Each plants a candidate with no row:

| Ratchet        | Case                                                                                             | Expected                                                               |
| -------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `duplication`  | Delete one row from `audit-baseline.json` (restored in `finally`); its detector still reports it | exit 1, `NEW candidate not in audit-baseline.json` and the id          |
| `rubric`       | Delete one row from `rubric-baseline.json` (needs WS1)                                           | exit 1, `NEW non-discriminating check, not in the baseline` and the id |
| `specs`        | Delete one row from `spec-status-baseline.json`; needs full history                              | exit 1, `NEW: <id>`                                                    |
| `corrections`  | `testedBy` the existing "fails on a correction record missing from the baseline"                 | named; test exists                                                     |
| `merge-record` | `testedBy` `merge-record.test.mjs` "a merge with no trailer at all is a finding"                 | named; add the tag                                                     |
| `trial`        | `testedBy` `oracles.test.mjs` "evaluateGate: a new failure, ..." (its `v1.fresh` assertion)      | named; add the tag                                                     |

A row removed from the real baseline is the uniform plant: the real
detector produces the candidate, so the case cannot pass for a reason the
detector does not share. It mirrors the stale cases, which add a row to
the real file. The registry test also checks each `testedBy` title still
occurs in its file, as it does for the stale half.

Plants: for each in-place case, replace the assertion on the exit code
with the opposite and see it fail; for each `testedBy`, rename the title
and see the registry test fail. All six tests carry
`[adr:findings-close-by-mechanism#ratchet-both-ways]`. The ADR drops
`none (barwise-ym8.k4d: ratchet-both-ways)`.

Closes `barwise-ym8.k4d`.

### WS3. The trial writer says what it did (nhy, tko)

`trial/lib/gate.mjs --write` writes the new rows for the scopes that ran
and leaves every other row alone, then prints
`wrote N row(s)`. That is correct for partial runs and silent about the
rest. The gate itself already reports a row in a scope that ran and is no
longer open as `STALE ROW ... remove it from trial-baseline.json`, a
definite failure, so a kept stale row is not hidden; it is just not part
of the write report. The catalog also explains why the helper does not
fit: a new row's `class`, `issue` and `note` come from `classify()`
per row, whereas `mergeBaselineRows` stamps one placeholder per field.

Change (recommended; see Open decision 2):

1. `runGate` takes optional `baselinePath` and `resultsFile` (defaults the
   current constants), so a test can run it in a temp directory.
2. After the write, print one line in the helper's terms:
   `trial gate: K verdict(s) kept, N new (C matched a catalog class), U still unclassified, S kept although no longer open`.
   `K` counts existing rows with a note and an issue, `U` rows with
   `isTrialRowUnclassified`, `S` the `stale` list. Rows keep their sort by
   id.
3. ADR decision 2 restates the exception: the trial writer is additive,
   keeps rows no longer open (the gate fails on them until removed by
   hand), and prints its own summary. Remove
   `none (barwise-ym8.nhy: findings-order)`. Add a tagged test in
   `trial/tests/gate-write.test.mjs` (run by `test:trial`, whose
   report `check:adr-tests` reads).
4. State in the same ADR sentence that `expected-counts.json`'s writer is
   outside the rule: it holds derived counts and no verdict, so
   regenerating it loses nothing (barwise-tko's second question).
   `WRITERS` in `gates.test.mjs` keeps its trial exception, with the
   reason text matching the ADR's.

Plants (`gate-write.test.mjs`, temp directory): a results file with one
new failing step, a baseline holding one classified row (kept), one
unclassified row and one row in a ran scope that is no longer failing,
rows written in reverse id order. Asserts: the printed line has all four
counts; the written file has the stale row still present and every row
sorted by id; the classified row byte-identical. Mutations: drop the
`console.log`, drop the sort, delete the stale row on write; each turns a
case red (run with `mutate.mjs`).

Closes `barwise-ym8.nhy` and `barwise-tko`.

## Alternatives considered

**fi5 (CI order).**

| Option                                                                             | Cost                                                                                                                                                                                                                                                        | Guarantees                                                                                            |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| A. Move `test:scripts` after `build`                                               | One step swap; `ci:local` follows since it reads `ci.yml`'s order. A script-test failure surfaces after the build, not before; `adr-model` and `eval-coverage` end-to-end cases now also run here                                                           | Every `test:scripts` test sees `dist` wherever the build ran. Alone, a later move back skips silently |
| B. A second step after build for the rubric cases (the `test:adr-model` precedent) | New test file, a runner that refuses on skip (a near copy of `scripts/test-adr-model.mjs`, or a generalization), a `ci.yml` step, matrix exception, counts; the tagged tests then run in a runner `check:adr-tests` does not read unless it writes a report | Rubric cases refuse to skip. Two places to keep consistent                                            |
| C. A test-side refusal when `CI` is set and `dist` is absent                       | One helper, three sites                                                                                                                                                                                                                                     | A skip cannot reach CI silently. Alone, turns CI red until the order is fixed                         |
| D. Build promptlab in the test's setup                                             | Rebuilds core, llm and learn (promptlab's dependencies) inside a test; side effects on `dist`; hides a build failure as a test failure                                                                                                                      | `dist` exists, at the price of a test that builds                                                     |

A plus C is chosen: A makes the tests run, C makes the state "skipped in
CI" unrepresentable, and the order test (WS1 item 4) holds A. B follows
the `adr-model` precedent but costs the most and hides the tagged tests
from `check:adr-tests`.

**nhy (trial writer).**

| Option                                                                           | Cost                                                                                                                                                                                                                                                                  | Result                                                                      |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| A. Route through `mergeBaselineRows` over the ran scopes, merge the rest by hand | Split existing rows into ran and not-ran scopes; extend `preserve` so a new row's placeholder can come from `classify()`, or classify after the merge and miscount `unclassified`; the helper's `dropped` would delete rows the gate currently says to remove by hand | Exception and `tko` disappear; larger change to a writer with no test today |
| B. Keep it additive, restate the exception, add the summary and a test           | Small; the earlier owner-reviewed recommendation (`audit-finding-reader.spec.md`, Open decision 4)                                                                                                                                                                    | Exception stays, now with a stated reason and a test                        |
| C. Give `mergeBaselineRows` a keep-undetected mode                               | Changes the helper five other writers rely on to drop stale rows                                                                                                                                                                                                      | Rejected in `audit-finding-reader.spec.md` for that reason                  |

**k4d plants.** Sandbox copies of each baseline (as the corrections case
does) were considered; in-place deletion of a real row is chosen because
it matches the stale cases and cannot diverge from the real detector.

## Open decisions (for review)

1. **How the rubric tests get a built `promptlab` (changes CI step order).**
   Options: A, B, C, D above. Recommended: A plus C. Move `npm run test:scripts`
   after `npm run build` in `ci.yml` and make the tests refuse, not skip,
   when `CI` is set and `dist` is absent. It is the smallest change that
   makes the tests run and keeps them from regressing. It also moves the
   `adr-model` and `eval-coverage` end-to-end cases from skipped to run
   inside `test:scripts`, which takes extra seconds, and a failing script
   test is now reported after the build rather than before. If the owner
   prefers failing fast before the build, B is the alternative.
2. **Trial writer: restate the exception or join the helper.** Recommended: B
   (restate, add summary and test). The helper's per-field placeholder
   cannot express a catalog-classified new row, and deleting rows the gate
   deliberately asks to be removed by hand changes the writer's contract
   for no verdict-safety gain. Choose A only if the owner wants no named
   exceptions in decision 2.
3. **Is `expected-counts.json`'s writer under `one-merge-owner`?**
   Recommended: no; it holds derived counts and no verdict, so
   regeneration loses nothing. Say so in decision 2.
4. **`h0l`.** Recommended: leave open and untouched until
   `barwise-ym8.gc9.7fb` has an approved spec; link the two in the
   issue's notes in the commit that lands this spec.

## Risks and testing

- **Parallel files and a mutated baseline.** WS2's in-place plants edit
  real baselines inside `gates.test.mjs`; tests within a file run
  sequentially, but another test file reading the same baseline in
  parallel could see the removed row. The stale cases already do this
  (restored in `finally`); WS2 checks `check-findings.test.mjs` and
  `baseline-merge.test.mjs` use sandboxes before adding more.
- **`CI` in a developer's shell.** A developer with `CI=1` and no build
  gets a failure instead of a skip. That is the intended refusal; the
  message names `npm run build`.
- **`ci:local` and `CI`.** Whether `ci:local` exports `CI` is checked in
  WS1; the order swap covers it either way.
- **`check:adr-tests` reading the new tags.** Verified in WS1 against the
  `test:scripts` report that the rubric tests appear as passed, not
  skipped, in a CI-shaped run.
- **Expected counts.** WS2 and WS3 add tests; regenerate
  `scripts/tests/expected-counts.json` with `npm run test:scripts -- --write`.
- **Mechanism closure.** `needDist`, `NEW_CASES`, `gate-write.test.mjs`
  and the order test are created by WS1-WS3; nothing else is invented.

## Non-goals

- A mechanical classifier for duplication verdicts (`gc9.7fb`).
- Wiring `trial:gate` into CI (the trial spec's WS6).
- Changing what the merge summary counts (`80d`, `rh3`).
