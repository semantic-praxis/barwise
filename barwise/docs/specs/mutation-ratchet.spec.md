# A mutation ratchet must count only what the test suite is responsible for

Status: Draft -- no workstream implemented. All five open decisions
resolved 2026-09-10; the workstreams below reflect them.
Created: 2026-09-10
Last-updated: 2026-09-10
Tracking: barwise-994. Resolves `docs/specs/test-quality.spec.md` WS2's
outstanding half (the number landed; the ratchet did not) and depends on
that spec's Open decision 1, resolved 2026-09-10.

In one sentence: **the mutation score cannot be ratcheted as it stands,
because 59% of its surviving mutants do not compile** -- so the ratchet
classifies survivors by whether the suite is the thing that should have
caught them, and it runs on a schedule, because a 16-minute check that
fires when someone remembers is not a gate.

## Principle

**The shadow and the property**, applied one level in. CLAUDE.md's
vocabulary entry says coverage is a shadow of test effectiveness and the
mutation score is the property. That is right, and it is not the end of
the argument: the raw mutation score is itself a shadow of the property
"could a defect ship." A mutant that `tsc` rejects cannot ship. Counting
it against the suite measures something real about the suite and nothing
at all about the risk.

**Define errors out of existence.** The alternative to classifying
survivors is asking every reader of the number to hold the caveat in
their head -- and the caveat is not small enough to hold. It is 11 points
on the one file measured. A number that needs a footnote to be true is a
number that will be read without the footnote.

**Determinism.** The classification is derived, never declared: the
harness applies each survivor and asks the compiler. Nobody maintains a
list of which mutants "don't count", which would be the must-agree copy
this repository's own rules forbid.

## Should the ratchet gate on the raw score? (resolved: no, measured)

**No. On the one file measured, 53 of 90 survivors are rejected by
`tsc`.** Every surviving mutant in
`packages/core/src/mapping/RelationalMapper.ts` was applied to the source
and type-checked (`npx tsc --noEmit`, 3.5s per run, 90 runs, working tree
verified clean afterwards):

| Mutator kind          | Survivors | `tsc` rejects | The suite's to catch |
| --------------------- | --------: | ------------: | -------------------: |
| ConditionalExpression |        37 |            21 |                   16 |
| OptionalChaining      |        16 |            16 |                    0 |
| LogicalOperator       |        10 |             9 |                    1 |
| StringLiteral         |         7 |             3 |                    4 |
| BooleanLiteral        |         5 |             0 |                    5 |
| EqualityOperator      |         4 |             0 |                    4 |
| ArrowFunction         |         4 |             2 |                    2 |
| ObjectLiteral         |         2 |             2 |                    0 |
| Other (6 kinds)       |         5 |             0 |                    5 |
| **Total**             |    **90** |        **53** |               **37** |

Rejections are real type errors, not parse failures: TS2367, TS2345,
TS18048, TS2322, TS2532, TS2741, TS2339.

What that does to the number:

| Reading                                      |        Score |
| -------------------------------------------- | -----------: |
| Raw (374 killed of 468)                      |       79.91% |
| Counting `tsc`-rejected survivors as covered |       91.24% |
| Difference                                   | 11.32 points |

**A ratchet on 79.91% would gate on a figure where the majority of the
gap is not a gap.** Worse, it would reward the wrong move: the cheapest
way to raise a raw score is to write a test that pins a mutation the
compiler already rejects, which adds a test that can never fail.

### Why the compiler catches so many

`vitest` runs through esbuild, which strips types without checking them.
No mutation into a typed position can ever be caught by the suite,
because the suite never type-checks. `tsc --noEmit` does, and it runs in
CI as its own gate via `npm run build`. So the defect classes divide
cleanly, and the division is a fact about the toolchain rather than a
judgement call:

- **The compiler's**: mutations that change a type. `OptionalChaining`
  is 16 of 16 here -- removing a `?.` on a possibly-undefined value is
  TS18048 every time.
- **The suite's**: mutations that are valid TypeScript with different
  behaviour. `BooleanLiteral` and `EqualityOperator` are 0 of 9
  rejected, which is what you would predict: flipping `true` to `false`
  type-checks perfectly.

## Should it run per-PR? (resolved: no -- on a schedule)

