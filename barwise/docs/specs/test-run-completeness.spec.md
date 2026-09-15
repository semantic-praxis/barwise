# A test run that did not finish must not print a plausible summary

Status: Implemented. WS1 shipped; one thing the draft did not anticipate is
recorded in Implementation notes below

Created: 2026-09-15
Last-updated: 2026-09-15
Tracking: barwise-1027. This is `docs/specs/gate-refusal-contract.spec.md` applied
to the one instrument that contract never reached -- the test runner's own
summary line, which is what every other gate's verdict is ultimately read from.

In one sentence: `node --test` reports the tests that REGISTERED, so a file whose
registration halts partway prints a complete-looking summary of a run that never
happened, and nothing in the output says the count is short.

## Principle

**A gate that cannot see its input must not print PASS**, one layer beneath
where that rule was applied.

CLAUDE.md states the contract for the node gates: pass, fail, and **could not
answer**, exit `2` for the third. Every gate in `ci:local` now honours it. The
test runner does not, and it is the instrument the others are judged by: a green
`test:scripts` is what "the gates work" means in practice.

The failure is the same shape the contract exists for. A summary reading
`tests 41`, `pass 36`, `fail 4` means both "36 of your tests passed" and "36 of
an unknown number of your tests passed, and I cannot tell you how many never
existed". A reader cannot distinguish them, because the two are byte-identical.

Determinism is the second principle, and it decides the mechanism rather than
the need. A suite's registered test count is a pure function of its source. It
is therefore something the repository can state and check, exactly as it states
and checks its audit baselines -- which is what makes this a ratchet rather than
a heuristic.

## The reading (resolved: measured, 9 written and 6 reported)

Two probes, both against Node v22.22.2, the version `.nvmrc` pins.

**barwise-1027's premise does not hold, and the real mechanism is worse.** The
issue implies the runner stopped the whole run after one file failed to load.
It does not: `node --test` isolates per file. A three-file probe whose middle
file throws at module load reported `# tests 6 / # pass 5 / # fail 1` with the
third file running normally.

What actually truncates is **registration inside one file**. `test()` calls
are registered as the module executes, so a module-scope failure partway down a
file means every `test()` below it never registers -- and the runner cannot
report what was never declared:

| Probe                                               | Tests written | Reported | Summary printed             | Exit |
| --------------------------------------------------- | ------------: | -------: | --------------------------- | ---: |
| two files, one throws at module load                |             5 |        6 | `tests 6 / pass 5 / fail 1` |    1 |
| one file, escaped async throw after a test ends     |             5 |        6 | `tests 6 / pass 5 / fail 1` |    1 |
| **one file, module-scope throw with 4 tests below** |         **9** |    **6** | `tests 6 / pass 5 / fail 1` |    1 |

The third row is the defect. Nine tests are written across the two files; six
are reported; `b4` through `b7` are silently not part of the run. The extra
reported "test" in every row is the FILE itself, which the runner adds as a
failing case -- so the exit code is non-zero and a CI gate does catch
_something_. That is why this is a reporting defect rather than a missed
regression: CI goes red, and the human reading the output is told that five
tests passed and one failed, which is true and complete-sounding and omits that
four tests do not exist.

The original incident is this row at scale: 41 reported where 99 were written,
noticed only because 41 did not match a number the reader happened to have in
mind minutes earlier.

## Should the count be a floor or an exact match? (resolved: exact)

Exact, ratcheted both ways, matching `audit:duplication` and `audit:corrections`
-- a new test fails the check until the number is updated, and so does a deleted
one. A floor catches truncation and silently permits deletion, which is the same
class of blindness one step over: a suite that shrinks because someone removed a
test reads identically to one that was always that size.

**Per file, not in total.** A total is a shadow that diverges exactly where it
matters: one file truncating by four while another gains four leaves the total
correct and the run incomplete. The per-file counts cost nothing to collect
(measured below) and cannot be compensated.

## Scope

In scope:

- When a test file reports a different number of registered tests than the
  manifest records, the system shall exit `2` and name the file, the expected
  count, and the count reported.
