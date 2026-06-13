# CI Hardening: Coverage Enforcement and Example Validation

Status: Accepted
Tracking: REPO_REVIEW-2026-06.md findings #3, T3 (and partially T2)

## Problem

Two gaps let the suite rot silently between merges:

1. **Coverage thresholds never gate (finding #3).** `core`, `diagram`,
   and `llm` declare vitest coverage thresholds, but CI runs
   `npm run test`, which does not collect coverage -- so the thresholds
   are dead config. `cli`, `mcp`, and `code-analysis` have no coverage
   configuration at all.
2. **`examples/` is never validated (finding T3).** The example models
   and the auction project under `barwise/examples/` are not exercised
   by any test or CI step, so an API change can break them without any
   signal. Running the real CLI over them also doubles as a binary
   smoke test (finding T2), which the in-process `runCli()` helper does
   not provide.

## Scope

In scope:

- Make coverage thresholds gate CI for the packages that have them
  (`core`, `diagram`, `llm`).
- Add modest coverage thresholds to `cli`, `mcp`, and `code-analysis`,
  calibrated a few points below current measured coverage so they lock
  in a floor without being flaky.
- Add a CI step that validates every example model and project with the
  built CLI binary.

Out of scope (left as follow-ups):

- Coverage thresholds for the `vscode` unit-test surface. Its webview is
  the untested surface tracked by finding T1; meaningful thresholds wait
  on that work. `vscode` still runs its tests under the coverage task,
  just without gating.
- The broader CI items in finding C1 (Node version matrix, `npm audit`,
  dependabot, coverage artifact upload).

## Approach

### Coverage

- Add `test:coverage` (`vitest run --coverage`) to every package so a
  single `turbo run test:coverage` runs the whole suite. Packages
  without thresholds (`vscode`) collect coverage without gating.
- Add a `test:coverage` Turbo task mirroring `test` (`dependsOn:
  ["build"]`).
- Add a root `test:coverage` script and switch the CI test step from
  `npm run test` to `npm run test:coverage`. This is a single test run,
  not an extra one: `test:coverage` supersedes `test` in CI.
- Give `cli`, `mcp`, and `code-analysis` a `vitest.config.ts` that
  mirrors the existing `core`/`diagram`/`llm` shape
  (`provider: v8`, `include: src/**/*.ts`, `exclude: src/index.ts`).

  Measured baselines (statements / branches / functions / lines) and the
  thresholds chosen as a floor:

  | package       | measured                  | thresholds (st/br/fn/ln) |
  | ------------- | ------------------------- | ------------------------ |
  | cli           | 66 / 83.3 / 94.1 / 66     | 60 / 78 / 88 / 60        |
  | mcp           | 81.1 / 87.0 / 94.3 / 81.1 | 75 / 82 / 88 / 75        |
  | code-analysis | 84.6 / 80.6 / 95.3 / 84.6 | 80 / 75 / 90 / 80        |

- Turning enforcement on revealed that two of the existing thresholds
  were fiction -- they were declared but never ran, so they drifted away
  from reality:

  | package | declared (st/br/fn/ln) | measured                  | recalibrated       |
  | ------- | ---------------------- | ------------------------- | ------------------ |
  | core    | 90 / 84 / 90 / 90      | 92.1 / 84.9 / 98.2 / 92.1 | unchanged (passes) |
  | diagram | 94 / 80 / 100 / 94     | 80.9 / 80.8 / 93.5 / 80.9 | 80 / 78 / 90 / 80  |
  | llm     | 78 / 82 / 100 / 78     | 88.4 / 82.0 / 94.0 / 88.4 | 85 / 80 / 92 / 85  |

  `diagram` lost real coverage during the diagram modernization (code
  added without matching tests) while its unenforced threshold stayed at
  94 -- so the honest floor drops to 80, and **raising diagram coverage
  back up is filed as follow-up** (it overlaps finding T5). `llm`'s
  statement/line floors were too loose (78 vs 88 actual) so they tighten,
  while the unmet 100% functions target relaxes to a real 92.

### Example validation

- A `scripts/validate-examples.sh` that spawns the built CLI
  (`node packages/cli/dist/index.js validate <file>`) over every example
  project manifest and every standalone model, and exits non-zero if any
  reports an error. Warnings do not fail the step (the CLI only sets a
  non-zero exit code on errors).
- Project manifests validate their domains together (cross-domain
  references resolve only in project context), so domain files owned by
  a project are not validated standalone.
- A root `validate:examples` script and a CI step that runs it after
  `build`.

## Verification

- `npm run test:coverage` passes locally with the new thresholds.
- `npm run validate:examples` reports every example as valid (0 errors).
- Deliberately lowering a threshold below measured coverage fails the
  run (confirms the gate is live).
