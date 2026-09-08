# A local CI run reports its own tree, and says what broke

Status: Implemented (both workstreams; see Implementation notes)
Created: 2026-09-08
Last-updated: 2026-09-08
Tracking: barwise-960 (this spec); barwise-939, whose diagnosis cost
three reproduction runs to the truncation this fixes

In one sentence: `npm run ci:local` must not be perturbed by anything
else running, and when a gate fails it must say which test failed rather
than the last twenty-five lines of noise.

## Principle

**Define errors out of existence**, pointed at a gate rather than at
production code.

A gate exists to answer one question: is this tree green. Twice in one
session `ci:local` answered "no" about a tree that was green, and once it
answered "no" correctly and could not say why. All three are the same
shape -- the gate is not isolated from its environment, and it discards
the evidence of its own failure -- and all three cost the reader time
that the gate exists to save.

The isolation half is mechanical. vitest's v8 provider derives its
per-worker temp directory as `resolve(reportsDirectory, ".tmp")` and
removes and recreates it at the start of every run
(`coverage.DM_a_rWm.js:654-724`). Two runs of the same package therefore
delete each other's files, and the second reports `ENOENT ...
coverage/.tmp/coverage-0.json`. `reportsDirectory` is the only lever, and
it is set in twelve near-identical `vitest.config.ts` files.

The diagnosability half is one line: `ci-local.mjs` prints
`f.out.trimEnd().split("\n").slice(-25)`. For a turbo run over twelve
packages, twenty-five lines is the summary footer and the npm error
banner -- never the failing test's name. Diagnosing one such failure took
three separate reproduction runs (standalone, single-package turbo, full
turbo) to learn that two laws had timed out.

**Explicit over implicit** is the second pillar at stake, on the twelve
configs. That every package shares one test shape is a fact nobody
declared; it is twelve copies that happen to agree. A package whose
`testTimeout` or coverage provider drifted would drift silently, and
adding `reportsDirectory` to all twelve would be adding a thirteenth
line to the copy rather than a first line to an owner.

The copies do not agree on everything, and the difference shapes the
owner. Ten packages gate coverage over their whole `src/` tree minus
the barrel; `diagram-ui` and `vscode` gate over a named list of files
instead, because the rest of their `src/` is covered by a suite that
does not run here or carries no logic. Two also collect a different set
of test files. So what varies is the floors, plus a two-case scope,
plus an optional test-include -- and everything else, provider and
timeout and barrel exclusion and now the report directory, belongs to
the owner.

## Should the shared config be extracted here, or is that scope creep? (resolved: extracted)

Extracted, because the alternative is worse than the work.

Part (a) of barwise-960 -- a run-scoped coverage directory -- has to
reach every package that runs coverage. Written against the twelve
configs as they stand, it is twelve identical edits to a copy the
`duplication-audit` rubric already condemns, and the next such change
pays the same cost again. Written against one owner, it is a line.

The extraction is also checkable in a way the copies are not. What
legitimately varies becomes the function's parameter and everything
else becomes its body: a package cannot quietly acquire a different
`testTimeout` without saying so.

## Scope

In scope, stated as requirements:

- When a package declares its vitest configuration, it shall supply its
  four coverage floors, its coverage scope, and where it differs its
  test glob -- and nothing else; the shared owner shall supply the rest
  of the test shape.
- When `BARWISE_COVERAGE_DIR` names a directory, the system shall place
  each package's coverage output under it rather than under
  `packages/<name>/coverage`.
- When `ci:local` runs, it shall set `BARWISE_COVERAGE_DIR` to a
  directory unique to that run, and remove it when the run ends.
- When `ci:local` starts while another `ci:local` holds the lock, it
  shall exit non-zero naming the running process rather than starting.
- When a gate fails, `ci:local` shall write that gate's complete output
  to a file and name the file in its summary.

Out of scope: the docs-only fast path (barwise-954, a separate finding
about which gates run rather than how they report); making CI itself
isolate runs, which it already does by running one job per tree; the
coverage floors themselves.

## Inventory

| Module                              | Current state                                                 | Verdict                                                 |
| ----------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------- |
| `barwise/vitest.shared.ts`          | does not exist                                                | new: the one test shape (WS1)                           |
| `packages/*/vitest.config.ts` (x12) | near-identical; differ in floors, coverage scope, test glob   | each becomes a call carrying only what varies (WS1)     |
| `scripts/ci-local.mjs`              | 77 lines; truncates a failing gate to 25 lines; no lock       | run-scoped coverage dir, lock, full logs (WS2)          |
| `scripts/tests/gates.test.mjs`      | `node:test`; every gate shown red on a planted defect         | gains the lock and log-file tests (WS2)                 |
| `.github/workflows/ci.yml`          | one `run: npm run test:coverage`; no coverage artifact upload | untouched; nothing consumes `packages/*/coverage`       |
| `turbo.json`                        | declares no env pass-through at all                           | declares `BARWISE_COVERAGE_DIR` as pass-through (WS2)   |
| `audit-baseline.json`               | no row for the twelve configs                                 | untouched; WS1 removes the copy rather than ratchets it |

The twelve configs are not in the duplication baseline, so WS1 removes a
copy the ratchet had not yet caught rather than discharging a known row.

## Target architecture

```ts
// barwise/vitest.shared.ts -- the one owner
export interface CoverageFloors {
  readonly statements: number;
  readonly branches: number;
  readonly functions: number;
  readonly lines: number;
}

