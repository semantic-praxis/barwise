# Concurrent eval sweeps, and payloads that survive a crash

Status: Implemented (same session; the open decision resolved as
recommended -- default concurrency 1)
Created: 2026-08-28
Last-updated: 2026-08-28
Tracking: barwise-887 (concurrency), barwise-888 (payload durability).
Both were operator findings from the first workstream 4 re-baseline
attempt (2026-08-28): eight serial arms of ~2-minute calls is hours of
wall clock, and every payload file carried the same mtime because
nothing is written until the sweep ends.

## Principle

Determinism lives in the scorer, not the schedule. A live sweep is
already non-deterministic -- the provider answers differently every
time -- so the serial loop in `runSuite` is not protecting a purity
guarantee; it is protecting two cache-economics facts and nothing
else: the run's first call writes the system-prompt cache entry every
later call reads, and each case's first call writes that case's
user-message entry. Any schedule that preserves those two orderings
buys wall clock for free. Composability supplies the shape: the unit
that owns both orderings is the CASE (its repeats share a transcript),
so cases parallelize and repeats within a case stay serial -- a chain
per case, not a free-for-all over calls.

Durability is the same observation about a different resource. The
per-case best/worst payload selection (`keepDiagnosticPayloads`) means
a payload's fate is decidable at case completion, and today it is
decided at SUITE completion: a crash in case seven of seven loses six
cases of paid-for evidence. The case boundary is the natural durable
point, and it is the same boundary the scheduler needs -- one seam,
two consumers.

## Scope

In scope:

- When `barwise prompt eval` is passed `--concurrency <n>` (default 1),
  the system shall run up to `n` case chains at once, each chain
  running its own repeats serially in order.
- When a sweep runs at any concurrency, the system shall complete the
  whole first call of the run before any other chain starts (the
  system-prompt cache warm), releasing the other chains whether that
  call succeeded or failed.
- When a case completes, the system shall invoke a caller-supplied
  `onCaseComplete` callback with that case's finished summary, and
  `barwise prompt eval --save-payloads` shall write that case's
  retained payloads at that moment rather than at the end of the run.
- When a report is assembled, the system shall order `cases` by suite
  declaration order regardless of completion order, so two runs at
  different concurrency produce comparable reports.
- When `--concurrency` is not an integer >= 1, the system shall reject
  it before a client exists.

Out of scope: parallelism across arms (already available to the
operator as separate processes; concurrent `history.jsonl` appends
from separate arms are single-line O_APPEND writes and stay out of
this spec); any change to retry policy, budgets, scoring, or the
report schema.

## Inventory

| Module                                | Current state                                            | Verdict                                                   |
| ------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------- |
| `promptlab/src/run/runSuite.ts`       | serial case loop, serial repeat loop, payloads on report | restructure: extract per-case chain, add pool + gate      |
| `promptlab/src/run/retry.ts`          | per-call retry with backoff                              | untouched; absorbs 429s under concurrency as designed     |
| `cli/src/commands/prompt.ts` (`eval`) | `savePayloads(report, dir)` after the sweep              | `--concurrency` flag; per-case write via `onCaseComplete` |
| `cli/tests/workspace/fakeOllama.ts`   | plain http server                                        | untouched; already serves concurrent requests             |
| `docs/local-eval-runbook.md`          | serial arms, no concurrency guidance                     | add flag guidance to the arm blocks                       |

## Target architecture

```ts
// runSuite, restructured. runCase is the extracted chain: the repeat
// loop, progress events, summary assembly, onCaseComplete.
const gate = deferred<void>();
const tasks = suiteCases.map((c, i) => async (): Promise<CaseSummary> => {
  if (i > 0) await gate.promise; // wait for the system-prompt warm
  return runCase(c, i + 1, {
    // The gate opens when the run's FIRST call settles -- success,
    // failure, either way the write premium question is answered.
    afterFirstRun: i === 0 ? () => gate.resolve() : undefined,
  });
});
const cases = await boundedAll(tasks, concurrency); // results in task order
```

`boundedAll` is a ~15-line worker pool, pure and unit-tested on fake
tasks: `concurrency` workers pull tasks in order and results land by
index. At `concurrency: 1` the schedule is byte-identical to today's
loops, gate included (chain 0 resolves it and no one is waiting).

## Alternatives considered

- **Parallelize repeats within a case too.** Rejected: a case's
  repeats 2..k read the user-message cache its repeat 1 writes, so a
  free-for-all pays the ~1.25x write premium up to k times per case,
  and the chain already caps wall clock at one case's serial duration
  (minutes, against a serial sweep's hours).
- **No gate; let early chains race the system-prompt write.** Costs up
  to `concurrency` duplicate writes of a ~5,800-token prefix once per
  run. Cheap, but the gate is three lines and the cache-reporting
  spec's warning ("nothing was read back") should not fire on a
  correctly configured concurrent run.
- **Flush payloads per sample instead of per case.** Writes files the
  per-case pruning then wants to unwrite; the case boundary loses at
  most the one in-flight case, which is the same exposure the
  scheduler's unit already accepts.

## Open decisions (for review)

- **Default concurrency stays 1.** Recommend yes: rate limits are the
  operator's own tier, and the flag's help text carries the guidance
  (2-4 is safe on typical tiers; retries absorb 429s). An adaptive
  default would couple the runner to provider knowledge it does not
  have.

## Risks and testing

- The `concurrency: 1` path must be behaviorally identical to today:
  the whole existing runSuite/offline test surface pins it, unchanged.
- Pool and gate are pure and tested deterministically: a mock client
  with held promises asserts (a) no second call starts before the
  first settles, (b) calls do overlap afterward, (c) the bound holds,
  (d) `cases` order matches suite order under out-of-order completion.
- `onCaseComplete` is tested at the promptlab level (fires once per
  case with pruned payloads) and rides the existing offline
  `--save-payloads` CLI test for the write path.
- Progress lines interleave across chains under concurrency; they
  already carry `caseId` and `run`, so the rendering needs no change.

## Non-goals

- No cross-arm orchestration, no adaptive rate control, no change to
  what a report or history row contains.
- No concurrency on `prompt run` (one call) or the production import
  surfaces (`--samples` stays sequential by its own spec's reasoning:
  its first call warms the cache the rest read, and n <= 5).
