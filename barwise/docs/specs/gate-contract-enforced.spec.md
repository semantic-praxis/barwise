# The gate refusal contract, enforced: the fault matrix green and in CI

Status: WS1 under way 2026-11-06 (barwise-ydl fixed: check-tracker-closes refuses an empty merge-base and an empty tracker read; check-tracker-closes refuses a close whose diff omits the tracker; test-adr-model refuses when git cannot answer; the shallow-clone cases of test:scripts skip, and the matrix shim answers only for the repository under test; audit-rubric and check-depcruise-gate refuse a missing input, barwise-shq; npm run depcruise exits by its violation count, barwise-vt2); WS2 waits on open decision 1; WS3 and WS4 not started
Created: 2026-11-06
Last-updated: 2026-11-06
Tracking: barwise-ym8.gc9 (adr-refactor batch 2), barwise-ym8.j31,
barwise-ym8.rl7, barwise-ym8.c42, barwise-ym8.aep, barwise-ym8.if3,
barwise-ydl, barwise-shq, barwise-w43, barwise-vt2, barwise-1049
Plan-reviewed: d87e9cd6 (code-review, pr-review)
Touches: barwise/scripts/fault-matrix.mjs, barwise/scripts/check-tracker-closes.mjs,
barwise/scripts/test-adr-model.mjs, barwise/scripts/run-script-tests.mjs,
barwise/scripts/check-depcruise-gate.mjs, barwise/scripts/audit-rubric.mjs,
barwise/scripts/ci-local.mjs, barwise/scripts/lib/ci-gates.mjs,
+barwise/scripts/run-depcruise.mjs, barwise/package.json,
+barwise/scripts/hooks/check-staged-secrets.sh, barwise/docs/adr/credential-handling.md,
barwise/scripts/tests/,
barwise/.husky/pre-commit, .github/workflows/ci.yml,
barwise/docs/adr/gate-refusal-contract.md, barwise/docs/adr/probes.json,
barwise/docs/ARCHITECTURE.md

## Principle

`docs/adr/gate-refusal-contract.md` makes five promises about every gate:
three results, a refusal never on the finding code, the same reading from
any working directory, readers that keep the third value, and no writes
to the tree. The instrument that measures most of them exists
(`npm run fault-matrix`) and finds real breaks, but it runs only when
someone remembers, so the next gate added is under the contract only by
luck. All five decisions carry gap issues for that reason. CLAUDE.md's
rule applies to the contract itself: look at the shadow, ratchet on the
property. A gate's green run is the shadow; the property is that it would
have answered differently had its input been missing. The matrix
measures the property, so it belongs where a regression would be seen,
which is CI.

## The reading this spec starts from (2026-11-06, main at 0b585f1e)

`npm run fault-matrix` on main: 29 node gates, 4 axes, 116 readings,
**746 seconds**, exit 1, four findings, no unreadable rows:

| Gate                       | Axis        | Reading                              | Cause                                                                                                                                                                                                                    |
| -------------------------- | ----------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `check-tracker-closes.mjs` | git-empty   | FALSE GREEN (exit 0, 4 git calls)    | an empty merge-base and an empty tracker read as a clean diff (barwise-ydl)                                                                                                                                              |
| `test-adr-model.mjs`       | git-empty   | CRASHED (exit 1, 7 git calls)        | its cases read git; a case failing because git is broken is reported as a failed case                                                                                                                                    |
| `test-adr-model.mjs`       | git-absent  | CRASHED (exit 1, 1 git call)         | the same                                                                                                                                                                                                                 |
| `run-script-tests.mjs`     | git-shallow | CRASHED (exit 1, 31 shallow queries) | the shim answers `--is-shallow-repository` with true and leaves history readable; cases that run a shallow-checking gate (`check-secrets`, `check-spec-touches`, `check-plan-review`) expect an answer and get a refusal |

Of the 746 seconds, about 640 are `test:scripts`: one run takes 128
seconds, and the matrix runs it unperturbed, under git-shallow and from
three directories. The same matrix without it took **111 seconds** (a
local edit, measured and reverted). A CI run here takes about three and a
half minutes.

Three more breaks are known from the code and outside the matrix's reach:
`check-depcruise-gate` writes a probe into `packages/core/src` and
removes it in a `finally` (barwise-w43); `audit-rubric` and
`check-depcruise-gate` exit 1 on a missing input (barwise-shq; the matrix
reads `audit-rubric` as INDEPENDENT because its input exists in a built
checkout); `npm run depcruise` exits with its violation count, so two
violations read as a refusal (barwise-vt2).

## Should the matrix run in CI, and how? (adr-refactor open decision 2)

`gate-refusal-contract.spec.md` decided no, on cost, when the matrix was
new. The cost is now measured, and so is what not running it costs: four
live breaks, three found only by this reading. Options:

- **A. The whole matrix, every pull request.** About twelve minutes on
  every change. Rejected on cost.
