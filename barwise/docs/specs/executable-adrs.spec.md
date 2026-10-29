# Executable ADRs: each ADR declares what enforces it, and CI checks the declaration

Status: Draft -- no workstream implemented

Created: 2026-10-28
Last-updated: 2026-10-29
Tracking: barwise-ym8
Touches: barwise/scripts/check-architecture.mjs,
barwise/scripts/lib/architecture-section.mjs,
+barwise/scripts/lib/adr-enforcement.mjs, barwise/scripts/lib/ci-gates.mjs,
+barwise/scripts/check-adr-tests.mjs, +barwise/scripts/lib/test-tag-reporter.mjs,
barwise/scripts/run-script-tests.mjs, barwise/vitest.shared.ts,
barwise/turbo.json, barwise/.gitignore, barwise/package.json, package.json,
.github/workflows/ci.yml, barwise/scripts/mutate.mjs,
barwise/scripts/tests/, barwise/docs/adr/, barwise/docs/ARCHITECTURE.md,
.claude/skills/spec-writer/template.adr.md

In one sentence: every ADR carries an `Enforced-by:` header that accounts
for each of its numbered decisions -- a CI gate, tests tagged with the
decision, or `none` with an open issue; `check:architecture` checks the
declarations against the repository, and a new `check:adr-tests` step
checks, from the test runners' own reports, that a tagged test for each
declared decision ran and passed in CI.

## Principle

Explicit over implicit, and findings close by mechanism
(`docs/adr/findings-close-by-mechanism.md`). Almost every ADR already
names its enforcer, but only in Consequences prose, which no tool reads.
So the claim "this decision is enforced by `npm run purity`" survives
the gate being renamed, deleted, or dropped from `ci.yml`, and the ADR
goes on describing a system that no longer exists. That is the silent
decay the ADR convention was meant to end, moved one level down: the
decision text is checked (`check:architecture` validates each ADR's
shape and every reference to it), and the link from decision to enforcer
is not.

The idea comes from the Aver language, which makes decisions a parse
node its tooling can index rather than prose it cannot see
(`aver context --decisions-only`). Aver's records list the components a
decision impacts, and, as far as its published decisions document shows,
nothing checks those names against the code. This spec takes Aver's half
-- the decision is data the tooling reads -- and adds the half it lacks:
the enforcer named in that data is verified to exist and run.

## Ask the runner, not the text (resolved: yes)

The design turns on one choice: where the evidence that an enforcer runs
comes from. For a CI gate, the evidence is `ci.yml`, which is small,
declarative and already parsed by `scripts/lib/ci-gates.mjs`. For tests
and hooks, an earlier version of this spec read the source text and
predicted what would run: which files a vitest include matches, whether
a test is skipped by a modifier on it or on an enclosing suite, which
title a selector names, whether a husky line can fail its hook. Twelve
review rounds each found new ways to write a test or hook that those
rules misjudged, and fixes to one rule opened holes in another
(Alternatives considered, first entry).

The runners already know the answer. Vitest and `node --test` each
report every test they executed and its status. So a test declares the
decision it pins by a tag in its own title, `[adr:<adr-name>#<n>]`, and
the check reads the runners' reports: a decision declared as tested is
enforced when a test carrying its tag ran and passed in CI. Skips,
conditional suites, loop-built titles, include globs and comments that
look like tests stop mattering, because they never reach a report as a
passed test. Hooks are declared the same way: a tagged test that runs
the hook, or asserts the one wiring that hook depends on, is the
evidence, not a grammar for hooks.

## What does "executable" buy, and what does it not? (resolved: existence and execution, not discrimination)

For a CI gate the check proves the gate exists and runs in CI; for a
tested decision it proves a tagged test ran and passed. Neither proves
the enforcer would fail on a violation of the decision. In root
`CLAUDE.md`'s terms, a gate that runs is the shadow; a gate that goes
red when the decision is broken is the property. This spec ratchets on
what can be checked cheaply on every PR, and puts the property in
workstream 5, an on-demand probe in the shape of `npm run fault-matrix`.
Gating CI on the shadow alone is safe because it is not used as evidence
that an ADR is respected; it only stops an ADR claiming an enforcer that
is gone. The index (WS4) keeps to that: it labels its list `declared`.

