# ADR conformance as an ORM model

Status: Draft -- no workstream implemented

Created: 2026-11-04
Last-updated: 2026-11-04
Tracking: barwise-ym8.z9g (follows docs/specs/enforceable-adr-practice.spec.md)
Touches: +barwise/docs/adr/governance.orm.yaml, +barwise/scripts/check-adr-model.mjs,
+barwise/scripts/lib/adr-facts.mjs, barwise/scripts/check-adr-tests.mjs, barwise/scripts/tests/gates.test.mjs, +barwise/scripts/tests/architecture-repo.mjs, +barwise/scripts/lib/test-evidence.mjs, +barwise/scripts/tests-built/adr-model.test.mjs, barwise/package.json, package.json,
.github/workflows/ci.yml

## Principle

The rules that govern the ADRs are relations between things -- decisions,
gates, tests, gap issues -- and constraints over those relations, which is
what an ORM model states. Today they are stated twice and checked by
neither statement: once in prose (the spec, the ADR template) and once as
hand-written branches in `check:architecture` and `check:adr-tests`. This
spec writes them once more, as a barwise schema whose constraints verbalize
as plain sentences, and checks the repository against it by extracting the
facts and running barwise's own population validation.

The principles at stake are **explicit over implicit** (the rules become a
declared, reviewable schema rather than code paths) and **determinism in
core** (validation is core's pure population check; reading the repository
is I/O, so extraction stays in `barwise/scripts/`). The model is a second
statement of rules two gates already enforce, so it is a must-agree copy,
and WS1 lands the drift test that holds them together.

## Should the model replace the gates? (resolved: not in this spec)

It runs beside them. Two reasons, both from the prototype. The model only
sees the facts its extractor produced, so an extractor bug blinds it
silently; and barwise checking barwise's own governance is circular, so a
regression in core's population validation would silence it. The gates it
mirrors stay until it has run clean in CI beside them, and whether to
retire their overlapping branches then is the owner's call (Open
decisions).

## What the prototype showed

A scratch prototype (2026-11-04) built the schema below, generated its
population from the real tree through the gates' parsers, and validated it
with `barwise validate`:

- the real tree produced 89 decisions, 14 gate facts, 30 tests
  declarations, 87 gap issues and 108 passing-test facts, and exactly 87
  errors, each "GapIssue carries GapLabel" missing: the label rule of
  `enforceable-adr-practice.spec.md` WS3, not yet backfilled;
- with the labels supplied, it was clean (exit 0);
- six planted violations each gave exactly one error naming it: a tested
  decision with no passing test (subset), one gap issue for two decisions
  (uniqueness), a closed gap issue (value constraint), a decision with no
  entry (disjunctive mandatory), a gate with no ci.yml step (mandatory), a
  decision conflicting with itself (irreflexive ring).

## Scope

In scope:

- When `npm run check:adr-model` runs, the system shall extract the
  governance facts from the tracked ADRs (`trackedPaths(root).filter(isAdr)`,
  as the gates select them), the tracker, `ci.yml` and the test reports,
  through the readers the gates use, validate them against
  `barwise/docs/adr/governance.orm.yaml` with `@barwise/core`, and exit 1
  naming each violated constraint by its fact type and the instance that
  violates it.
- When an input cannot be read, `@barwise/core` is not built, or a
  declared tested decision is unproven while a report is unread or its
  tagged tests all skipped, it shall exit 2 and print no pass, as
  `check:adr-tests` does for the same tree.
- When the schema alone is validated, it shall have no error.
- When a violation is planted in a fixture tree, `check:adr-model` and the
  gate that already holds that rule (`check:architecture` or
  `check:adr-tests`) shall give the same exit code; on a clean fixture both
  exit 0. Each rule in the WS1 schema has such a gate, so the drift test
  covers every one of them.
- When barwise verbalizes the schema, each governance rule shall read as
  one sentence; the schema carries those sentences as its documentation.

Out of scope:

- Behavioral decisions (core does no I/O, the same input gives the same
  output). They keep their gates and tests; the model records only the
  evidence (a gate is a CI step, a tagged test passed).
