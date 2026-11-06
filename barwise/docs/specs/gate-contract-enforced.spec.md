# The gate refusal contract, enforced: the fault matrix green and in CI

Status: Draft 2026-11-06; no workstream implemented
Created: 2026-11-06
Last-updated: 2026-11-06
Tracking: barwise-ym8.gc9 (adr-refactor batch 2), barwise-ym8.j31,
barwise-ym8.rl7, barwise-ym8.c42, barwise-ym8.aep, barwise-ym8.if3,
barwise-ydl, barwise-shq, barwise-w43, barwise-vt2, barwise-1049
Touches: barwise/scripts/fault-matrix.mjs, barwise/scripts/check-tracker-closes.mjs,
barwise/scripts/test-adr-model.mjs, barwise/scripts/run-script-tests.mjs,
barwise/scripts/check-depcruise-gate.mjs, barwise/scripts/audit-rubric.mjs,
barwise/scripts/ci-local.mjs, barwise/scripts/lib/ci-gates.mjs,
+barwise/scripts/lib/fault-preload.cjs, barwise/scripts/tests/,
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
- **D. Every gate but `test:scripts`, as the last step of the `ci` job,
  on every change that is not docs-only.** The step runs where the build,
  the test reports and the full-history checkout already exist, so every
  gate's unperturbed run can answer, and it costs about two minutes.
  `test:scripts` leaves the matrix: it is a runner of gate tests, not a
  gate. WS1 gives it the precondition refusal that the matrix's reading
  shows it lacks, held by a test of its own. **Recommended.**

