# Audit findings: one reader over the five baselines, and the gates it makes possible

Status: WS1 implemented 2026-11-06 (`scripts/lib/findings.mjs` and `check:findings`, a CI step; findings-close-by-mechanism decisions 1 and 3 restated; the dead catalog class removed); WS2-WS4 not started

Created: 2026-11-06
Last-updated: 2026-11-06
Tracking: barwise-ym8.gc9 (adr-refactor batch 4; rows 4, 5 and 11),
barwise-ym8.1b2, barwise-ym8.h0l, barwise-ym8.k4d, barwise-ym8.ld2,
barwise-ym8.fi5, barwise-ym8.3yv, barwise-ym8.6jy, barwise-ym8.nhy,
barwise-ym8.79m, barwise-ym8.8nq, barwise-ym8.onf, barwise-u5d
Plan-reviewed: 5f165c32 (code-review, pr-review)
Touches: +barwise/scripts/lib/findings.mjs, +barwise/scripts/check-findings.mjs,
barwise/scripts/audit-duplication.mjs, barwise/scripts/audit-rubric.mjs,
barwise/scripts/audit-spec-status.mjs, barwise/scripts/audit-corrections.mjs,
barwise/scripts/check-parity.mjs, barwise/scripts/lib/baseline-merge.mjs,
barwise/trial/lib/gate.mjs, barwise/scripts/tests/, barwise/package.json,
package.json, .github/workflows/ci.yml, barwise/docs/adr/findings-close-by-mechanism.md,
barwise/docs/adr/baselines-merge-on-write.md, barwise/docs/adr/must-agree-copies.md,
barwise/docs/adr/probes.json, barwise/docs/ARCHITECTURE.md

## Principle

A finding an audit records is a promise: "this is known, and here is
what happens to it". Today each of the five ratchets keeps that promise
in its own words, and checks a different part of it. Only `trial:gate`
has an issue field; `audit:duplication` hides the issue inside a status
string and checks no verdict at all; `audit:rubric --check` never reads
its verdicts (a `test:scripts` case catches its `"TODO"` placeholder,
but not a verdict outside its vocabulary). No
ratchet checks that a named issue exists or is open (barwise-u5d), so a
finding can point at a closed issue and read as handled. The owner's
answer (adr-refactor row 4) is one reader that gives every baseline row
the same shape, so the rules about findings are stated once and checked
once: explicit over implicit, applied to the audits' own records.

## Should each audit keep its file and vocabulary? (resolved: yes)

The reader normalizes; it does not migrate. Each baseline keeps its
path, its row key and its human vocabulary (`caught_by` is a taxonomy of
how a correction was caught, not a status, and a spec's Status header is
not a verdict). An adapter per source maps a row to

```
{ id, source, state: "open" | "classified" | "unclassified", issue?, classification, note }
```

`open` means the row names an issue that must be open; `classified`
means a recorded verdict that needs no issue; `unclassified` means the
writer's placeholder is still there. `classification` is the audit's own
word for the verdict, checked against that audit's declared list.
Migrating five files to one schema would rewrite 358 rows of recorded
judgment for no rule the reader cannot already state.

## Scope

In scope:

- **The reader** (`scripts/lib/findings.mjs`). When any caller asks for
  findings, the reader shall return every row of the five baselines in
  the common shape, and refuse (throw, so a gate exits 2) when a file
  is absent, malformed, or holds a row its adapter cannot map.
- **`check:findings`**, a gate over the reader, wired into CI with no
  `if:` guard:
  - When an `open` row names an issue that does not exist, or is closed,
    the gate shall exit 1 naming the row and the issue (row 4,
    barwise-u5d). "Closed" is `status === "closed"`, the judgement
    `adr-judge.mjs` already makes for ADR gap issues; `in_progress`
    counts as live, so claiming an issue never turns the gate red.
  - When a `trial/findings/catalog.json` class names an issue that does
    not exist or is closed, the gate shall exit 1: the catalog is where
    trial rows get their issue, so a dead id there becomes a red row the
    next time that class fires.
  - When any row is `unclassified`, the gate shall exit 1 naming it
    (row 5's placeholder rule, now for all five sources: rubric and
    duplication included).
  - When a row's classification is outside its source's declared list,
    the gate shall exit 1 (row 5's vocabulary rule; barwise-ym8.onf for
    duplication).
  - Each source's vocabulary and placeholder predicate is stated once,
    in `findings.mjs`, and the four ratchet scripts import it instead of
    keeping their own copy (`CAUGHT_BY`, the `TODO` and `(unclassified)`
    tests), so adding a value changes one place.