**No.** The full run over `src/diff` and `src/mapping` is 2,479 mutants
in 16m12s at concurrency 4, and the classification pass adds one `tsc`
run per survivor. Per-PR is out.

**On demand is also out, and that is the less obvious half.** A ratchet
nobody runs is a gate nobody pulls. Every mechanism this repository has
added over the last month exists because a check that depends on someone
remembering had already failed to fire: barwise-905, -906 (six
occurrences), -902, -910. Adding a baseline file that only fires when
invoked by hand would be that pattern with a JSON file attached.

So: a scheduled workflow, **weekly** (Open decision 2). A week of drift
is a few PRs to bisect; nightly buys little for seven times the runner
minutes on a sixteen-minute job.

**This repository has no scheduled workflow today** -- `ci.yml` and
`release.yml` are both event-driven -- so this introduces the first,
which is a cost worth naming rather than absorbing.

## Scope

In scope, as requirements:

- When the mutation harness runs, the system shall apply every surviving
  mutant to its source file and record whether `tsc --noEmit` rejects it.
- When a survivor is rejected by `tsc`, the system shall classify it
  `compiler` and exclude it from the suite-responsible score.
- When a suite-responsible survivor is present that has no entry in
  `mutation-baseline.json`, `--check` shall exit non-zero naming the
  mutant, its file, its line and its mutator kind.
- When a baseline entry names a mutant that no longer survives,
  `--check` shall exit non-zero naming it as stale.
- When the harness cannot resolve its inputs -- no Stryker report, no
  `tsc`, no repository root -- it shall exit `2` rather than report a
  score (`docs/specs/gate-refusal-contract.spec.md`).
- When the scheduled workflow completes with findings, the system shall
  make the result visible without failing an unrelated developer's push.

Out of scope:

- **Raising the mutation score.** This spec builds the instrument. The
  37 real survivors in `RelationalMapper.ts` are barwise-993's.
- **Extending beyond `src/diff` and `src/mapping`.** WS4, provisional.
- **Replacing the coverage floors.** Settled the other way in
  `test-quality.spec.md` WS5: they stay as a floor and never ratchet up.

## Inventory

| File                                      | Current state                                                  | Verdict                        |
| ----------------------------------------- | -------------------------------------------------------------- | ------------------------------ |
| `packages/core/stryker.conf.json`         | committed; ALREADY writes `reports/mutation/diff-mapping.json` | untouched unless OD 1 goes (a) |
| `packages/core/vitest.mutation.config.ts` | committed; exists because Stryker sandboxes the cwd            | untouched                      |
| `packages/core/reports/mutation/*.json`   | gitignored run output                                          | becomes the classifier input   |
| `scripts/audit-duplication.mjs`           | baseline + `--check`, fails on new AND stale entries           | the shape to copy              |
| `scripts/audit-rubric.mjs`                | same shape, second instance                                    | the shape to copy              |
| `scripts/mutate.mjs`                      | single textual mutation, backup and sha-verified restore       | NOT reused -- see below        |
| `scripts/lib/tracked.mjs`                 | `REPO_ROOT`, refuses on an unresolvable root                   | imported by the new script     |
| `.github/workflows/`                      | `ci.yml`, `release.yml`; no scheduled workflow                 | gains one (WS3)                |
| `barwise/package.json`                    | Stryker deliberately absent                                    | gains it in WS3, not before    |

**`mutate.mjs` is not reused, deliberately.** It plants one textual
mutation by anchor string and verifies the restore by SHA. The classifier
applies a mutant by line/column span from a Stryker report, 90+ times in
a loop, and needs no anchor because the report carries the location. The
overlap is "write, run, restore", which is three lines; sharing it would
couple a debugging instrument to a batch harness and bend one of them.
DRY is secondary here (CLAUDE.md), and the restore discipline is what
matters -- WS1 must carry its own, verified the same way.

## Target architecture

```
packages/core/reports/mutation/diff-mapping.json   (Stryker output, gitignored)
                     |
                     v
scripts/mutation-baseline.mjs                      (WS1 + WS2, no dependency)
   --classify   apply each survivor, run `tsc --noEmit`, emit verdicts
   --write      regenerate barwise/mutation-baseline.json
   --check      fail on a new unclassified survivor OR a stale entry
                     |
                     v
barwise/mutation-baseline.json
   { "$comment": ..., "survivors": {
       "<file>:<line>:<mutator>:<hash of replacement>": {
          "status": "compiler" | "tracked:<issue>" | "accepted-benign",
          "note": "..." } } }
                     |
                     v
.github/workflows/mutation.yml                     (WS3, scheduled)
   npm ci -> build -> stryker run -> mutation-baseline.mjs --check
```