D's backstop is the matrix itself: every gate runs on every code change,
so nothing depends on routing, and a gate broken by a package it imports
(`audit-rubric` reads promptlab's build) is read on the pull request that
broke it.

## Scope

In scope:

- the four findings and three known breaks above, fixed so the matrix is
  green on main before it gates anything;
- option D's CI step, the matrix's own exclusion from the gate list, and
  `ci:local` running it the same way;
- the axes the contract names and the matrix lacks (a missing tool, a
  missing manifest or lockfile), and a write instrument that sees a write
  the gate undoes before it exits;
- the `readers-keep-third` cases the gap issue lists: `ci:local` over a
  mixed failing and refusing run, the pre-commit hook over a
  `check:secrets` refusal, and the skip rule;
- the partition of `ci.yml`'s npm steps into "in the matrix" and "a
  declared exception, with its reason", pinned by a test.

Out of scope:

- third-party tools' own exit codes (`vitest`, `tsc`, `eslint`, turbo),
  which the ADR's Consequences already except;
- the wrong-Node-major axis in CI, which needs a second interpreter and
  stays behind `--node`;
- the trial gate (barwise-e0q), which no CI job runs (barwise-ym8.ld2).

## Target architecture

- **One preload, two axes.** The missing-tool and missing-manifest axes
  need what the git shim gives the git axes: a log of whether the gate
  reached for the thing that was broken. A PATH-based shim cannot log a
  lookup of a name it does not hold, and an exported tree has no `.git`,
  so every gate would refuse at load whatever was removed (plan review,
  2026-11-06). Instead a preload, `scripts/lib/fault-preload.cjs`, loaded
  through `NODE_OPTIONS` (appended, as CLAUDE.md requires, so the exit
  recorder stays loaded), wraps `child_process` and `fs` inside the gate's
  own process. It refuses a spawn of a named tool with ENOENT, or a read of
  a named manifest with ENOENT, and logs each reach. The classifier reads
  that log the way it reads the git shim's. The limit is stated, not
  hidden: a manifest read by a child process (`npm ls` reading the
  lockfile) is outside the preload; such a gate is listed in
  `MATRIX_EXCEPTIONS` for that axis, with that reason.
- **Writes are seen by the same preload.** A recursive `fs.watch` misses
  a file created and deleted inside one run, which is barwise-w43's exact
  shape (plan review, measured on Node v26.7.0). The preload wraps the
  `fs` write, rename and unlink calls and logs any whose path is inside
  the repository and outside `node_modules` and the OS temp directory. Any
  such call is a `no-writes` finding, whether or not the gate removed the
  file before exiting. `git status --porcelain` stays as the backstop for
  writes made by a child process.
- **The matrix does not measure itself.** `nodeGates()` excludes
  `fault-matrix.mjs` by name, with a test, so the CI step that runs the
  matrix is not one of its gates.
- **`ci.yml`** gains one step at the end of the `ci` job, `npm run
  fault-matrix`, guarded `if: steps.changes.outputs.docs_only != 'true'`,
  which `shouldRun` already understands, so `ci:local` runs it on the
  same changes.
- **`scripts/lib/ci-gates.mjs`** gains `MATRIX_EXCEPTIONS`: each npm step
  the matrix cannot reach, with its reason (the third-party runners,
  `test:scripts`, the matrix itself). A test fails on a step in neither
  the matrix nor the list.

## Alternatives considered

- **Per-gate unit tests instead of a matrix.** `gates.test.mjs` pins the
  git refusal for ten gates by hand, a must-agree copy the matrix exists
  to remove: it covers ten of twenty-nine, and a gate joins it only if
  its author remembers.
- **Sharding (option C).** Rejected above, on the plan review's
  findings.
- **`fs.watch` or a read-only tree for `no-writes`.** The watch misses
  short-lived files. A read-only tree is invisible to a root process, and
  sessions here run as root. The preload sees the call itself.

## Workstreams (each independently shippable)

### 1. The matrix green on main

Each fix lands red first, under the matrix or a planted test:

- `check-tracker-closes` refuses an empty base and an empty tracker read
  (barwise-ydl);
- `test-adr-model` and `run-script-tests` check their preconditions
  (git answers; the clone is not shallow) before running their cases, and
  refuse;
- `check-depcruise-gate` writes its probe outside the tree (barwise-w43);
- `audit-rubric` and `check-depcruise-gate` refuse a missing input
  (barwise-shq);
- `ci:local` reads depcruise's count as a finding (barwise-vt2).

Exit: the matrix, without `test:scripts`, exits 0 on main.

### 2. In CI (provisional: waits on open decision 1)

The self-exclusion, the `ci.yml` step, `test:scripts` out of the matrix
with its own precondition test, and `Enforced-by:` naming the matrix for
`three-results`, `refuse-not-find` and `cwd-invariant`, with a probe per
decision in `probes.json`.

### 3. The preload axes (provisional: not yet grounded)

`fault-preload.cjs`, the missing-tool and manifest axes and the write
log, each shown catching a planted gate and passing a conforming one;
`no-writes` declared enforced once it runs in CI.

### 4. Readers keep the third value (provisional: not yet grounded)

The three `readers-keep-third` cases, tagged
`[adr:gate-refusal-contract#readers-keep-third]`.

### 5. Every step accounted for (provisional: not yet grounded)

`MATRIX_EXCEPTIONS` and its test.

## Open decisions (for review)

1. **Option D.** Recommended; the owner decides, because it adds a CI
   step, and WS2 waits for the answer. The cost is about two minutes on
   every change that is not docs-only, and on every pre-push `ci:local`.
2. **`test:scripts` out of the matrix.** Recommended. It costs 640 of the
   matrix's 746 seconds, and its reading is about the gates its cases
   spawn, which the matrix already reads directly. The alternative keeps
   it and accepts about twelve minutes.
3. **Which tools and manifests the preload axes name.** Recommended: the
   tools `ci.yml` installs (gitleaks, shellcheck, uv) plus `npm` and
   `dprint`, and the manifests `package.json`, `package-lock.json` and
   `uv.lock`, derived where they can be (the install steps) and listed
   with a test where they cannot.

## Risks and testing

- `ci:local` derives its gate list from `ci.yml` through `ciSteps()` and
  applies `if:` conditions through `shouldRun`. Option D uses a condition
  `shouldRun` already reads, so pre-push and CI agree on when the matrix
  runs. A test covers the step's routing.
- The preload sees only the gate's own process. That limit is stated
  per axis in `MATRIX_EXCEPTIONS`, never folded into a clean reading.
- Every fix in WS1 lands with the matrix reading it red first, and every
  new axis with a planted gate it catches and a conforming one it passes.

## Non-goals

- Changing what any gate checks; only how it answers when it cannot see
  its input.
- A random fault generator. The matrix's header says why enumeration is
  the right instrument here.