- **Writers** (`baselines-merge-on-write`): a test over a registry of
  every baseline writer holds each to importing `baseline-merge.mjs` or
  to a declared reason it does not (barwise-ym8.3yv), and to sorting by
  id and printing the merge summary (barwise-ym8.nhy).
  `trial/lib/gate.mjs` is that declared exception: its write is
  additive by design, because a run can cover some scopes or one tier,
  and `mergeBaselineRows` writes only the ids it was given (Open
  decision 4). `audit:specs`' write-on-ask and `audit:duplication`'s
  no-writer rule get run-and-compare tests (barwise-ym8.6jy,
  barwise-ym8.79m).
- **The ratchet registry** (`findings-close-by-mechanism`): one list of
  the ratchets, read by two tests: each ratchet has a stale-row case
  (barwise-ym8.k4d), and each has a `ci.yml` step or a declared reason
  it has none (barwise-ym8.ld2).
- **`check:parity`** refuses an unknown `ignore` value, an `ignore` on a
  symbol or field set, and a set of fewer than two members
  (barwise-ym8.8nq).
- **The ADR edits** these make true: `findings-close-by-mechanism`
  decisions 1 and 3 restated as rows 4 and 5 read; the `Enforced-by:`
  headers of the three ADRs gain `check:findings` and the new tests,
  with a `probes.json` row per new gate entry and a plant line per new
  test entry.

Out of scope:

- **Row 5's derived verdicts** (syntax-tree sameness, differential
  tests, the package-graph rule): they come from the mechanical
  duplication spec (barwise-ym8.gc9.7fb). This spec checks presence and
  vocabulary, not whether a verdict is right.
- **Row 11** (`must-agree-copies#check-on-copy`): its restatement waits
  on the same spec, as row 11 records. barwise-ym8.edf stays open.
- **The rubric writer test's skip** (barwise-ym8.fi5): in CI,
  `test:scripts` runs before `npm run build`, so promptlab's `dist` is
  never there and a refusing test would turn CI red. Moving the step or
  splitting the case is a CI-order change for its own PR; fi5 stays
  open, narrowed to it.
- **Wiring `trial:gate` into CI**: it needs `trial:offline`'s results,
  which no CI job produces; that lane is the trial spec's WS6. The
  registry declares the reason (Open decision 1).
- **A sweep of closed beads issues that look like findings**: row 4
  makes it an optional on-demand report, never a gate; not built here.

## Inventory

Measured 2026-11-06 (survey of the five baselines and their scripts).

| Baseline                    | Rows | Ratchet             | Issue lives in                | Placeholder                                  | Fails `--check` on placeholder | Merge helper          | In CI               |
| --------------------------- | ---- | ------------------- | ----------------------------- | -------------------------------------------- | ------------------------------ | --------------------- | ------------------- |
| `audit-baseline.json`       | 51   | `audit:duplication` | `status: "tracked:<id>"`      | none (no writer)                             | no (verdict never read)        | no writer             | yes                 |
| `rubric-baseline.json`      | 10   | `audit:rubric`      | `verdict: "tracked:<id> ..."` | `"TODO"`                                     | no (a test:scripts case does)  | yes                   | yes (not docs-only) |
| `spec-status-baseline.json` | 9    | `audit:specs`       | prose in `note` only          | `"TODO: classify"`, `"TODO: re-read -- ..."` | yes                            | yes                   | yes                 |
| `correction-baseline.json`  | 155  | `audit:corrections` | prose in `note` only          | `caught_by: "TODO: classify"`                | yes (`CAUGHT_BY` set)          | yes                   | yes                 |
| `trial-baseline.json`       | 133  | `trial:gate`        | `issue` field                 | `note: "(unclassified) ..."`, `issue: null`  | yes                            | no (additive, sorted) | no                  |