Two preconditions sit under even the shadow. A red check blocks a merge
only if `main` requires the `ci` check, which is unsettled (barwise-raw;
`docs/adr/merge-delegation.md` says so). And most gates are guarded by
`docs_only != 'true'`, while `scripts/lib/changed-class.mjs` counts every
`.md` file and everything under `.beads/` as docs-only, so a process
decision a docs-only change can break is not enforced, on that change, by
a guarded gate. The index's section header states both once; WS3's audit
files a `none` issue for any decision whose only enforcer skips the
changes that could violate it.

## Does every unguarded decision get an issue? (resolved: yes)

Resolved by the owner on 2026-10-28: a decision that is unenforceable
as written is filed for follow-up, not marked exempt. The follow-up
issue asks for one of three outcomes: build an enforcer; restate the
decision so a check can see it (often by naming the artifact a violation
would leave); or, if neither is possible, retire it from the ADR into
prose guidance, where it no longer claims the force of a decision. Any of
the three removes the `none` entry, and the issue then closes in the
order Scope gives.

## Scope

In scope, `check:architecture` (static; runs early in CI, unguarded):

- When an ADR under `barwise/docs/adr/` has no `Enforced-by:` header, or
  one whose value parses to zero entries, the check shall exit 1 naming
  the file (from WS3 on; WS1 allows an absent header).
- When an ADR's `## Decision` section has a numbered decision that no
  entry lists, or an entry lists a number the section does not have, the
  check shall exit 1 naming the ADR and the number. Every ADR numbers its
  decisions today (three to six each). This makes "each decision is
  accounted for" a property the check holds, not a rule the audit must
  remember.