- Retiring any branch of `check:architecture` or `check:adr-tests`.
- Writing the population to disk. It is generated per run and never
  committed, so it cannot become a second copy of the headers.

## Inventory

| Area                                        | Current state (verified 2026-11-04)                                                                                                     | Verdict                                                                                           |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| core population validation                  | checks uniqueness, mandatory, disjunctive mandatory, subset, equality, exclusion, ring and value constraints over a model's populations | used as is                                                                                        |
| `barwise validate --format json`            | diagnostics with `severity`, `message`, `ruleId`, `elementId`; exit 1 on an error                                                       | the format the tests assert on                                                                    |
| `@barwise/core` from a script               | `measure-comparison.mjs` imports it and refuses when it is not built                                                                    | WS1 follows that precedent                                                                        |
| `adr-enforcement.mjs`, `ci-occurrences.mjs` | export the parsers the prototype used                                                                                                   | reused, not copied                                                                                |
| `check-adr-tests.mjs` evidence              | the expected-report list, the report readers and the passed / failed / skipped reading are inline in the script                         | WS1 moves them to `scripts/lib/test-evidence.mjs`, which both import, so the two read a run alike |
| `architectureRepo()`                        | the fixture builder for `check:architecture` cases, private to `gates.test.mjs`                                                         | WS1 moves it to `scripts/tests/architecture-repo.mjs`, which both test files import               |
| `run-script-tests.mjs`                      | refuses a test file its manifest does not name; `test:scripts` runs before the build                                                    | the model's tests need the build, so they get their own step                                      |
| ci.yml                                      | `npm run build` runs after `test:scripts`; `check:adr-tests` runs after `test:coverage`                                                 | WS2 adds the step after `check:adr-tests`                                                         |

## Target architecture

```
barwise/docs/adr/governance.orm.yaml   the rules, hand-written (4.0 format)
barwise/scripts/lib/adr-facts.mjs      readFacts(root) -> population rows,
                                       through the gates' parsers; I/O
barwise/scripts/check-adr-model.mjs    load schema + rows into an OrmModel,
                                       ValidationEngine (pure, core),
                                       0 / 1 violations / 2 could not answer

Rules in the WS1 schema, each also held by a gate (the drift test):
  Each Decision belongs to exactly one ADR.            (check:architecture)
  Each Decision is held by some Gate, is declared tested by some ADR, or
    has gap recorded by some GapIssue.                 (header required)
  If an ADR declares tests for a Decision, some Test proves it.
                                                       (check:adr-tests)
  Each GapIssue records the gap of at most one Decision.   (dedicated)
  Each Decision has gap recorded by at most one GapIssue.
  Each GapIssue has exactly one IssueState, and it is "not closed".
    The extractor maps the tracker's status to "closed" or "not closed",
    as check:architecture reads it (status === "closed").
  Each GapIssue carries the gap label. The extractor emits that fact only
    for the label check:architecture requires; other labels are not facts.
  Each Gate runs as exactly one CiStep.

Refusals are the extractor's, not constraints: an unread input, an
unbuilt core, and a tested decision left unproven by an unread report or
by skips (test-evidence.mjs, shared with check:adr-tests).
```

## Alternatives considered

- **Extend `check:architecture` instead.** That is where the rules live
  today, as code. Rejected as the end state the owner asked to explore:
  the schema states the rules declaratively, verbalizes them, and makes
  them queryable; but kept as the authority for now (resolved heading
  above).
- **Commit the generated population.** It would make the facts reviewable
  in a diff, and it would be a third copy of the headers that drifts.
  Rejected; the population is generated each run.
- **A separate package for the model.** Rejected: nothing outside the
  scripts consumes it, and a package would add a node to the graph for a
  dev-time check.

## Workstreams (each independently shippable)

### 1. The governance model, on demand