The tracker is `.beads/issues.jsonl` at the repository root. It has
three parse paths today (`parseTracker` in `scripts/lib/beads-merge.mjs`,
and ad-hoc ones in `check-tracker-closes.mjs` and `beads-crud.mjs`);
`createGovernanceReader(...).issues()` (`scripts/lib/adr-facts.mjs`)
wraps `parseTracker` with a refusal when unreadable. The reader uses
that and adds no fourth.

Day one, measured 2026-11-06: every rubric verdict starts
`accepted-benign`; the duplication rows are `accepted-benign` or
`tracked:barwise-875` (open); every trial row's issue is open; no spec
or correction row is unclassified; and one catalog class,
`diff-rename-no-synonym`, names barwise-rkm, which is closed, with no
baseline row using the class. So the gate is green on the baselines and
red on that one catalog entry until WS1 resolves it (Open decision 5).

Not affected: `LOCAL_STRAY_BASELINE` in core's counterexample law test
is a count ratchet inside a test, not a baseline file.

## Target architecture

```
scripts/lib/findings.mjs
  SOURCES: one adapter per baseline
    { source, file, key, vocabulary, map(id, row) -> Finding }
  readFindings(root) -> Finding[]          (throws: absent, malformed, unmappable)
  RATCHETS: { script, source?, ciStep | noCiReason }   (the registry)

scripts/check-findings.mjs                 (check:findings)
  readFindings + governance reader's issues()
  1 open row -> issue missing or closed
  1 unclassified row
  1 classification outside its source's vocabulary
  2 any input unreadable
```

The per-source mapping, in brief:

| Source      | `open` when                     | `classification`                  | `unclassified` when                               |
| ----------- | ------------------------------- | --------------------------------- | ------------------------------------------------- |
| duplication | `status` is `tracked:<id>`      | `accepted-benign` or `tracked`    | `status` absent or empty                          |
| rubric      | `verdict` starts `tracked:<id>` | text before the first `:`         | `verdict` is `"TODO"`                             |
| specs       | never (no issue field)          | `note` (free text, non-empty)     | `note` empty or starts `TODO`                     |
| corrections | never                           | `caught_by` (the `CAUGHT_BY` set) | `caught_by` starts `TODO`                         |
| trial       | `issue` is set                  | `class` (a `catalog.json` class)  | `note` starts `(unclassified)` or `issue` is null |

The catalog is read too: each class's `issue` is held to the same
exists-and-not-closed rule as an `open` row.

## Alternatives considered

- **One schema for all five files.** Rejected above: it rewrites
  recorded judgment and erases vocabularies that mean different things.
- **Each ratchet checks its own issues.** Five copies of "resolve the
  id, check it is open" against one tracker is the must-agree-copies
  pattern this refactor removes; the reader is the composition.
- **Fold the new rules into `check:architecture`.** It already reads
  the tracker, but it is the ADR and package-graph gate; findings are a
  different input, and a separate gate keeps a refusal in one from
  hiding the other.

## Workstreams (each independently shippable)

### 1. The reader and `check:findings`

`scripts/lib/findings.mjs` with the five adapters, their vocabularies
and placeholder predicates, which the four ratchet scripts then import
(moving `CAUGHT_BY` out of `audit-corrections.mjs`, which runs `main()`
on import and so cannot be imported from); `scripts/check-findings.mjs`; the npm script, its root
forwarder and a `ci.yml` step with no `if:`; tests in
`scripts/tests/` (each source's mapping, each finding kind, each
refusal). Before wiring, the gate runs on the real tree: any finding
it reports there (a closed issue behind an `open` row, a `"TODO"`
verdict) is fixed in the same PR: the gate has no allowlist, so CI
starts green or the PR does not merge. ADR edits: `findings-close-by-mechanism` decisions 1 and 3
restated per rows 4 and 5, `Enforced-by:` gains `check:findings
(mechanism-closes, person-classifies)` and `must-agree-copies` gains `check:findings (every-candidate-verdict)`.