- When an entry is `npm run <script>[ -- <args>] (<decisions>)`, the
  check shall exit 1 unless all of these hold:
  - `<script>` is a key of `barwise/package.json` `scripts` and is named
    `check:*` or `audit:*`, or is on the exception list in
    `adr-enforcement.mjs` (`purity`, `depcruise`, each with its reason).
    Gate scripts are named that way already; test runners (`test:*`),
    `build`, `lint` and `ci:local` are excluded by the name, with no
    hand-kept list of umbrellas to fall behind.
  - Some step occurrence in `.github/workflows/ci.yml` has a `run:` value
    exactly equal to `npm run <script>`, or `npm run <script> -- <args>`.
    String equality, after trimming: a step written any other way (flags,
    a quoted value, a trailing comment, a shell operator) does not match,
    and the fix is to write the gate's step canonically. This replaces a
    tokenizer the earlier design needed and repeatedly got wrong. The
    arguments are part of the match because they can be what makes a
    step a gate: `audit:specs` fails CI only under `-- --check`.
  - That occurrence runs in `barwise` (its `working-directory:`, else its
    job's `defaults.run.working-directory`), is not
    `continue-on-error: true` at step or job level, and has an `if:`
    (step and job combined) that `shouldRun()` in `ci-gates.mjs`
    understands and that runs the step on a code change: with
    `docsOnly: false`, `run` is true for `optimizer: true` or
    `optimizer: false`. An inverted or contradictory guard is understood
    and never runs, so it does not count.
    If the only occurrences with the exact `run:` value have an `if:`
    `shouldRun()` does not understand, or a `continue-on-error` that is an
    expression, the check exits 2 for that entry: it cannot tell. Nothing
    about any other step affects the entry.
- WS1 extends `ci-gates.mjs` with `ciStepOccurrences()`: every step, not
  deduplicated, with its raw `run:` value, its combined `condition`, its
  `continueOnError` and its working directory, tracking jobs (today's
  `ciSteps()` reads every line after the first `steps:` as one job).
  `ciSteps()` keeps its shape and is derived from it, so `ci:local`,
  `fault-matrix` and `scripts/tests/ci-conditions.test.mjs` see no
  change. (`ci:local` running `continue-on-error` steps as blocking is
  barwise-4vj, separate.)
- When an entry is `tests (<decisions>)`, the check shall exit 1 unless,
  for each listed decision `<n>`, some tracked file matched by the test
  suites' discovery contains the literal tag `[adr:<this-adr>#<n>]`. This
  is a presence check only, cheap and run on every PR, docs-only ones
  included; `check:adr-tests` below holds the real evidence.
- When any tracked test file contains a tag `[adr:<name>#<n>]` naming an
  ADR that does not exist, or a decision that ADR does not number, the
  check shall exit 1: a tag that outlives its decision is the same drift
  in the other direction.
- When an entry is `none (<issue-id>: <decisions>)`, the check shall exit
  1 unless the issue exists in `.beads/issues.jsonl`, read with
  `parseTracker()` from `scripts/lib/beads-merge.mjs`, and is not closed.
  Each `none` names a gap issue, never an umbrella that can close for
  unrelated reasons. The order that keeps CI green: the PR that builds an
  enforcer replaces the `none` entry, and the gap issue closes afterwards
  in a tracker-only PR, as `check:tracker-closes` requires.
- When an input the check needs (`ci.yml`, `barwise/package.json`, the
  tracker) cannot be read, it shall exit 2. Inputs are read under
  `--root`, and only when an entry needs them. The enforcement pass runs
  after the graph and ADR-shape passes in its own `try`, so a refusal
  there never hides their findings.

In scope, `check:adr-tests` (new; runs in CI after the test steps):

- When CI's test steps have run, `check:adr-tests` shall read the reports
  they wrote and, for each `tests (<decisions>)` entry, exit 1 unless a
  test whose own title carries `[adr:<adr>#<n>]` has status passed for
  each listed `<n>`. A tagged test that was skipped, marked todo, or did
  not run does not count; a failed one has already failed its suite's
  step.
- When an expected report is missing, the check shall exit 2. The
  expected set is derived, not listed: one vitest report per package
  whose `package.json` defines `test:coverage`; one per file in
  `scripts/tests/expected-counts.json`, the manifest
  `run-script-tests.mjs` already keeps; and one for `test:trial`. A suite
  that silently produced no report cannot read as a pass.
- Reports are written by the runners:
  - vitest: `barwiseVitestConfig()` in `barwise/vitest.shared.ts` adds
    the built-in `json` reporter beside `default`, writing
    `test-results/vitest.json` in the package. `turbo.json` adds
    `test-results/**` to `test:coverage`'s `outputs`, so a turbo cache
    hit restores the report rather than leaving none.
  - `node --test`: a small reporter, `scripts/lib/test-tag-reporter.mjs`,
    writes one JSON line per finished test (`name`, `file`, and whether
    it passed, skipped or was todo). `run-script-tests.mjs` passes it as
    a second `--test-reporter` with its own destination beside the
    existing `tap` one (its comment records why reporters must be paired
    with destinations), and the `test:trial` script does the same.
  - Report directories are gitignored.
- The step is `- run: npm run check:adr-tests`, after `test:coverage` in
  `ci.yml`, with the same `docs_only` guard as the test steps it reads.
  On a docs-only PR the tests do not run, and the static presence check
  above still holds the declaration.

Out of scope:

- Rewriting Consequences prose (see "Decisions resolved in review").
- pytest (`test:optimizer`). A decision only pytest pins gets a `none`
  issue to make it declarable.
- Proving discrimination on every PR (WS5 is on demand).

## Inventory

Grounded 2026-10-28 by extracting the npm scripts each ADR names and
resolving them against `package.json` and `ciSteps()`. The third column
counts lines in each ADR matching phrases such as "no gate",
"review-only", "not built", "nothing enforces" and "by design". It is a
shadow, not a census: it shows where unguarded decisions are likely, and
WS3 reads each decision to find them. This spec does not predict each
ADR's declared state; an earlier draft did, marked most rows
"enforced", and was wrong for most of them.

| ADR                            | Enforcers named in prose today                                                  | Gap phrases in its Consequences |
| ------------------------------ | ------------------------------------------------------------------------------- | ------------------------------- |
| `baselines-merge-on-write`     | `audit:specs`, `test:scripts`                                                   | 2                               |
| `connector-packages`           | `purity`, `depcruise`                                                           | 4                               |
| `constraint-coverage-policy`   | none                                                                            | 0                               |
| `credential-handling`          | `check:secrets`, gitleaks pre-commit hook                                       | 2                               |
| `determinism-in-core`          | `purity`                                                                        | 0                               |
| `findings-close-by-mechanism`  | `audit:specs`, `audit:duplication`, `audit:corrections`, others                 | 3                               |
| `gate-refusal-contract`        | `test:scripts`, `test:coverage`; `fault-matrix` is on demand                    | 1                               |
| `keyless-model-access`         | `test:coverage`, `depcruise`                                                    | 1                               |
| `merge-delegation`             | none; the ADR says so (barwise-zdd)                                             | 1                               |
| `metamodel-evolution-policy`   | none                                                                            | 1                               |
| `must-agree-copies`            | `check:parity`, `audit:duplication`                                             | 0                               |
| `ossie-interchange`            | `test:coverage`; decision 5 not built (barwise-wcg), 6 has no gate              | 4                               |
| `package-graph-authority`      | `check:architecture`, `depcruise`                                               | 0                               |
| `pinned-runtimes`              | `check:parity`, `test:coverage`; `check:pins` proposed, not built (barwise-920) | 5                               |
| `plan-before-code`             | `check:plan-review`, `check:spec-touches`                                       | 2                               |
| `production-prompt-resolution` | `test:coverage`                                                                 | 1                               |
| `python-from-the-lockfile`     | `check:python-uv`, PreToolUse hook; `audit:skips` deferred                      | 3                               |
| `review-policy`                | `check:review-tiers`                                                            | 4                               |
| `schema-versioning`            | `test:coverage`                                                                 | 2                               |
| `surface-capability-parity`    | `test:coverage` (the two `toEqual` tool-list tests)                             | 2                               |

What this shows:

- Most CI gates the ADRs name are already `check:*`, `audit:*`,
  `purity` or `depcruise`, written as plain `npm run` steps, so they
  declare as they stand. `ci:local`, `fault-matrix`, `mutate`,
  `plan-scope`, `pr:risk`, `prepare`, `regen:builtins` and `trial:gate`
  are local tools, not CI enforcers, and `dup` runs only with
  `continue-on-error`.
- Every `test:coverage` and `test:scripts` citation becomes
  `tests (<n>)`, with tags added to the tests that pin the decision. That
  is new work in WS3: today no test carries a tag.
- The two hook-held decisions (credential-handling's pre-commit scan,
  python-from-the-lockfile's PreToolUse guard) become `tests (<n>)` on a
  tagged test that runs the hook. `scripts/tests/python-uv-guard.test.mjs`
  already exercises the guard, and `scripts/tests/beads-merge.test.mjs`
  already runs the real husky hooks, so the pattern exists. Where no such
  test exists, WS3 writes one or files a `none` issue.
- Two named checks do not exist (`check:pins`, `audit:skips`); each
  becomes a `none` entry on a gap issue opened as a child of the umbrella
  that proposed it (barwise-920, barwise-921).

Looks affected, is not: `header()` in `scripts/lib/spec-reader.mjs` keeps
reading `Scope:`, `Date:` and `Tracking:`. `Enforced-by:` is read by
`parseEnforcedBy()` instead (Risks).

## Target architecture

```
barwise/docs/adr/<concern>.md
  Scope: architecture
  Date: 2026-10-24
  Tracking: ...
  Enforced-by: npm run purity (1, 2, 4), tests (3), none (barwise-k3x: 5)

tests anywhere a suite discovers them
  test("refuses Date.now() in core [adr:determinism-in-core#3]", ...)

barwise/scripts/lib/adr-enforcement.mjs       (new)
  parseEnforcedBy(text)  -> { entries, problems }; never throws
  splitEntries(value)    -- comma split outside parentheses
  GATE_EXCEPTIONS        -- purity, depcruise, each with its reason
  TAG                    -- /\[adr:([a-z0-9-]+)#(\d+)\]/

barwise/scripts/check-architecture.mjs        (existing; one new pass)
  declarations: header shape, decision coverage, npm wiring, tag
  presence, stale tags, none issues
       uses ciStepOccurrences(), shouldRun()  from scripts/lib/ci-gates.mjs
       uses parseTracker()                    from scripts/lib/beads-merge.mjs

barwise/scripts/check-adr-tests.mjs           (new; CI step after tests)
  reads  packages/<pkg>/test-results/vitest.json   (vitest json reporter)
         test-results/script-tests/<file>.jsonl    (test-tag-reporter)
         test-results/trial.jsonl                  (test-tag-reporter)
  exit 0 / 1 a declared decision has no passing tagged test / 2 a report
  is missing or unreadable

barwise/scripts/lib/architecture-section.mjs  (renderSection; pure, ADR text only)
  - [Determinism in core](adr/determinism-in-core.md) -- 2026-10-24 -- declared: purity (1, 2, 4); tests (3); gap: barwise-k3x (5)
```

Entry grammar. `Enforced-by:` is the last field of the header block and
runs to the blank line that ends it. Entries are separated by commas
outside parentheses, so the decision list `(1, 2, 4)` stays one entry.
A newline is read as a space; every entry must match its form exactly,
so a dropped comma leaves a token over and is a finding. An `<issue-id>`
is `barwise-` then `[a-z0-9]+(\.[a-z0-9]+)*` (`beads-crud create
--parent` mints `barwise-920.k3x`). `<decisions>` is one or more decision
numbers, comma-separated.

```
npm run <script> (<decisions>)
npm run <script> -- <args> (<decisions>)
tests (<decisions>)
none (<issue-id>: <decisions>)
```

Rendering (WS4) uses only the ADR text, so the index never reads
`ci.yml` or the tracker: `declared: ` and the enforcers in order, each
with its decisions, then `; gap: <issue-id> (<decisions>)` for each
`none`. An ADR with no header renders as today.

## Alternatives considered

- **Read the source text to decide what runs** (this spec, through twelve
  review rounds on 2026-10-28 and 10-29). Entries named test files with
  title selectors, husky lines and Claude settings hooks, and the check
  predicted from source whether each would execute: vitest include globs
  through `picomatch`, skip modifiers on a test and on enclosing suites,
  title prefixes for loop-built tests, whitelisted shapes for a husky
  line that cannot discard its status, npm flag tokenization in CI
  steps. Each round found ways to write a test, hook or step that the
  rules misjudged in a direction that let a broken enforcer pass, and the
  last round's blocking findings were mostly caused by the previous
  round's fixes. It lost because it re-implements, as approximations, what
  the runners already know exactly.
- **Decisions as structured data (YAML or a front-matter block), as
  Aver does in its own language.** Every field machine-read, not just the
  enforcer. It lost because it rewrites twenty ADRs and the tools that
  read them for a gain only the enforcer field needs today.
- **Infer the enforcer from Consequences prose.** It needs no new field,
  but it is the inference "explicit over implicit" refuses: it cannot
  tell a gate the ADR relies on from one it mentions in passing
  (`ci:local`, named in seven ADRs, enforces none of them).
- **Map ADRs to enforcers only from the enforcer side.** Tags do this for
  tests, and the header still lists `tests (<n>)` because an ADR with no
  enforcer needs somewhere to say so, and "which decisions are
  unguarded" is the question this spec most needs to answer.

## Workstreams

WS1 and WS2 are independent; WS3 needs both; WS4 needs WS1.

### 1. Declarations in `check:architecture`, with an absent header allowed

Add `scripts/lib/adr-enforcement.mjs`, `ciStepOccurrences()` in
`ci-gates.mjs`, and the declaration pass in `check-architecture.mjs`. An
ADR with no header is not yet a finding, so this lands green before any
ADR changes. Tests in `scripts/tests/gates.test.mjs` beside the existing
`check-architecture` cases cover each entry kind's pass and fail, decision
coverage, a non-canonical step (fail), `if: false` (refuse), an inverted
guard (fail), job-level `continue-on-error` (fail), a stale tag (fail), a
closed issue (fail) and the exit-2 refusals, asserting exit codes
directly; and `ciStepOccurrences()` cases in
`scripts/tests/ci-conditions.test.mjs`. WS1 updates
`scripts/tests/expected-counts.json` (`npm run test:scripts -- --write`).

### 2. Test reports and `check:adr-tests` (provisional: report formats not yet grounded)

Add the vitest `json` reporter in `vitest.shared.ts`, `test-results/**`
to `turbo.json`'s `test:coverage` outputs, `scripts/lib/test-tag-reporter.mjs`
wired into `run-script-tests.mjs` and the `test:trial` script, the
gitignore entries, `scripts/check-adr-tests.mjs`, its npm script and
generated root forwarder, and its `ci.yml` step. Before building, ground
the vitest 5.0.1 json report's shape (the field holding a test's own
title and its status values) and the Node 26 test-runner event fields
the reporter reads; this spec has not run either. Tests feed
`check-adr-tests.mjs` fixture reports, including a missing package
report (refuse), a skipped tagged test (does not count) and a tag in a
`describe` title only (does not count: the tag must be in the test's own
title).

### 3. Audit and backfill the ADRs, then require the header

For each ADR, read every numbered decision and its Consequences, and give
each decision an entry: a gate, `tests` with the tags added to the tests
that pin it, or `none` on its own follow-up issue. Hook-held decisions get
a tagged test that runs the hook, or a `none` issue to write one. Where
the real enforcer has no form here (another workflow such as
`copilot-review.yml`, a multi-line `run: |` step), record `none` on an
issue to make it declarable rather than declaring a proxy test. Lands as
several PRs, a few ADRs each, while an absent header is still allowed.

The first WS3 PR also changes `architectureRepo()` in `gates.test.mjs`,
which copies every real ADR into its fixture: it rewrites each copied
ADR's `Enforced-by:` to one synthetic `none (barwise-fx1: <every
decision number the ADR has>)` and writes a one-line tracker holding that
open issue, so graph and shape cases stay independent of the live
tracker and `ci.yml`. If WS4 has landed, it regenerates the section after
the rewrite, as `stageAdr()` already does. The last WS3 PR makes an
absent header a finding and updates `template.adr.md`, with the field
last in the header block.

### 4. Show enforcement in the generated index

Extend `renderSection` per the rendering rule, reading entries through
`parseEnforcedBy()`, and regenerate `ARCHITECTURE.md`.

### 5. Discrimination probes (provisional: not yet grounded)

For an ADR whose decision has a concrete violation, record one probe --
a file, a planted edit and the gate expected to go red -- and run it with
`scripts/mutate.mjs`, after adding an expected-exit option to it (today
it counts any non-zero exit as caught, so a refusal would pass as
discrimination). An on-demand script runs every probe, under a new npm
script and its root forwarder. Ungrounded: where probes live, and whether
process ADRs admit a plantable violation at all.

## API and migration impact

- No package's public API changes. `vitest.shared.ts` gains a reporter,
  which changes every package's test output directory, not its results.
- Test titles gain tags in WS3. Nothing keys on test titles today except
  people reading output; `expected-counts.json` counts tests, not names.
- New: one CI step (`check:adr-tests`), one npm script and its root
  forwarder.

## Decisions resolved in review

Resolved by the owner on 2026-10-28, each as recommended, and revisited
where the redesign of 2026-10-29 changed its basis.

- **Extend `check:architecture`, or a new script? (resolved: both, by
  necessity)** The declaration checks extend `check:architecture`, as
  decided. The run evidence cannot: `check:architecture` runs at line 152
  of `ci.yml`, before any test step, and the reports exist only after
  `test:coverage` (line 486). So it is a separate step, `check:adr-tests`,
  which also keeps the graph gate free of any dependency on test output.
- **Does the header duplicate Consequences? (resolved: keep both)** The
  prose explains what a gate covers and where it does not, which a list
  cannot.
- **Do tests earn a place in the grammar? (resolved: yes, as tagged
  tests)** The 2026-10-28 answer allowed test files by path; the redesign
  replaces paths with tags, for the reasons in "Ask the runner, not the
  text".

## Risks and testing

- No check passes vacuously: zero ADRs, zero `ci.yml` steps, an empty
  tracker, or a missing expected report is exit 2, never 0.
- `header()` ends a value at any line starting `Word: `, which could cut
  a wrapped `Enforced-by:` short and drop later entries silently. So the
  field must be last, `parseEnforcedBy()` reads it to the blank line, and
  any `Word: ` line in that span is a finding.
- A local `npm run check:adr-tests` can read reports from an earlier run.
  `ci:local` runs in a fresh worktree and CI on a fresh runner, so the
  gate itself never does; the turbo cache restores vitest reports only
  for unchanged inputs, which is the same result a re-run would give.
- Tags are text in titles, so a tag can be added to a test that does not
  pin its decision. That is the shadow again; review and WS5 are the
  answer, not this check.

## Non-goals

- No change to what any ADR decides.
- No new gate for an unenforced decision; building one is its issue's
  work.
- No claim that a declared enforcer catches violations; that is WS5.
