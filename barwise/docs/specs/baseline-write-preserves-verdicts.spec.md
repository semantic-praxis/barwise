# A baseline writer merges the verdicts it finds, never regenerates over them

Status: Implemented. Both workstreams shipped together; three things the draft
had wrong or missing are recorded in Implementation notes below

Created: 2026-09-15
Last-updated: 2026-09-15
Tracking: barwise-1026 (the instance: `audit-corrections --write` replaced 66
recorded classifications with `TODO: classify` to add one row). The shape is the
one `docs/specs/gate-refusal-contract.spec.md` names one layer out -- an
instrument whose output cannot distinguish a real answer from no answer -- here
applied to the instrument's own writes rather than its reads.

In one sentence: the documented way to add one baseline row is currently the
way to destroy every verdict already recorded in that file, so the writers must
merge the human-owned fields instead of regenerating them.

## Principle

**Define errors out of existence**, applied to the operator's own hand.

CLAUDE.md's counterweight paragraph says to prefer designing away a failure
case over requiring every caller to handle it. The failure case here is
"running the documented command loses ninety human judgments", and today it is
designed _in_: `--write` builds the record map from the detector alone, so the
placeholder it stamps into every row is unconditional. The only thing standing
between an operator and the loss is remembering never to use the flag the
script advertises. That rule was forgotten twice -- barwise-1026 is recorded as
the second occurrence of the shape -- which is the evidence that remembering is
not the countermeasure.

The verdicts are not incidental content. CLAUDE.md's rule is that **a finding
is not closed by a document**: it is closed by a baseline row that has to be
removed when the finding is fixed. The `caught_by` verdict, the rubric
`verdict`, the spec-status `note` -- each one _is_ the closure record for a
finding. A writer that blanks them does not lose formatting; it loses the only
durable statement of which findings were judged and how.

DRY is the secondary principle at stake, and it decides the shape rather than
the existence of the fix. Three scripts make the same decision -- which fields
the detector owns and which the human owns -- under three different field
names. Fixing them separately creates three copies of one decision with
nothing checking that they agree, which is exactly what
`docs/specs/duplication-drift-guards.spec.md` forbids in the same commit that
creates the copy. One owner, three declarations.

## The reading (resolved: measured, 90 of 90 verdicts destroyed)

Every writer was run once against the current tree, with the baselines backed
up and restored afterwards. No flag combination was needed to provoke this;
these are the documented spellings.

| Script                  | Spelling invoked   | Rows | Verdicts before | Verdicts after |
| ----------------------- | ------------------ | ---: | --------------: | -------------: |
| `audit-corrections.mjs` | `--write`          |   74 |              74 |              0 |
| `audit-rubric.mjs`      | `--write-baseline` |   10 |              10 |              0 |
| `audit-spec-status.mjs` | _(no flag at all)_ |    6 |               6 |              0 |
| `audit-duplication.mjs` | -- never writes    |   48 |              48 |             48 |

All 74 `note` fields in `correction-baseline.json` were also blanked. The
`audit-duplication` row is the control and the design hint: its 48-candidate
baseline is hand-maintained, has no writer, and therefore has never had this
defect.

Two facts in that table are worse than barwise-1026 describes, and both were
found by running the scripts rather than by reading the issue.

**`audit-spec-status` needs no flag.** Its write path is the `else` of
`--check`, so bare `node scripts/audit-spec-status.mjs` -- and therefore
`npm run audit:specs`, the spelling a reader tries first to see what the gate
says -- silently rewrites the baseline. The two read-only-looking modes
(`--survey`, `--at`) exit before it; nothing else does. A command whose
plainest form mutates tracked state is a worse instance of the shape than the
one filed, because the operator did not ask to write anything.

**The loss is not confined to one gate.** barwise-1026 names
`audit-corrections`; all three writers share the defect, so a fix scoped to the
filed instance would leave sixteen verdicts destroyable by the same mistake.

## Should the placeholder ever overwrite a verdict? (resolved: no)