/** What a package gates coverage over: a tree, or a named list. */
export type CoverageScope =
  | { readonly kind: "whole-src"; readonly exclude?: readonly string[]; }
  | { readonly kind: "named-files"; readonly include: readonly string[]; };

export function barwiseVitestConfig(pkg: string, shape: PackageTestShape);

// packages/core/vitest.config.ts -- ten of the twelve reduce to this
export default defineConfig(barwiseVitestConfig("core", {
  coverage: { kind: "whole-src" },
  thresholds: { statements: 90, branches: 84, functions: 90, lines: 90 },
}));
```

The scope is a two-case union rather than a raw `include`/`exclude`
pair because those two cases are what the packages mean, and they do
not compose: a package that names its files does not also want a barrel
excluded from a tree it is not scanning. Stating the union makes the
two exceptions legible as exceptions.

`defineConfig` stays at the call site and the owner imports nothing from
`vitest/config`: vitest is a dependency of each package and is not
hoisted to the root `node_modules`, so an import there would not
resolve. Wrapping at the call site also puts the returned object under
vitest's own types, where an editor checks it.

`barwiseVitestConfig` reads `BARWISE_COVERAGE_DIR` and, when it is set,
resolves `reportsDirectory` to `<dir>/<pkg>` -- which is why the package
name is a parameter rather than inferred. Unset, the default stands and
a developer's `packages/core/coverage` is where it always was.

`ci-local.mjs` gains three things, none of which the gates know about: a
lock file naming the holding pid, `BARWISE_COVERAGE_DIR` pointed at a
fresh directory under `os.tmpdir()`, and a per-failure log file whose
path it prints.

One line of `turbo.json` is load-bearing for the second. Turborepo 2
runs tasks in strict env mode, so a variable named nowhere in `env` or
`globalPassThroughEnv` never reaches the task: measured directly, a
`BARWISE_COVERAGE_DIR` set around `turbo run test:coverage` was dropped
and the run wrote to `packages/*/coverage` as before -- looking isolated
and not being it. It is declared as a pass-through rather than as an
`env` input on purpose: a value unique per run would miss the task cache
every time, turning a 30s pre-push hook into a 2m40s one, which is the
kind of hook people disable.

## Alternatives considered

- **A lock alone, no coverage isolation.** Cheaper, and it prevents the
  collision actually observed (two `ci:local` runs). It does not prevent
  a bare `npx vitest run --coverage` colliding with a `ci:local`, which
  is the other half of what happened, and a lock cannot see that.
- **Isolate only the `.tmp` directory.** Not reachable: vitest derives
  it from `reportsDirectory` and exposes no separate option.
- **Print the whole failing gate to stdout** instead of a file. A turbo
  run over twelve packages is thousands of lines; the summary stops
  being readable, which is the property that makes `ci:local` worth
  running.
- **Leave the twelve configs and add `reportsDirectory` to each.** The
  work is the same size once, and larger every time after.

## Workstreams

### 1. One owner for the test shape

Add `barwise/vitest.shared.ts` and reduce the twelve
`packages/*/vitest.config.ts` to a call carrying what varies. No
behaviour change: the floors are copied across unaltered and every
package's coverage verdict is identical before and after.

First because it is mechanical, it is verifiable by the suite it
configures, and WS2's one-line change depends on it.

Acceptance, in EARS form: when `npm run test:coverage` runs after the
extraction, each package shall report the same four coverage percentages
and the same pass or fail verdict as before it. Recorded as a
before-and-after table in the PR body, per package.

### 2. An isolated, diagnosable local run

`ci-local.mjs` takes a lock, points `BARWISE_COVERAGE_DIR` at a fresh
directory, and writes each failing gate's full output to a file it names.

Acceptance: when a second `ci:local` starts while one holds the lock, it
shall exit non-zero naming the holder's pid and run no gate; when a gate
fails, the named file shall exist and carry output the printed tail
could not reach. Guarded in `scripts/tests/gates.test.mjs`, each shown
red first against a build with the corresponding fix removed.

## API and migration impact

- No package API changes. `vitest.shared.ts` is build tooling, imported
  only by `vitest.config.ts` files.
- No CI workflow change. `ci.yml` runs `npm run test:coverage` and
  consumes no coverage artifact, so a `BARWISE_COVERAGE_DIR` that only
  `ci:local` sets is invisible to it.
- A developer running `npx vitest run --coverage` in a package sees no
  change: the variable is unset and the default path stands.

## Decisions (resolved)

- **A run-scoped directory under `os.tmpdir()`, not in the repo.** One
  `mkdtemp` directory per run holds both the coverage output and the
  failure logs. The coverage half is removed when the run ends -- it is
  vitest's own bookkeeping, and the report a reader wants is printed to
  stdout -- and the whole directory goes when every gate passed. The
  alternative, `barwise/.coverage-runs/<id>`, survives for inspection at
  the cost of a gitignore entry and a cleanup story for something
  nothing reads.
- **The lock is absolute, with staleness detection.** A run whose pid is
  alive is named and waited for; a lock whose pid is gone is removed
  rather than obeyed. No `--force`: an override flag for a lock is a
  flag people learn to pass by default, and then the lock protects
  nothing. `EPERM` from `process.kill(pid, 0)` counts as alive -- the
  process exists and belongs to someone else, and reading it as gone
  would delete a live run's lock.

## Risks and testing

- **WS1's risk is a silently different verdict**, not a broken build: a
  mistyped floor lowers a gate rather than failing it. The acceptance
  table is per package and compares all four numbers, because three
  matching numbers and one lowered floor is exactly what a summary
  glance misses.
- **The twelve configs carry per-package comments** explaining their
  `testTimeout`, several of which record real incidents. Those move to
  the shared file as one explanation rather than being dropped; a
  comment that survives only in git history is lost.
- `scripts/tests/gates.test.mjs` is the harness for WS2 and its
  convention is red-then-green on a planted defect, in a throwaway repo.
  The new tests follow it, against a throwaway checkout shaped like this
  one -- a throwaway rather than this repo because `npm run test:scripts`
  is itself a gate inside `ci:local`, so a test writing the real lock
  file would corrupt the lock of the run executing it.
- **Nothing type-checks a `vitest.config.ts`.** `tsc` includes only
  `src/`, and eslint here does not use type information. A mistyped key
  in the owner surfaces as coverage landing in the wrong place rather
  than as a compile error, which is what the before-and-after table is
  for.
- Both workstreams land in one PR: WS2's coverage change is a single
  line inside WS1's owner, so splitting them would ship an abstraction
  with no caller for the thing that motivated it. Followed by `npm run
  ci:local` from `barwise/` with the exit code read directly.

## Non-goals

- No change to which gates run, or in what order (that is barwise-954).
- No change to any coverage floor.
- No new dependency: the lock is a file, and `node:fs` writes it.

## Implementation notes

**The before-and-after coverage table.** `turbo run test:coverage
--force` over all twelve packages, once against the original configs
and once against the shared owner, same tree otherwise:

| Package                | Before (S/B/F/L)              | After (S/B/F/L)              |
| ---------------------- | ----------------------------- | ---------------------------- |
| @barwise/cli           | 86.65 / 79.56 / 88.84 / 87.11 | 86.7 / 79.56 / 88.84 / 87.17 |
| @barwise/code-analysis | 86.1 / 79.63 / 92.48 / 89.46  | identical                    |
| @barwise/core          | 97.49 / 93.72 / 98.1 / 98.57  | identical                    |
| @barwise/dbt           | 94.36 / 85.58 / 99.24 / 94.99 | identical                    |
| @barwise/diagram       | 99.55 / 97.57 / 100 / 100     | identical                    |
| @barwise/diagram-ui    | 83.71 / 72.13 / 81.48 / 87.5  | identical                    |
| @barwise/formats       | 88.24 / 74.34 / 90.54 / 92.05 | identical                    |
| @barwise/learn         | 92.63 / 83.05 / 99.29 / 97.31 | identical                    |
| @barwise/llm           | 88.38 / 80.51 / 92.39 / 89.42 | identical                    |
| @barwise/mcp           | 97.22 / 91.31 / 97.84 / 97.44 | identical                    |
| @barwise/promptlab     | 93 / 88.41 / 97.31 / 93.3     | identical                    |
| barwise-vscode         | 97.22 / 94.28 / 100 / 98.49   | identical                    |

Eleven of twelve match to the digit. The `cli` row moved by 0.05 and
0.06 of a point, entirely inside `src/commands/prompt.ts`; the file
list is the same 47 rows before and after and the uncovered-line ranges
are unchanged, so the denominator did not move. That is v8's
run-to-run variance on a package whose tests spawn subprocesses, not a
change in what is measured. Every package's verdict is unchanged.

`vscode` had stated `globals: false`, which is vitest's own default;
dropping it changes nothing but the line count, and is recorded here
because a dropped line is the sort of thing a reader of the diff would
otherwise have to take on trust.

**Red-first proof for the WS2 tests.** Each new test was shown red
against a build with the fix removed:

| Mutation                                   | Killed                                 |
| ------------------------------------------ | -------------------------------------- |
| log file not written                       | the log test and the coverage-dir test |
| `Logs:` line not printed                   | the log test and the coverage-dir test |
| `BARWISE_COVERAGE_DIR` not passed to gates | the coverage-dir test                  |
| `acquireLock()` not called                 | both lock tests                        |
| a stale lock treated as alive              | the staleness test                     |
| the lock never released on exit            | the staleness test                     |

The coverage-dir test reads its value out of a deliberately failing
gate's log, which is why the first two mutations kill it too.

One flake surfaced during that pass and was fixed rather than re-run:
the tests selected "the first `full output:` path printed", which is
the wrong gate's log whenever a second gate also fails. They now select
a log by gate name, and the summary's `Logs:` line is asserted as part
of doing so.

**The cache interaction, measured.** With `BARWISE_COVERAGE_DIR` set, a
`test:coverage` task produces no `coverage/**`, and turbo warns "no
output files found" once per package. The warning is invisible in
practice -- `ci:local` prints a gate's output only when it fails -- but
the consequence is real: turbo caches an empty output set under a hash
that a later run without the variable also matches, so that run replays
with no local coverage directory. Its verdict is the one the original
run reached, and nothing reads the report (`ci.yml` uploads no coverage
artifact); a developer who wants it runs `npx vitest run --coverage` in
the package, which turbo does not cache. Declaring the variable as an
`env` input instead would fix this and cost a full 109s `test:coverage`
on every pre-push, which is the trade the pass-through declines.

**What is still not guarded.** The lock is per checkout, so it stops two
`ci:local` runs but not a bare `npx vitest run --coverage` started
alongside one. That collision is now harmless rather than prevented,
because the two runs no longer share a report directory. A run killed
with SIGKILL leaves its temp directory in `os.tmpdir()` and its lock
behind; the next run finds the dead pid and proceeds.