- When a test file reports its recorded count and any test in it fails, the
  system shall exit `1`.
- When every file reports its recorded count and no test fails, the system shall
  exit `0`.
- When the count manifest is absent or does not name a file being run, the
  system shall exit `2` rather than run unchecked.
- When `--write` is given and any file failed or could not be counted, the
  system shall refuse to update the manifest.

Out of scope:

- The package test suites (`turbo run test`, vitest). Vitest reports a total it
  derives from collected files and fails collection loudly; this spec covers the
  `node --test` gate suite, where the defect was measured. Extending it is a
  separate finding if one is ever observed there.
- Detecting a test that registers and then asserts nothing. That is
  `docs/specs/test-quality.spec.md`'s question, and a count cannot see it.
- barwise-1019 (a mutation run reporting CAUGHT when the suite never executed).
  This makes that failure visible in the count, but the `mutate` verdict logic
  is its own issue and stays open.

## Inventory

| Module                               | Current state                                            | Verdict                         |
| ------------------------------------ | -------------------------------------------------------- | ------------------------------- |
| `scripts/run-script-tests.mjs`       | does not exist                                           | new: the wrapper                |
| `scripts/tests/expected-counts.json` | does not exist                                           | new: the manifest               |
| `package.json` `test:scripts`        | `node --test scripts/tests/*.test.mjs`                   | calls the wrapper               |
| `package.json` `test`                | `turbo run test && node --test scripts/tests/*.test.mjs` | calls the wrapper               |
| `.github/workflows/ci.yml`           | runs `npm run test:scripts`                              | untouched -- the script changes |
| `scripts/lib/ci-gates.mjs`           | derives the gate list from `ci.yml`                      | untouched                       |
| `scripts/tests/gates.test.mjs`       | 118 tests; 135 across three files                        | gains the wrapper's own cases   |

`ci.yml` is deliberately untouched: it invokes `npm run test:scripts`, so
redefining that script is the whole wiring. A gate list derived from `ci.yml`
therefore needs no update either, which is the property
`check:root-scripts` and `ci-gates.mjs` exist to preserve.

## Target architecture

```
scripts/run-script-tests.mjs [--write]

  for each scripts/tests/*.test.mjs, IN PARALLEL:
      node --test <file>              -- one child per file, output buffered
      parse the child's own `# tests N`

  compare N to expected-counts.json[<file>]

  exit 2  a count differs, a file is missing from the manifest, the manifest
          is absent, or a child produced no parsable summary
  exit 1  every count matches and some test failed
  exit 0  every count matches and nothing failed

  --write  records the counts -- but REFUSES when any file failed or could not
           be counted, because recording a truncated run is how the manifest
           would come to certify the very thing it exists to detect.

  Per file rather than one `node --test <all>` because the runner reports only a
  combined total (the junit reporter flattens too: every case is classname
  "test"). Measured, this costs nothing: 39.6s per-file parallel against 42.6s
  combined, since one file dominates either way.
