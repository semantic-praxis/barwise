# ADR gates: split reading from judging

Status: Draft -- no workstream implemented

Created: 2026-11-04
Last-updated: 2026-11-04
Tracking: barwise-ym8.pw0 (before docs/specs/adr-conformance-model.spec.md)
Touches: barwise/scripts/check-architecture.mjs, barwise/scripts/check-adr-tests.mjs,
+barwise/scripts/lib/adr-facts.mjs, +barwise/scripts/lib/adr-judge.mjs,
+barwise/scripts/tests/adr-facts.test.mjs, barwise/scripts/tests/expected-counts.json, barwise/scripts/tests/gates.test.mjs,
barwise/scripts/tests/check-adr-tests.test.mjs

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

None, but for one difference Node itself makes (below). The existing tests
of both gates (in `gates.test.mjs` and `check-adr-tests.test.mjs`) assert
their findings, refusals and exit codes, and they pass unchanged. They do
not pin everything that must not change, so the PR first adds
characterization tests for what they miss, committed before the split and
passing on today's code: an unreadable `barwise/package.json` and an
unreadable `ci.yml` (each a refusal, no finding); the `ci-occurrences.mjs`
import failing beside an unreadable `barwise/package.json` (the import
refusal listed first); and a skip-only decision beside an unproven one in
`check:adr-tests` (one refusal, one finding, exit 1). The split then keeps
them green. Together they force the three properties the conformance
model's second review found an eager reader would break:

- **Laziness.** `barwise/package.json` is read only when an npm entry has
  passed the gate-name and meta rules; `ci.yml` only when a declared gate
  reaches the step check (also when the scripts could not be read); the
  tracker only for a `none` entry. The reader exposes loaders the judge
  calls, never a precomputed set.
- **Order.** Refusals are pushed into one list the gate owns, in the order
  the loaders first run, interleaved with the judge's own refusal ("cannot
  tell whether the step runs"). The `ci-occurrences.mjs` import stays
  eager, decided when the reader is created from a `needsWorkflow` flag the
  gate computes as today and passes in, so the reader never parses a
  header and its refusal stays first. The one text that can change is
  Node's own: if `ci-occurrences.mjs` cannot be resolved, Node's message
  names the importing file, which moves to `lib/adr-facts.mjs`; the
  refusal's label, `scripts/lib/ci-occurrences.mjs:`, is kept.
- **Keys.** A step is matched by the full command, `npm run <script>` or
  `npm run <script> -- <args>`, and the meta rule by the declaring ADR and
  the script. The reader's step question takes the command string.

What counts as reading and what as judging follows one line: the reader
answers what an input says, the judge decides what that means. So the
reader returns the steps whose `run:` is the command, as `ci.yml` states
them, and `guard` (a step counts only if it runs on every code change for
both optimizer values) stays in the judge, with the working-directory and
`continue-on-error` filters.

## Scope

In scope:

- When `check:architecture` runs, its declaration pass shall read the root
  scripts, `ci.yml` and the tracker only through
  `await createGovernanceReader(root, { needsWorkflow, refusals })` in
  `adr-facts.mjs`, whose `scripts()`, `steps(command)` and `issues()` are
  today's lazy loaders, and judge each ADR in
  `judgeDeclarations(adrs, reader, refusals)` in `adr-judge.mjs`, which
  returns `{ problems, declaring }`, with the loop, its short-circuits and
  its messages unchanged. `refusals` is the gate's one list, which the
  loaders and the judge both push to, so the order is today's.
- When an input cannot be read, its loader shall record one refusal and
  answer `null`, as today: `scripts()` `null` lets the judge go on to the
  step check, `steps(command)` `null` skips the entry, `issues()` `null`
  skips it; never an empty list or map, which the judge would read as a
  finding.
- When `check:adr-tests` runs, it shall read the expected reports through
  `readTestReports(root)` in `adr-facts.mjs`, which returns
  `{ expected, ran, refusals, unreadable }` with `unreadable` fixed at read
  time, or throws when the report list cannot be built, which the gate
  prints with today's `the list of reports:` prefix and exit 2. The gate
  puts `reports.refusals` first in its one list and calls
  `judgeTestedDecisions(adrs, reports, refusals)`, which parses the
  declaring ADRs, appends its refusals after them, reads the count from
  `reports.unreadable` (never from the list's length, which it grows), and
  returns `{ findings, declaring, tested, skipOnly }`.
- When either gate runs on any tree the existing tests build, its stdout,
  stderr and exit code shall be what they are before this change.
- When `adr-facts.test.mjs` runs, it shall show the reader alone reads an
  input only when its loader is first called, reads it at most once,
  records an unreadable input as one refusal in call order, answers the
  step question by the full command, and answers `null` for an unreadable
  `ci.yml`.

Out of scope:

- Any new rule, fact or message; the conformance model; the "unknown"
  answer the model needs. They belong to `adr-conformance-model.spec.md`,
  re-planned against this reader once it exists.
- `check:architecture`'s other passes (the graph, references, the
  generated section). They keep their own reads.

## Inventory

| Code today                                                                                               | Moves to                 | Note                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lazily`, `rootScripts`, the `needsWorkflow` import, `steps`, `issues` (check-architecture.mjs)          | `createGovernanceReader` | the `refusals` list stays the gate's, passed in                                                                                                                             |
| the step lookup (`all.filter((s) => s.run === want)`)                                                    | `reader.steps(command)`  | the steps as `ci.yml` states them, or `null` when it cannot be read; `guard`, the `barwise/` and `continue-on-error` filters, the verdict and its message stay in the judge |
| the per-ADR loop, `guard`, `declaring`, `enforcementProblems`                                            | `judgeDeclarations`      | unchanged; it returns the problems and the count the gate prints                                                                                                            |
| `readVitest`, `readNodeTest`, the expected-report list and its reading (check-adr-tests.mjs)             | `readTestReports`        | an unreadable list stays an exit 2 in the gate                                                                                                                              |
| the declaring-ADR parse (`declaring`, `testedIds`), stale tags, the per-decision verdicts and `skipOnly` | `judgeTestedDecisions`   | unchanged; `unreadableReports` is `reports.refusals.length`                                                                                                                 |

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
unchanged, and the real tree's output from both gates is identical before
and after (diffed from the two runs) but for one expected difference:
registering `adr-facts.test.mjs` adds its report to `check:adr-tests`'s
list, so that gate's OK line counts one more report and that file's tests.
The file carries no `[adr:]` tag and no `describe`, so nothing else in that
line moves.
Any other difference is a regression.

## API and migration impact

- None outside `barwise/scripts/`. The two gates keep their names, steps,
  arguments and output.

## Open decisions (for review)

None. The owner chose this split as its own step on 2026-11-04.