Probes: `adr-probes` replays a decision's probe against every gate its
header lists, so each probe must turn all of them red. `mechanism-closes`
gets a new row (a duplication row's `tracked:` id changed to a closed
issue). `person-classifies` keeps its row (`TODO: classify` planted in
the spec-status baseline reddens `audit:specs` and `check:findings`).
The `every-candidate-verdict` row is rewritten to change the id and the
status together (`generated:000000000000` with status `bogus`), which
reddens `audit:duplication` (a new and a stale id) and `check:findings`
(vocabulary). Each runs with `npm run adr-probes -- --only` before
pushing. barwise-ym8.1b2, barwise-u5d and barwise-ym8.onf close after
merge; barwise-ym8.h0l narrows to row 5's derived verdicts.

### 2. Writers through one merge (provisional: not yet grounded)

A source-level test over every baseline writer: each imports
`baseline-merge.mjs`, or is `trial/lib/gate.mjs` with its declared
reason, and each sorts by id and prints the summary.
`BASELINE_WRITERS` keeps its three run-against-the-tree entries; the
trial writer gets its own case over a fixture results file, since
against the real tree it exits 2 without `trial:offline` results.
Run-and-compare tests for `audit:specs` with and without `--write` and
for `audit:duplication --check`. Closes barwise-ym8.3yv, 6jy, nhy and
79m; fi5 narrows to the rubric skip (out of scope).

### 3. The ratchet registry (provisional: not yet grounded)

`RATCHETS` in `findings.mjs`; a test that each listed ratchet has a
stale-row case, and one that pairs each with its `ci.yml` step through
`ci-occurrences.mjs` or a declared `noCiReason`. Closes or narrows
barwise-ym8.k4d and barwise-ym8.ld2.

### 4. `check:parity` validates its manifest (provisional: not yet grounded)

Refuse an unknown `ignore`, an `ignore` on a symbol or field set, and a
set with fewer than two members, with tests and a probe. Narrows
barwise-ym8.8nq (the manifest-entry ratchet is left to
barwise-ym8.gc9.e76, which is shrinking the sets).

## Open decisions (for review)

1. **`trial:gate` and CI.** Recommended: the registry records
   `noCiReason: "needs trial:offline results; trial spec WS6"`, and
   barwise-ym8.ld2 narrows to that one exemption. Alternative: wire
   `trial:offline` and `trial:gate` into CI here, which is the trial
   spec's decision and a CI cost nobody has measured.
2. **Spec and correction rows have no issue.** Recommended: they are
   never `open`; their prose mentions of issues are notes, not claims
   the gate checks. Alternative: parse `barwise-xxx` out of notes, which
   would turn every historical mention into a liveness claim.
3. **`audit:rubric`'s own `--check`.** Recommended: leave it reading
   ids only; `check:findings` owns the verdict rules for every source,
   so no ratchet carries a second copy of them.
4. **The trial writer and `one-merge-owner`.** Recommended: the trial
   writer stays additive, and the ADR's decision 2 names it as the one
   writer that keeps undetected rows, with the reason (partial runs).
   Alternative: give `mergeBaselineRows` a keep-undetected mode, which
   changes the helper every other writer relies on to drop stale rows.
5. **The closed catalog class.** Recommended: WS1 removes
   `diff-rename-no-synonym` from `catalog.json`, since its issue is
   closed and no row uses it; if the failure recurs, it arrives
   unclassified and gets a new issue. Alternative: reopen barwise-rkm,
   which would claim a fixed defect is open.

## Risks and testing

- **A gate red on the real tree on day one.** WS1 runs the gate before
  wiring it and fixes or records what it finds, so CI starts green.
- **Refusal versus finding.** An unreadable tracker or baseline is exit
  2, never a clean pass and never a finding (gate-refusal-contract).
- **Each new gate entry is planted**: a `probes.json` row for every
  `check:findings` decision, replayed by `npm run adr-probes`, and a
  plant line in the PR body for each `tests` entry.
- **Test counts.** `test:scripts` verifies its expected counts; each PR
  updates them with `--write` and states the change.

## Non-goals

- No change to any baseline's file, path, key or vocabulary.
- No verdict is derived or corrected by a script.
- No new tracker parser.
