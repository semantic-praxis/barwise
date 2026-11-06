# The gate refusal contract, enforced: the fault matrix green, sharded, and wired

Status: Draft 2026-11-06; no workstream implemented
Created: 2026-11-06
Last-updated: 2026-11-06
Tracking: barwise-ym8.gc9 (adr-refactor batch 2), barwise-ym8.j31,
barwise-ym8.rl7, barwise-ym8.c42, barwise-ym8.aep, barwise-ym8.if3,
barwise-ydl, barwise-shq, barwise-w43, barwise-vt2, barwise-1049
Touches: barwise/scripts/fault-matrix.mjs, barwise/scripts/check-tracker-closes.mjs,
barwise/scripts/test-adr-model.mjs, barwise/scripts/run-script-tests.mjs,
barwise/scripts/check-depcruise-gate.mjs, barwise/scripts/audit-rubric.mjs,
barwise/scripts/ci-local.mjs, barwise/scripts/lib/ci-gates.mjs, barwise/scripts/tests/,
.husky/pre-commit, .github/workflows/ci.yml, barwise/package.json, package.json,
barwise/docs/adr/gate-refusal-contract.md, barwise/docs/adr/probes.json,
barwise/docs/ARCHITECTURE.md

## Principle

`docs/adr/gate-refusal-contract.md` makes five promises about every gate:
three results, a refusal never on the finding code, the same reading from
any working directory, readers that keep the third value, and no writes
to the tree. The instrument that measures four of them exists
(`npm run fault-matrix`) and finds real breaks, but it runs only when
someone remembers, so the next gate added is under the contract only by
luck. All five decisions carry gap issues for that reason. The rule from
CLAUDE.md applies to the contract itself: look at the shadow, ratchet on
the property. A gate's green run in CI is the shadow; the property is
that the gate would have answered differently had its input been
missing. The matrix is the instrument for the property, so it belongs
where a regression would be seen, which is CI.

## The reading this spec starts from (2026-11-06, main at 0b585f1e)

`npm run fault-matrix` on main: 29 node gates, 4 axes, 116 readings,
**746 seconds**, exit 1 with four findings and no unreadable rows:

| Gate                       | Axis        | Reading                           | Cause                                                                                 |
| -------------------------- | ----------- | --------------------------------- | ------------------------------------------------------------------------------------- |
| `check-tracker-closes.mjs` | git-empty   | FALSE GREEN (exit 0, 4 git calls) | an empty merge-base and an empty tracker read as a clean diff (barwise-ydl)           |
| `test-adr-model.mjs`       | git-empty   | CRASHED (exit 1, 7 git calls)     | its cases read git; a case failing because git is broken is reported as a failed case |
| `test-adr-model.mjs`       | git-absent  | CRASHED (exit 1, 1 git call)      | the same                                                                              |
| `run-script-tests.mjs`     | git-shallow | CRASHED (exit 1, 31 git calls)    | cases that read history fail on a shallow clone and are reported as failures          |

A CI run on this repository takes about three and a half minutes, so the
matrix as it stands would quadruple it. Three further breaks are known
from reading the code and are outside the matrix's reach today:
`check-depcruise-gate` writes a probe into `packages/core/src` and
removes it in a `finally` (barwise-w43); `audit-rubric` and
`check-depcruise-gate` exit 1 on a missing input (barwise-shq; the
matrix reads `audit-rubric` as INDEPENDENT because its input exists in
this checkout); `npm run depcruise` exits with its violation count, so
two violations read as a refusal (barwise-vt2).

## Should the matrix run in CI at all? (adr-refactor open decision 2)

`gate-refusal-contract.spec.md` decided no, on cost, when the matrix was
new. The cost is now measured (746 seconds) and so is the price of not
running it: four live breaks, three of them found only by this reading.
Three options:

- **A. Every pull request, whole.** Holds every decision on every change,
  and adds about twelve minutes of wall time. Rejected on cost: most pull
  requests touch no gate.
- **B. On a schedule.** Cheap, and a regression is found days after the
  pull request that caused it, by nobody in particular. Rejected: a
  scheduled red is a finding with no owner, which the findings ADR exists
  to prevent.
- **C. Sharded, on the pull requests that can change a gate, and on every
  push to `main`.** The matrix gains `--shard <i>/<n>` (gates assigned by
  a stable order, so a shard is reproducible), and CI runs four shards in
  parallel jobs, each about three minutes, when the change classifier
  (`scripts/lib/changed-class.mjs`) says the diff touches `scripts/`,
  `trial/lib/`, `ci.yml`, `package.json` or the hooks; a push to `main`
  runs all four regardless, so a gate broken by something the classifier
  did not route is caught on the next merge. **Recommended.**

C adds no wall time to a pull request that touches no gate, and about
three minutes in parallel to one that does.

## Scope

In scope:

- the four findings and the three known breaks above, fixed so the
  matrix is green on main before it gates anything;
- `--shard`, and the CI wiring of option C;
- the axes the contract names and the matrix lacks: a missing tool, a
  missing manifest or lockfile, and a write undone before exit;
- the `readers-keep-third` cases the gap issue lists: `ci:local` over a
  mixed failing and refusing run, the pre-commit hook over a
  `check:secrets` refusal, and the skip rule;
- the partition of `ci.yml`'s npm steps into "in the matrix" and "a
  declared exception, with its reason", pinned by a test, so a new step is
  one or the other.