```

## Alternatives considered

- **Assert the combined total only.** One number, no manifest per file, no
  parsing per child. Rejected: compensating drift leaves it correct while the
  run is incomplete, and it would have to be updated on every test addition
  anyway, so it is not cheaper to maintain -- only weaker.

- **Parse the run's TAP or junit output for per-file counts.** Would keep a
  single child process. Rejected on measurement: the junit reporter emits every
  case with `classname="test"` regardless of file, and the default reporter
  groups by file only in prose. Both would need a parser that a Node upgrade can
  silently break, against a per-file spawn that cannot.

- **Detect the file-level failure case the runner already emits.** A truncated
  file appears as a failing case named after the file. Rejected as the primary
  mechanism: it is an artifact of the current reporter, it says nothing about
  HOW MANY tests were lost, and it cannot see a file that shrank for any other
  reason.

- **Leave it: exit 1 already fails CI.** This is the strongest objection and the
  reason the issue sat open. It is true that CI goes red, and false that the
  problem is therefore handled: the incident that produced barwise-1027 was a
  human comparing two runs and drawing a conclusion from a summary that was
  arithmetically complete and factually partial. The cost of being wrong there
  is a decision made on a number that describes a different suite.

## Workstreams (each independently shippable)

### 1. The wrapper, the manifest, and the npm scripts

All three together: the wrapper without the manifest cannot check anything, and
the manifest without the script change is a file nothing reads.

Verified red by planting the measured defect -- a module-scope throw above the
last tests in `gates.test.mjs` -- and confirming the wrapper exits 2 naming the
file and both counts, where `node --test` exits 1 with a plausible summary.

## API and migration impact

- No package API changes; `scripts/` is build tooling and nothing under
  `packages/` imports it.
- `npm run test:scripts` and `npm test` keep their names and their meaning. The
  output gains a per-file count line and, on a mismatch, a refusal.
- Adding or removing a gate test now requires updating
  `expected-counts.json` in the same commit. That is the intended friction and
  the same bargain every baseline in this repository makes.

## Open decisions (for review)

- **Whether `--write` should exist at all.** It is convenience for a real
  workflow (add five tests, record the new counts) and it is also the exact
  shape of the defect barwise-1026 just fixed, one file over. The refusal on a
  failed or uncountable run is what makes it safe; a reviewer who would rather
  the number be typed by hand has a fair case, and removing it costs one
  function.
- **Whether to cover the vitest suites too.** Out of scope above because the
  defect was measured only in `node --test`, and vitest fails collection loudly.
  If a reviewer has seen a vitest run report a partial collection as a pass,
  that changes the answer and I have not looked for one.

## Risks and testing

- **The wrapper must not become the thing that hides a failure.** Its own tests
  assert all three exits against planted conditions, and the exit-1 path is
  asserted with a genuinely failing test rather than a mocked one.
- **Output must stay readable.** Children run in parallel, so their output is
  buffered and printed grouped by file rather than interleaved; a developer
  reading a failure sees the same text `node --test` gave them.
- Run `npm run ci:local` before pushing; `test:scripts` is one of its 32 gates
  and now exercises the wrapper on every run.

## Implementation notes (deviations from the draft)

**`node --test` refuses to nest, and the wrapper had to say so explicitly.**
The draft has the wrapper spawn `node --test <file>` per file and never
considered where the wrapper itself runs. Its own tests run under
`node --test`, so the children inherited `NODE_TEST_CONTEXT` -- the marker node
uses to detect a recursive run -- and printed
`run() is being called recursively within a test file. skipping running files.`
with no summary at all. Four of the eight new tests failed, and the failure was
the gate reporting "could not be counted" for suites that were perfectly fine.

Each child IS a fresh top-level run, so inheriting that marker was wrong
independently of the tests: the fix deletes `NODE_TEST_CONTEXT` from the child
environment, which is a correctness fix rather than a seam opened for a test.
Worth recording because the symptom pointed at the manifest and the cause was
in the environment two layers away.

**The "child reported nothing" branch had no test, and finding a probe for it
took three tries.** A mutation deleting it came back UNCAUGHT: the truncation
test does not reach it, because a truncated child reports a SHORT count, not no
count. Two levers were tried and rejected on measurement -- an invalid
`NODE_OPTIONS` flag kills the wrapper itself (exit 9; it is a node process too),
and killing the test file's own process does not work either, because even a
`SIGKILL` at module scope leaves the runner PARENT alive to print a summary. The
lever that works is forcing a different reporter through `NODE_OPTIONS`, which
is also the realistic way an operator meets this: the children emit junit XML,
no `# tests N` line exists to read, and the wrapper refuses rather than guessing.

**The gate's first act was to refuse its own commit**, which is the ratchet
working: adding eight tests took `gates.test.mjs` from 118 to 126 and
`run-script-tests` exited 2 saying so, with the remedy in the message. That is
the designed friction, and it is the same bargain every baseline here makes.

## Non-goals

- No change to what any test asserts, and no new test framework.
- No coverage of vitest, `mutate`, or the package suites.
- No attempt to detect a test that runs without asserting.