- **B. On a schedule.** A regression is found days later by nobody in
  particular: a red with no owner, which the findings ADR exists to
  prevent. Rejected.
- **C. Sharded parallel jobs, routed by the change classifier.** The plan
  review of this spec's first draft (2026-11-06) found it unworkable as
  drawn. A separate job is read by `ciSteps()` as more steps of the `ci`
  job, so the matrix picks itself up as a gate. A fresh shard job has no
  build, no test reports and a shallow clone, so most gates' unperturbed
  runs cannot answer and every shard would rebuild. `test:scripts` alone
  outweighs the other shards about twenty to one. And the classifier's
  outputs are not visible outside the `ci` job except through `needs:`,
  which serializes the shards after it. Rejected.
- **D. Every gate but those on a short declared list (`test:scripts`
  first), as the last step of the `ci` job,
  on every change that is not docs-only.** The step runs where the build,
  the test reports and the full-history checkout already exist, so every
  gate's unperturbed run can answer, and it costs about two minutes.
  `test:scripts` leaves the matrix: it is a runner of gate tests, not a
  gate. WS1 gives it the precondition refusal that the matrix's reading
  shows it lacks, held by a test of its own. The list and why each step
  is on it are in Target architecture. **Recommended.**

D's backstop is the matrix itself: every listed-in gate runs on every
code change,
so nothing depends on routing, and a gate broken by a package it imports
(`audit-rubric` reads promptlab's build) is read on the pull request that
broke it.

## Scope

In scope:

- the four findings and three known breaks above, fixed so the matrix is
  green on main before it gates anything;
- option D's CI step, the matrix's own exclusion from the gate list, and
  `ci:local` running it the same way;
- the constraints a design for the missing axes must meet (WS3), not the
  design itself;
- the `readers-keep-third` cases the gap issue lists: `ci:local` over a
  mixed failing and refusing run, the pre-commit hook over a
  `check:secrets` refusal, and the skip rule;
- the partition of `ci.yml`'s npm steps into "in the matrix" and "a
  declared exception, with its reason", pinned by a test (WS2).

Out of scope:

- third-party tools' own exit codes (`vitest`, `tsc`, `eslint`, turbo),
  which the ADR's Consequences already except;
- the wrong-Node-major axis in CI, which needs a second interpreter and
  stays behind `--node`;
- the trial gate (barwise-e0q), which no CI job runs (barwise-ym8.ld2).

## Target architecture

- **The axes the matrix lacks are a design problem, not yet a design.**
  A missing tool, a missing manifest and a write undone before exit each
  need an instrument that logs whether the gate reached for the broken
  thing, as the git shim does for git. Two drafts of this spec proposed
  one and its plan review refuted each (2026-11-06); WS3 states what the
  next design must meet.
- **One list of what the matrix does not run.** `scripts/lib/ci-gates.mjs`
  gains `MATRIX_EXCEPTIONS`, each npm step the matrix does not run with
  its reason, and `nodeGates()` excludes every step on it. Three are
  there from the start: `fault-matrix` itself, so the CI step is not one
  of its gates; `test:scripts` (open decision 2); and `audit-gate`,
  whose `npm audit` calls the registry, so seven runs per matrix pass
  turn one registry error into READING MOVED on the cwd axis, a finding
  on a change that did not cause it. A test fails on a `ci.yml` npm step
  that is neither a matrix gate nor on the list.
- **`ci.yml`** gains one step at the end of the `ci` job, `npm run
  fault-matrix`, guarded `if: steps.changes.outputs.docs_only != 'true'`,
  which `shouldRun` already understands, so `ci:local` runs it on the
  same changes.

## Alternatives considered

- **Per-gate unit tests instead of a matrix.** `gates.test.mjs` pins the
  git refusal for ten gates by hand, a must-agree copy the matrix exists
  to remove: it covers ten of twenty-nine, and a gate joins it only if
  its author remembers.
- **Sharding (option C).** Rejected above, on the plan review's
  findings.

## Workstreams (each independently shippable)

### 1. The matrix green on main

Each fix lands red first, under the matrix or a planted test:

- `check-tracker-closes` refuses an empty base, an empty tracker read, and
  a close whose diff does not name the tracker (barwise-ydl);
- `test-adr-model` refuses when git cannot name the repository root;
- `run-script-tests`' shallow reading is two things, found by its code
  review. The matrix's shim answered "shallow" for the sandbox
  repositories gate tests build as well, so most of the crash came from the
  instrument; the shim now answers only for the repository under test.
  What remained was real: six cases ran `audit-spec-status` against the
  repository and failed where the gate correctly refuses a shallow clone.
  They now skip (`skipIfShallow`), so on a shallow clone the runner exits 0
  with its skips printed, which the ADR's skip rule allows and
  `check:adr-tests` guards downstream. The matrix reads that as FALSE
  GREEN, because it cannot tell a runner's loud skip from a gate's silent
  pass; that is why `test:scripts` is on `MATRIX_EXCEPTIONS` (open
  decision 2). A runner-wide refusal was tried and reverted: it blocked
  the whole suite on any shallow clone;
- `check-depcruise-gate` probes a temporary mirror of the cruise root
  rather than the tree (barwise-w43). A probe merely placed outside the
  tree is never cruised: the rule it exists to trip is `from:
  ^packages/core/src/` under `includeOnly: ^packages/[^/]+/src/`
  (`.dependency-cruiser.cjs`), so the mirror holds the configs,
  `intended.cjs` and `packages/*/src`, with a real `core/src`
  directory for the probe. This fix is not a matrix finding today (the
  write is undone before the porcelain check), so it is outside the exit
  criterion below;
- `audit-rubric` and `check-depcruise-gate` refuse a missing input
  (barwise-shq);
- `npm run depcruise` maps any violation count to exit 1 through a
  wrapper (barwise-vt2). The cause is the tool's exit code, its
  violation count, which wraps at 8 bits, so 256 violations exit 0 and no
  reader can recover them.

Exit: the matrix, without the steps on `MATRIX_EXCEPTIONS`, exits 0 on
main.

### 2. In CI (provisional: waits on open decision 1)

`MATRIX_EXCEPTIONS` and `nodeGates()` reading it, the `ci.yml` step,
`test:scripts` with its own precondition test, and `Enforced-by:` naming the matrix for
`three-results`, `refuse-not-find` and `cwd-invariant`, with a probe per
decision in `probes.json`.

### 3. The missing axes (needs its own design pass before it is planned)

The missing-tool and manifest axes and `no-writes` stay gaps until a
design meets what this spec's two plan-review rounds found:

- a PATH shim cannot log a lookup of a name it does not hold, and an
  exported tree (`git archive`) has no `.git`, so every gate would
  refuse at load whatever was removed;
- a recursive `fs.watch` misses a file created and deleted in one run,
  barwise-w43's shape (measured on Node v26.7.0);
- a `NODE_OPTIONS` preload reaches every node descendant (npm, npx,
  `node --test`), so inheritance must be designed for, not assumed
  away; its path must survive a space in the checkout path, the failure
  that made the exit recorder inline itself;
- refusing reads alone simulates an inconsistent world: gates probe with
  `existsSync` and `statSync` first, the ESM loader reads through
  `file:` URLs, and `package.json` names hundreds of files, so targets
  are resolved repository paths across the whole `fs` surface;
- a write log must cover the whole `fs` write surface (mkdir, rm, copy,
  append, symlink, truncate, open with a write flag, streams,
  `fs/promises`), and exclude the temp directory minus the repository
  root, since `ci:local --commit` builds its worktree under the temp
  directory;
- the porcelain backstop exits 2 today, so a write seen by it and a write
  seen by a preload would answer with different codes; both must be a
  `no-writes` finding.

### 4. Readers keep the third value

Two of the gap issue's three cases, tagged
`[adr:gate-refusal-contract#readers-keep-third]`, each mutation-checked:

- `ci:local` over one failing and one refusing gate exits 1, counts only
  the failure, and names the refusal apart; the existing case planted a
  refusal alone, so a `ci:local` that counted refusals as failures passed
  it;
- the pre-commit hook's secrets step moves to
  `scripts/hooks/check-staged-secrets.sh`, as the tracker step already
  did, and branches on the status: 1 prints the rotate advice, a refusal
  says nothing was scanned (barwise-jha). Both still block the commit. A
  stub `npm` answering 0, 1 and 2 tests it without running the hook's
  build and test steps.

The third, "a test skips only when every run refuses", has no mechanism
here: a rule about how tests are written is not something a test of a
gate can check. It stays the gap issue's, and the `audit-gate` cwd test
remains the one worked instance of it.

## Open decisions (for review)

1. **Option D.** Recommended; the owner decides, because it adds a CI
   step, and WS2 waits for the answer. The cost is about two minutes on
   every change that is not docs-only, and on every pre-push `ci:local`.
2. **`test:scripts` out of the matrix.** Recommended. It costs 640 of the
   matrix's 746 seconds, and its reading is about the gates its cases
   spawn, which the matrix already reads directly. The alternative keeps
   it and accepts about twelve minutes.

## Risks and testing

- `ci:local` derives its gate list from `ci.yml` through `ciSteps()` and
  applies `if:` conditions through `shouldRun`. Option D uses a condition
  `shouldRun` already reads, so pre-push and CI agree on when the matrix
  runs. A test covers the step's routing.
- Every fix in WS1 lands with the matrix or a planted test reading it red
  first.
- The `audit-gate` exception moves a network-bound gate out of the
  matrix in CI; it stays in the on-demand run, and the exception names
  why.

## Non-goals

- Changing what any gate checks; only how it answers when it cannot see
  its input.
- A random fault generator. The matrix's header says why enumeration is
  the right instrument here.