The key is that `status: "compiler"` rows are **derived, not authored**:
`--write` sets them from the `tsc` verdict and `--check` re-derives them.
A human never types one, so the classification cannot drift from what the
compiler actually does. Only `tracked:` and `accepted-benign` carry human
judgement, and those are the rows that must shrink.

## What Stryker already provides (checked against the schema, not from memory)

**Two of this spec's three inventions already exist upstream, and one of
them was written here under the wrong name.** Read from
`stryker-core.json`, the published option schema:

| This spec proposed                          | Stryker ships                                                     |
| ------------------------------------------- | ----------------------------------------------------------------- |
| WS1: apply each mutant, run `tsc`, classify | **`checkers`** -- "validate that it won't result in a type error" |
| WS2: a file of prior results                | **`incremental`**, **`incrementalFile`**                          |
| OD3: a mutation-score floor (declined)      | **`thresholds.break`** (default `null`)                           |

The option is **`checkers`**, plural. Earlier drafts of this spec wrote
`checker`, which would have failed at the first run of WS1 -- a small
error, and a fair sample of what reasoning from memory about someone
else's tool produces.

**What this changes, and what it does not:**

- **WS1 is upstream's.** Confirmed by the option's own description. OD1
  already routes there; this is the evidence for it rather than a
  preference.
- **WS2 is not, and the distinction is worth stating precisely because
  the names look alike.** `incrementalFile` is _state for performance_:
  Stryker stores results so the next run can skip mutants nothing
  touched. A ratchet is _a reviewed, committed classification_: human
  verdicts (`tracked:<issue>`, `accepted-benign`), a note per row, and
  failure on a stale entry. The first is a cache Stryker owns and may
  reshape; the second is a document the repository owns and a reviewer
  reads. Building WS2 on the incremental file would couple a gate to a
  cache format with no compatibility promise.
- **`thresholds.break` means OD3 declines an available mechanism rather
  than an unbuilt one.** That strengthens the decision: the floor is one
  config line away and is still the wrong instrument, for the reason the
  measurement above gives.
- **Incremental mode may undercut this spec's cadence premise.** The
  "sixteen minutes, too slow for per-PR" argument assumes every run is a
  cold run. If `incremental` makes a warm run cheap, per-PR returns as a
  live option and OD2 should be re-decided rather than inherited. **WS3
  must measure a warm incremental run before accepting weekly as
  final.** Not verified here: the schema says the file exists and speeds
  the next run, and says nothing about how it behaves when source moves
  under it.

## Alternatives considered

- **A per-directory score floor, as barwise-994's acceptance criterion
  literally asks.** Loses to the measurement above: 79.91% is 11 points
  from the honest figure on the one file checked, and a floor invites
  raising the number by testing what the compiler already rejects. A
  floor may still ride alongside the classification -- Open decision 3.

- **Classify by mutator kind instead of by compiling each mutant.**
  Cheaper (no `tsc` runs) and wrong: `ConditionalExpression` splits 21/16
  and `StringLiteral` splits 3/4 within a single file. The kind does not
  determine the verdict; the type at the mutation site does.

- **Turn on Stryker's `checkers: ["typescript"]` and let it mark them
  `CompileError` itself.** The option most likely to be right, and the
  plugin is real: `@stryker-mutator/typescript-checker@9.6.1` exists and
  peer-depends on `@stryker-mutator/core: ~9.0.0` and `typescript >= 3.6`,
  both of which this repository satisfies. It would fold WS1 into
  configuration.

  It is **not** the free option it looks like. It is a third package on
  top of the two, so it does not avoid a dependency -- it trades a script
  this repository owns for a package it does not. And it type-checks per
  mutant, which is exactly what WS1 does by hand, so the run gets slower
  either way. What it buys is that Stryker reports `CompileError` as a
  first-class status, so the classification stops being ours to compute
  or to get wrong. **Open decision 1.**