No, and the reason is that the detector has no opinion about the fields it
would be overwriting. `recordId()` is `spec-name::sha256(normalised text)`
truncated to 12 hex, so a row's id is stable exactly as long as the text that
produced it is unchanged. When the id still appears, the detector is reporting
the same finding it reported last time and has learned nothing new about
whether reasoning or execution caught it. When the text changes, the id
changes, the row is new, and `--check` already reports the old one as "no
longer detected" -- the existing stale-entry half of the ratchet handles that
case and needs no help.

So the merge rule follows from the id, not from a preference: **preserve the
human-owned fields of any row whose id the detector still produces; refresh
every derived field from the detector; stamp the placeholder only on ids that
are genuinely new.**

## Scope

In scope:

- When `--write` runs and a baseline row's id is still detected, the system
  shall write that row with its existing human-owned field values unchanged.
- When `--write` runs and a detected id has no baseline row, the system shall
  write that row with the script's placeholder verdict.
- When `--write` runs, the system shall report on stdout how many rows kept an
  existing verdict, how many were added, and how many baseline rows were
  dropped as no longer detected.
- When a baseline row's derived fields (its spec path, excerpt, message, status
  or commit list) differ from the detector's current reading, the system shall
  write the detector's values.
- When `audit-spec-status.mjs` runs with no mode flag, the system shall report
  its findings and exit without writing the baseline.
- When `audit-spec-status.mjs` runs with `--write`, the system shall write the
  baseline under the merge rule above.

Out of scope:

- **barwise-1027** (a `node --test` run that ends early still prints a
  plausible summary). Related in shape, separate in mechanism, and its filed
  description rests on an assumption that does not hold: measured here,
  `node --test` isolates per file, so a load-time throw in one file does not
  stop the others (a three-file probe reported
  `# tests 6 / # pass 5 / # fail 1` with the third file running normally).
  The 41-of-99 truncation was therefore inside the single 2195-line `gates.test.mjs`, which makes a
  per-file count floor the likely mechanism rather than anything about the
  runner's file handling. That needs its own grounding; it is not this spec.
- `audit-duplication.mjs` gains no writer. It has none today, its baseline is
  hand-maintained, and adding one to make the four scripts symmetrical would
  create the hazard this spec removes.
