# ADR gates: split reading from judging

Status: Draft -- no workstream implemented

Created: 2026-11-04
Last-updated: 2026-11-04
Tracking: barwise-ym8.pw0 (before docs/specs/adr-conformance-model.spec.md)
Touches: barwise/scripts/check-architecture.mjs, barwise/scripts/check-adr-tests.mjs,
+barwise/scripts/lib/adr-facts.mjs, +barwise/scripts/lib/adr-judge.mjs,
+barwise/scripts/tests/adr-facts.test.mjs, barwise/scripts/tests/expected-counts.json

## Principle

`check:architecture`'s declaration pass and `check:adr-tests` each read the
repository and judge it in one loop: the same block of code decides which
input to open next and what the answer means. That couples two concerns
the ADR conformance model (`adr-conformance-model.spec.md`) needs apart,
and its plan reviews kept failing on predictions about a reader that did
not exist. This spec builds that reader by moving code, not by redesign:
every read moves into `adr-facts.mjs`, every rule into `adr-judge.mjs`, and
nothing a gate prints changes. **Orthogonality** is the principle: reading
and judging become separate concerns with a narrow interface between them.

## Is any output allowed to change? (resolved: no)

None. The existing tests of both gates (in `gates.test.mjs` and
`check-adr-tests.test.mjs`) assert their findings, refusals and exit codes,
and they are the acceptance test: they pass unchanged. That forces the
reader to keep the three properties the conformance model's second review
found an eager reader would break:

- **Laziness.** `barwise/package.json` is read only when an npm entry has
  passed the gate-name and meta rules; `ci.yml` only when a declared gate
  reaches the step check (also when the scripts could not be read); the
  tracker only for a `none` entry. The reader exposes loaders the judge
  calls, never a precomputed set.
- **Order.** Refusals are pushed into one list the gate owns, in the order
  the loaders first run, interleaved with the judge's own refusal ("cannot
  tell whether the step runs"). The `ci-occurrences.mjs` import stays
  eager, decided when the reader is created from whether any ADR declares
  an npm entry, so its refusal stays first.
- **Keys.** A step is matched by the full command, `npm run <script>` or
  `npm run <script> -- <args>`, and the meta rule by the declaring ADR and
  the script. The reader's step question takes the command string.

## Scope

In scope:

- When `check:architecture` runs, its declaration pass shall read the root
  scripts, `ci.yml` and the tracker only through loaders created by
  `createGovernanceReader(root, adrs, refusals)` in `adr-facts.mjs`, and
  judge each ADR in `judgeDeclarations(adrs, reader)` in `adr-judge.mjs`,
  with the loop, its short-circuits and its messages unchanged.
- When `check:adr-tests` runs, it shall read the expected reports through
  `readTestReports(root)` in `adr-facts.mjs`, which returns the tests that
  ran and the unread-report refusals, and judge them in
  `judgeTestedDecisions(adrs, reports)` in `adr-judge.mjs`.
- When either gate runs on any tree the existing tests build, its stdout,
  stderr and exit code shall be what they are before this change.
- When `adr-facts.test.mjs` runs, it shall show the reader alone reads an
  input only when its loader is first called, reads it at most once,
  records an unreadable input as one refusal in call order, and answers the
  step question by the full command.

Out of scope:

- Any new rule, fact or message; the conformance model; the "unknown"
  answer the model needs. They belong to `adr-conformance-model.spec.md`,
  re-planned against this reader once it exists.
- `check:architecture`'s other passes (the graph, references, the
  generated section). They keep their own reads.

## Inventory

| Code today                                                                                      | Moves to                                   | Note                                                                                            |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `lazily`, `rootScripts`, the `needsWorkflow` import, `steps`, `issues` (check-architecture.mjs) | `createGovernanceReader`                   | the `refusals` list stays the gate's, passed in                                                 |
| `guard` and the step filter (`matching`, `inBarwise`, `judged`)                                 | `createGovernanceReader`'s `step(command)` | returns the matched, in-barwise and judged steps; the verdict and its message stay in the judge |
| the per-ADR loop                                                                                | `judgeDeclarations`                        | unchanged, reading only through the reader                                                      |
| `readVitest`, `readNodeTest`, the expected-report list and its reading (check-adr-tests.mjs)    | `readTestReports`                          | an unreadable list stays an exit 2 in the gate                                                  |
| stale tags and the per-decision verdicts                                                        | `judgeTestedDecisions`                     | unchanged                                                                                       |

## Alternatives considered

- **An eager `readGovernanceFacts(root)`.** The conformance plan's first
  idea. Rejected for the three reasons above: it reads inputs today's gate
  never opens, and reorders and adds refusals.
- **Leave the gates as they are and give the model its own reader.**
  Rejected: two readers of the same headers and workflow are a must-agree
  copy, the problem the conformance plan's first draft ran into.

## Workstreams (each independently shippable)

### 1. The split

One PR. `adr-facts.mjs` and `adr-judge.mjs` take the code in the
Inventory, moved, not rewritten; both gates import them. `adr-facts.test.mjs`
covers the reader as Scope says, and `expected-counts.json` records it. The
acceptance evidence, in the PR body: both gates' existing tests pass
unchanged, and the real tree's output from both gates is byte-identical
before and after (diffed from the two runs).

## API and migration impact

- None outside `barwise/scripts/`. The two gates keep their names, steps,
  arguments and output.

## Open decisions (for review)

None. The owner chose this split as its own step on 2026-11-04.