- **Own the engine: batch `mutate.mjs` over a generated mutant list.**
  Rejected in `test-quality.spec.md` and still rejected. It means owning
  a worse mutation engine forever to avoid a devDependency, and the
  devDependency question is answerable on its own terms.

- **Run it per-PR over changed files only.** Attractive and unsound:
  a mutation score over a changed-file subset is not comparable
  run-to-run, so there is nothing to ratchet. It also cannot see a
  regression caused by deleting a test elsewhere.

## Workstreams (each independently shippable)

### 1. The classifier, with no new dependency

`scripts/mutation-baseline.mjs --classify` reads a committed Stryker JSON
report, applies each surviving mutant by span, runs `npx tsc --noEmit` in
the owning package, and prints the split. **No Stryker dependency**: the
report is an input, produced however the operator likes.

**First step, decided (Open decision 1):** install
`@stryker-mutator/typescript-checker@9.6.1` with `--no-save`, set
`checkers: ["typescript"]`, re-run, and compare against the 53/37 split
measured above. If it reproduces, this workstream becomes a report reader
and the rest of it is deleted before it is written. If it does not
reproduce, the discrepancy is itself the finding and belongs in this spec
before either path continues.

`--no-save` keeps the experiment reversible: WS1 proves which path is
right without committing the repository to either. Nothing enters
`package.json` before WS3.

Restore discipline is the acceptance risk, not the classification. The
harness writes to tracked source files in a loop. It must: read the
pristine text from `git show HEAD:<path>` rather than from disk, restore
after every single mutant, verify the tree is clean at the end, and
refuse (exit 2) if it is not. The prototype for this spec did exactly
that over 90 mutants and left the tree clean; that is the bar.

Acceptance: when run over the committed report for
`RelationalMapper.ts`, the system shall report 53 compiler-rejected and
37 suite-responsible survivors, and `git status --porcelain` shall be
empty afterwards.

### 2. The baseline and `--check`

`mutation-baseline.json` in the shape of `audit-baseline.json` and
`rubric-baseline.json`: a `$comment` stating what the file is, then one
entry per suite-responsible survivor with a `status` and a `note`.
`--check` fails on an unclassified survivor and on a stale entry, so the
file always enumerates exactly what is open.

The identity key is the risk. A line number moves when anything above it
is edited, so keying on `file:line` would invalidate the whole baseline
on an unrelated edit. **Provisional:** key on
`file:mutator:sha256(original span + replacement)`, which survives
line motion but not a rewrite of the mutated expression -- a rewrite
should invalidate the row, so that is the intended behaviour rather than
a limitation. Grounding this against a real edit is WS2's first step.

Acceptance: when a suite-responsible survivor has no baseline entry,
`--check` shall exit 1 naming file, line and mutator kind; when an entry
names a mutant that no longer survives, `--check` shall exit 1 naming it
stale.

### 3. The scheduled workflow, and the dependency (provisional: not yet grounded)

`.github/workflows/mutation.yml`, weekly, running `stryker run` then
`--check`. This is where `@stryker-mutator/core` and
`@stryker-mutator/vitest-runner` enter `package.json` -- 126 transitive
packages, locked and auditable, which
`test-quality.spec.md`'s Open decision 1 resolved in favour of on
2026-09-10 once the ratchet was going to be scheduled rather than manual.

**Nothing installs before this workstream.** WS1 and WS2 take the report
as an input and need no Stryker at all, which is what keeps the
dependency decision reversible right up to the point it is needed.

**Weekly** (Open decision 2). On a finding the workflow exits non-zero
and writes the survivor list to `$GITHUB_STEP_SUMMARY`, naming the
long-lived tracking issue this workstream creates by hand (Open decision
4). **The workflow does not commit to `.beads/issues.jsonl`** -- no
workflow here writes back to the repository, none declares
`permissions:`, and a scheduled automated writer would join the
id-allocation race barwise-984 just closed.

Three things this workstream must measure rather than assume: what a
cold run costs on a GitHub runner rather than this container; what a
**warm `incremental` run** costs, since a cheap one puts per-PR back on
the table and makes OD2's weekly answer worth re-deciding; and whether
`npm ci` installing 126 extra packages measurably slows every other CI
job -- which is the cost the devDependency actually imposes, and it has
not been measured.