- The verdict vocabularies (`CAUGHT_BY` and the rubric's verdict set) are
  unchanged. This spec moves which fields survive a write, not what may go in
  them.

## Inventory

| Module                           | Current state                                                           | Verdict                              |
| -------------------------------- | ----------------------------------------------------------------------- | ------------------------------------ |
| `scripts/lib/baseline-merge.mjs` | does not exist                                                          | new: owns the merge decision         |
| `scripts/audit-corrections.mjs`  | `--write` stamps `caught_by: "TODO: classify"`, `note: ""` on every row | calls the helper                     |
| `scripts/audit-rubric.mjs`       | `--write-baseline` stamps `verdict: "TODO"` on every row                | calls the helper                     |
| `scripts/audit-spec-status.mjs`  | bare invocation stamps `note: "TODO: classify"` on every row            | calls the helper; write needs a flag |
| `scripts/audit-duplication.mjs`  | no writer; 48 hand-maintained candidates                                | untouched                            |
| `scripts/tests/gates.test.mjs`   | 2195 lines, has a `gate()` helper and an `audit-spec-status` section    | gains the merge cases                |
| `correction-baseline.json`       | 74 rows, 74 classified, 74 notes                                        | content untouched                    |
| `rubric-baseline.json`           | 10 rows, 10 classified                                                  | content untouched                    |
| `spec-status-baseline.json`      | 6 rows, 6 classified                                                    | content untouched                    |

The three baseline files are listed because a reviewer will want to see what
this change does to them: **no verdict is edited, and one row is added** (a
correction record from this spec's own text, classified `not-a-correction` --
the detector matched `caught it` where the prose names the verdict vocabulary).
A correct fix leaves all three byte-identical when `--write` runs against an
already-classified tree, which is the strongest available test and WS1 asserts
it for all three.

`ci.yml` and the husky hooks are untouched. Every CI invocation already passes
`--check`; nothing in the repository invokes a write path, which is why the
`audit-spec-status` default can change without a migration.

## Target architecture

```
scripts/lib/baseline-merge.mjs
  mergeBaselineRows({ fresh, existing, preserve }) -> { rows, kept, added, dropped }

    fresh     id -> derived fields, from the detector
    existing  id -> row as committed (may be {})
    preserve  human-owned field name -> value a NEW row gets
              audit-corrections: { caught_by: "TODO: classify", note: "" }
              audit-rubric:      { verdict: "TODO" }
              audit-spec-status: { note: "TODO: classify" }

    per id in fresh:
      rows[id] = { ...fresh[id], ...pick(existing[id] ?? preserve, keys(preserve)) }
    kept      ids present in both, counted per id that carried a non-placeholder value
    added     ids in fresh only
    dropped   ids in existing only -- reported, not written

  One module because "which fields does the human own" is one decision in three
  costumes. `preserve` is where each script declares its own answer, so the
  three field vocabularies stay independent while the merge rule does not.
```

## Alternatives considered

- **Fix each writer in place.** Three copies of the merge loop under three
  field names, agreeing by coincidence. The fourth writer would get it wrong,
  and nothing would notice -- the exact condition
  `duplication-drift-guards.spec.md` requires a check for. Rejected on the
  secondary principle, not the primary one: the duplication would be small and
  readable, and would still be a must-agree copy with no guard.

- **Refuse to write when the baseline holds classifications.** Exit 2 and tell
  the operator to hand-edit. This is the gate-refusal contract applied
  literally, and it is the wrong reach for a write: refusing is right when an
  instrument cannot see its input, but here it sees everything it needs and
  declines to do arithmetic the caller must then do by hand. That is the
  shallow-interface move the principle paragraph in CLAUDE.md explicitly warns
  against -- pushing work onto callers rather than solving it once, centrally.
  Rejected.

- **Leave the writers alone and rely on git.** `git checkout --` recovered the
  file this time. It is not a mechanism: it works only when someone notices,
  and barwise-1026 records that the noticing was luck (a later `--check`
  failing on an untouched row). A recovery procedure that depends on detecting
  the loss is a document, and CLAUDE.md's rule is that a finding is not closed
  by one.

- **Make the placeholder a value `--check` tolerates.** Removes the immediate
  failure and keeps the data loss. Strictly worse: the current behaviour at
  least fails loudly on the next `--check`, which is the only reason
  barwise-1026 exists to be fixed.

## Workstreams (each independently shippable)

### 1. The merge helper, and all three writers onto it

`scripts/lib/baseline-merge.mjs` plus the three call sites, because leaving two
writers clobbering is leaving the defect: the shared owner is the deliverable,
and a single call site would not prove the abstraction holds across three field
vocabularies.

The acceptance test is a round-trip against the real tree: run each writer with
its own flag against the committed baselines and assert the files come back
byte-identical. That assertion is only available because the current tree has
every row classified, and it fails today for all three.

Also lands the kept/added/dropped line on stdout. Without it, a successful
merge and a silent clobber print the same sentence, which is the same
two-values-for-three-situations defect one level down.

### 2. `audit-spec-status` writes only when asked

The bare invocation becomes a report. Separate from WS1 because it is a
different defect -- a destructive default, not a lossy merge -- and because it
is the one behaviour change in this spec that a reader's muscle memory could
notice. Nothing in the repository depends on the current default (verified:
every CI and hook invocation passes `--check`), so this is a one-line mode
change plus the test that pins it.

## API and migration impact

- No package API changes. `scripts/lib/` is build tooling; nothing under
  `packages/` imports it, and the dependency graph is untouched.
- `npm run audit:specs` stops writing the baseline. This is the intended
  behaviour change; the write moves to `npm run audit:specs -- --write`.
- The three baseline JSON files keep their current shape and content. A
  reviewer can verify the whole change by confirming the diff touches no
  baseline row.

## Open decisions (for review)

- **What the bare `audit:specs` should print.** Recommend the finding list it
  already computes (matching `audit-corrections`' no-flag survey, which is the
  house pattern). The alternative is exit 2 with "pick a mode", which is more
  defensive and less useful; the survey cannot mislead because it writes
  nothing.
- **Whether a changed derived field deserves a report line.** The spec has the
  writer silently refresh a row's excerpt or commit list while keeping its
  verdict. That is right when a spec was reformatted, and it quietly re-uses a
  verdict against slightly different evidence when the excerpt was rewritten
  without changing the normalised text. Recommend silent refresh for now and a
  count in the summary line; a per-row diff is more noise than the case
  justifies until it happens once.
- **Whether `kept` should count placeholder rows as kept.** Recommend no: a row
  that still says `TODO: classify` was never judged, so counting it as
  preserved overstates what the file holds. It appears in `added` on first
  write and in neither bucket afterwards, which argues for a fourth count
  (`unclassified`) if the summary is to add up. Reviewer's call whether that is
  worth a fourth number.

## Risks and testing

- **The behaviour that must not change is the ratchet itself.** `--check` must
  still fail on a new undeclared finding and on a stale row. WS1 touches only
  the write path; the existing `--check` cases in `gates.test.mjs` guard this,
  and they run from three working directories already.
- **Verified red, not just green.** Each new case is checked with
  `npm run mutate` against a planted defect -- the merge dropping `preserve`,
  and the bare invocation writing -- and the test count is read, not just the
  verdict, because barwise-1019's shape (a non-compiling mutation reporting
  `Tests no tests` as a catch) has been met in the wild during this work.