Out of scope:

- third-party tools' own exit codes (`vitest`, `tsc`, `eslint`, turbo):
  the ADR's Consequences already except them, and only a wrapper can
  refuse on their behalf;
- the wrong-Node-major axis in CI (it needs a second interpreter; it
  stays on demand behind `--node`);
- the trial gate (barwise-e0q), which no CI job runs (batch 4's
  barwise-ym8.ld2).

## Target architecture

- `fault-matrix.mjs` keeps its classifier and gains three things: shards,
  two axes and a watch.
  - **Shards.** `--shard i/n` takes the gates in `ciGates()` order and
    keeps every n-th starting at i. The report names the shard, and a
    shard with no gates refuses (exit 2), so a miscounted `n` cannot pass
    empty.
  - **Missing-tool axis.** The gate runs with `PATH` reduced to node's
    own directory and a shim directory that holds `git`; any other tool
    the gate spawns is then absent. A gate that exits 0 having spawned a
    missing tool is a false green, read the way the git shim reads git
    calls: the shim directory logs every name the gate looked up.
  - **Manifest axis.** The gate runs in an exported copy of the tree
    (`git archive HEAD`, with `node_modules` linked) with one of
    `package.json`, `package-lock.json` or `uv.lock` removed per run. It
    reads, never writes, the real tree.
  - **Write watch.** A recursive `fs.watch` on the repository for the
    length of each gate run, so a write undone before exit is seen; any
    event under a tracked path is a finding (`no-writes`).
- `ci.yml` gains a `fault-matrix` job with a four-way shard matrix, gated
  on the classifier's new `gates` output or on `push` to `main`.
- `scripts/lib/ci-gates.mjs` gains `MATRIX_EXCEPTIONS`: each `ci.yml`
  npm step the matrix cannot reach, with its reason. A test fails on a
  step that is in neither.

## Alternatives considered

- **Per-gate unit tests instead of a matrix.** `gates.test.mjs` already
  pins the git refusal for ten gates by hand. That list is the must-agree
  copy the matrix exists to remove: it covers ten of twenty-nine, and a
  new gate joins it only if its author remembers.
- **A test-runner refusal convention instead of fixing each runner.**
  `test-adr-model` and `run-script-tests` fail because their cases read
  git. Each can check its preconditions once before running (git
  answers; history is complete) and refuse. Chosen over a per-case
  convention because the precondition is the runner's, and two runners
  are the whole population.

## Workstreams (each independently shippable)

### 1. The matrix green on main

Fix the four findings and the three known breaks, each red first under
the matrix or a planted test: `check-tracker-closes` refuses an empty
base and an empty tracker read (barwise-ydl); `test-adr-model` and
`run-script-tests` check their preconditions and refuse;
`check-depcruise-gate` writes its probe outside the tree (barwise-w43);
`audit-rubric` and `check-depcruise-gate` refuse a missing input
(barwise-shq); `ci:local` reads depcruise's count as a finding
(barwise-vt2). Exit: `npm run fault-matrix` exits 0 on main.

### 2. Shards and CI (provisional: waits on open decision 1)

`--shard`, the classifier output, the `ci.yml` job, and the ADR's
`Enforced-by:` naming the matrix for `three-results`, `refuse-not-find`
and `cwd-invariant`, with a probe per decision in `probes.json`.

### 3. The missing axes (provisional: not yet grounded)

The missing-tool and manifest axes and the write watch, with
`no-writes` declared enforced once the watch is in CI.

### 4. Readers keep the third value (provisional: not yet grounded)

The three `readers-keep-third` cases, tagged
`[adr:gate-refusal-contract#readers-keep-third]`.

### 5. Every step accounted for (provisional: not yet grounded)

`MATRIX_EXCEPTIONS` and its test.

## Open decisions (for review)

1. **Option C for CI.** Recommended above; the owner decides, because it
   changes CI, and WS2 waits for the answer. The alternative is A if
   twelve minutes on gate-touching pull requests is acceptable, which
   removes the classifier dependency.
2. **Four shards.** Recommended as the smallest count that brings a shard
   under a CI run's length (746 / 4 is about 190 seconds). More shards
   cost a runner each.
3. **Whether `test:scripts` stays in the matrix.** It is a runner of
   gate tests, and its shallow-clone reading is about its cases, not
   about it. Recommended: keep it, with the precondition check of WS1,
   because a test runner that crashes on a shallow clone is a reader that
   loses the third value.

## Risks and testing

- The write watch can fire on files the gate legitimately writes outside
  the tree's tracked paths (a cache under `node_modules`). Only events
  under tracked paths count, which `trackedFiles()` already answers.
- `fs.watch` with `recursive` is Linux-supported from Node 20; the pinned
  Node is newer. On a platform without it the watch refuses rather than
  reading clean.
- `ci:local` derives its gate list from `ci.yml` through `ciSteps()`
  and applies `if:` conditions with the same classifier (`shouldRun`).
  The new job and the classifier's `gates` output must reach it too, or
  the pre-push run and CI disagree about whether the matrix ran; WS2's
  tests cover `shouldRun` on the new condition.
- Every fix in WS1 lands with the matrix reading it red first, and every
  new axis with a planted gate that the axis catches and a conforming one
  it passes.

## Non-goals

- Changing what any gate checks. Only how it answers when it cannot see
  its input.
- A random fault generator. The matrix's header says why enumeration is
  the right instrument here.