### 4. Beyond `src/diff` and `src/mapping` (provisional: not yet grounded)

The current `mutate` glob covers two directories of one package because
that is where WS2 of `test-quality.spec.md` took its reading. Whether the
ratchet should widen, and to what, is a question for after it exists.
Widening multiplies a 16-minute run.

## Risks and testing

- **The harness writes to tracked source.** Highest risk in the spec. See
  WS1; a failure mode here corrupts a working tree rather than reporting
  a wrong number.
- **The 59% figure is one file.** `RelationalMapper.ts` is
  `ConditionalExpression`- and `OptionalChaining`-heavy;
  `elementDiff.ts` is `StringLiteral`-heavy (64 of its 130 survivors),
  and `StringLiteral` splits 3/4 here. The directory-wide split will
  differ and is not predicted by this reading.
- **Four `NoCoverage` mutants** sit in `RelationalMapper.ts` and are
  neither killed nor survived. They are a third category -- code no test
  reaches at all -- and the baseline should say which bucket they land
  in. Not yet decided.
- **Every refusal path verified red** via `npm run mutate`
  (assertion-audit rule 0), including the tree-dirty refusal.

## Open decisions (all resolved 2026-09-10)

1. **Use Stryker's own TypeScript checker instead of WS1? (resolved:
   try it first, gated on the split.)** The plugin is verified to exist
   at a matching version (`@stryker-mutator/typescript-checker@9.6.1`,
   peer `@stryker-mutator/core: ~9.0.0`).

   WS1 begins by installing it `--no-save`, setting
   `checkers: ["typescript"]`, and comparing Stryker's `CompileError`
   count against the **53 / 37** measured above. **Reproducing that
   split is the acceptance test, not "it runs"** -- a checker that marks
   a different set is making a different claim, and taking it on trust
   would replace a measurement with a configuration line. Reproduce and
   WS1 collapses to a report reader; diverge and the discrepancy is
   itself a finding that belongs in this spec before either path
   continues.

   Accepted cost: it is a **third** package, so this does not dodge the
   dependency question, and it moves the classification behind a version
   boundary this repository does not control. What it buys is that the
   status is Stryker's own, so it cannot drift from what Stryker's
   runner does.

2. **Cadence (resolved: weekly.)** See the scheduling section above.

3. **Does a numeric score floor ride alongside the classification?
   (resolved: no. Classification only.)** The number is the count of
   open `tracked:` rows, and it can only go down. No percentage is
   recorded and none is gated.

   This is the coverage-floor argument applied before the mistake
   instead of after: a percentage in a baseline file is a number to
   optimise, and the cheapest way to move it is the test that cannot
   fail. The row count has no such move -- the only way to remove a row
   is to kill the mutant.

4. **What does a scheduled finding do? (resolved: fail the workflow, and
   name one long-lived tracking issue. The run does NOT write to the
   tracker -- see the narrowing below.)**

   The workflow exits non-zero, which is the red badge, and writes its
   findings to `$GITHUB_STEP_SUMMARY` so the run page carries the list
   rather than making a reader open raw logs. It names a single
   long-lived beads issue, created by hand in WS3, as the durable home.

   **This is narrower than the option as chosen, deliberately, and the
   difference is worth a sentence.** The choice was for the run to
   update that issue. Grounding it found three costs the option did not
   show: no workflow in this repository writes back to the repository
   today, and none declares a `permissions:` block, so this would be the
   first to need `contents: write` and a bot identity; and a CI process
   committing to `.beads/issues.jsonl` on a schedule puts an automated
   writer into exactly the id-allocation race barwise-984 documents,
   weeks after closing it. One long-lived issue updated by a human costs
   a manual step; an automated writer costs a new class of tracker
   conflict.

   If the auto-write is wanted anyway, it is a separate decision with
   those three costs attached, and it should be its own workstream
   rather than a line in WS3.

5. **The four `NoCoverage` mutants (resolved: suite-responsible.)** No
   test reaches them, so that is the honest bucket, and it needs no new
   vocabulary. They enter the baseline like any other suite-responsible
   survivor.

## Non-goals

- Making the mutation score go up. That is barwise-993.
- A mutation gate on pull requests. Out on cost, permanently.
- Mutation testing outside `@barwise/core`.