Lands after `enforceable-adr-practice.spec.md` WS3 (barwise-ym8.gxp.y5o),
whose label rule the schema states; before it, the real tree fails the
model by 87 unlabelled gap issues. The schema moves from the prototype into
`barwise/docs/adr/governance.orm.yaml` in the current format, without the
prototype's conflict fact type, which has no gate to agree with and no
declared source (WS5). `adr-facts.mjs` holds the extractor. The test
evidence -- expected reports, readers and the passed / failed / skipped
reading -- moves from `check-adr-tests.mjs` into `test-evidence.mjs`, and
`check:adr-tests` imports it unchanged in behaviour. `check-adr-model.mjs`,
the `check:adr-model` npm script and its root forwarder, and a
`test:adr-model` npm script that runs the model's tests.

The model's tests need `@barwise/core` built, and `test:scripts` runs
before the build and refuses a file outside its manifest, so they live in
`barwise/scripts/tests-built/adr-model.test.mjs`, outside `test:scripts`.
They cover: the schema validates clean; each of the five probes the
prototype ran (all but the conflict), planted in a fixture tree built by
the shared `architecture-repo.mjs`, gives the model and the matching gate
the same exit code, with the model's diagnostic naming the planted fact
type and instance in its message (`ruleId` alone cannot tell four
mandatory constraints apart); a skip-only decision and an unread report
give both exit 2; a missing input and an unbuilt core give the model 2.
The real tree is not a unit-test case: the reports it needs are written by
the test steps, so it is checked by WS2's CI step.

### 2. Run it in CI

Two ci.yml steps under the `docs_only` guard: `npm run test:adr-model`
after `npm run build`, so the probes and the drift cases run on every code
change; and `npm run check:adr-model` after `check:adr-tests`, so the
real tree is checked against the reports the test steps wrote. Nothing
declares either in an ADR yet.

### 3. The package graph as facts (provisional: not yet grounded)

`Package depends on Package` from each package's runtime `dependencies`
(the read `check:architecture` makes), and `Package may depend on Package`
from `INTENDED`, with a subset constraint between them. Grounding question:
whether the model should read the import graph as depcruise sees it, which
`package-graph-authority#intended-is-graph` is about, rather than
manifests, which `#runtime-deps-within` is about.

### 4. The capability matrix as facts (provisional: not yet grounded)

`Surface registers Tool` from the registrations and `Surface reaches
Capability` from the root `CLAUDE.md` matrix, with an equality constraint
through a `Tool serves Capability` mapping. That mapping exists nowhere
today (barwise-1005, barwise-xpt), so this workstream starts by deciding
where it is declared.

### 5. Relations between decisions (provisional: not yet grounded)

Conflicts and restatements (barwise-ym8.gc9's notes) as declared facts,
with the prototype's ring constraints (irreflexive, symmetric) on
"Decision conflicts with Decision", and queries over the model: which
decisions a gate holds, which lose their enforcer if it goes. No gate
states these, so they are the first rules the model holds alone, and the
first that need a probe of their own rather than a drift case. Grounding
question: where the relations are declared (Open decisions).

## API and migration impact

- No package API changes. The model uses `@barwise/core`'s public
  `ValidationEngine` and serializer.
- WS2 adds one CI step; it fails only on a governance violation, which
  `check:architecture` or `check:adr-tests` would already fail on.

## Open decisions (for review)

- **Retiring overlapping gate branches.** After the model has run clean in
  CI, the branches of `check:architecture` and `check:adr-tests` that it
  states could go, leaving the model as the one statement. Recommended:
  decide after it has run beside them for a release cycle, with the drift
  test showing they never disagreed.
- **Where relations between decisions are declared (WS5).** A small
  `barwise/docs/adr/relations.yaml` (no ADR grammar change; recommended
  for a first cut), or a header field such as `Conflicts-with:` in each
  ADR (the relation lives beside the decision, but it changes the entry
  grammar).
- **The command's name.** `check:adr-model` (recommended: declarable as a
  gate later) or `audit:adr-model`.
- **Where the schema lives.** `barwise/docs/adr/governance.orm.yaml`,
  beside what it models (recommended), or under `barwise/scripts/`.