- **The byte-identical round trip is the load-bearing assertion.** It is
  strong precisely because it depends on the tree having zero unclassified
  rows today; if a future tree carries a `TODO`, the assertion weakens without
  announcing it. WS1 therefore also asserts the unclassified count is zero in
  the fixture it uses, so the test fails loudly rather than silently becoming
  vacuous.
- Run `npm run ci:local` before pushing; the gate list includes all four audit
  checks.

## Implementation notes (deviations from the draft)

Three things the draft did not have right. Each is here rather than silently
fixed, so the next reader starts from what the code does.

**Sorting was missing, and the round-trip test cannot exist without it.** The
draft specified the merge and stopped. Running it showed the writers emit rows
in detector-traversal order, which no longer matches the committed files:
regenerating `correction-baseline.json` moved 73 of its 74 rows while changing
nothing. That is a diff no reviewer can read, and it defeats the
byte-identical assertion this spec leans on. `mergeBaselineRows` now sorts by
id, which also makes the output a function of the findings alone -- two runs
over one tree are identical. Cost: a one-time reordering of all three
baselines, included here.

**`readExistingRows` was three copies before it was one.** The draft put the
merge in a shared module and left each writer to read its own file. Writing the
second one produced a verbatim copy of the first's ENOENT-versus-malformed
reading -- a must-agree pair created in the same commit that argues against
them. It moved into the helper as a second export.

**Two guards had no reachable failure path, and mutation is what said so.**
Both were written with a confident comment and neither could fail:

- `key in prior` versus `prior[key] || placeholder`. The comment claimed the
  naive form "would re-blank exactly the field this module exists to protect".
  Measured: no current caller can tell them apart, because each one either
  rejects a falsy human field in `--check` or has `""` as its own placeholder.
  The guard is right for a shared contract and is kept, but it is now asserted
  at the helper level (`scripts/tests/baseline-merge.test.mjs`) and the comment
  says what is and is not reachable. The script-level test that appeared to
  cover it was deleted; it asserted nothing.
- `readExistingRows` throwing on a malformed baseline. The test written for it
  passed with the guard removed, because `JSON.parse` sits outside the `try` --
  a truncated file throws whatever the catch does. The guard's actual job is
  refusing a failing READ, which needed an EISDIR probe to reach.

Both were found by `npm run mutate` reporting UNCAUGHT, not by review. The
working countermeasure is the cheap one barwise-1019 keeps pointing at: read
what the mutation actually changed, and do not accept a comment as evidence
that a line is load-bearing.

## Non-goals

- No new gate, no new baseline, no change to what any detector detects.
- No change to the verdict vocabularies or to `--check`'s failure conditions.
- No writer for `audit-duplication.mjs`.
- No fix for barwise-1027 in this spec.
