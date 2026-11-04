# ADR conformance as an ORM model

Status: Draft -- no workstream implemented

Created: 2026-11-04
Last-updated: 2026-11-04
Tracking: barwise-ym8.z9g (follows docs/specs/enforceable-adr-practice.spec.md)
Touches: barwise/scripts/check-architecture.mjs, barwise/scripts/check-adr-tests.mjs,
+barwise/scripts/lib/adr-facts.mjs, +barwise/scripts/lib/adr-judge.mjs,
+barwise/docs/adr/governance.orm.yaml, +barwise/scripts/check-adr-model.mjs,
+barwise/scripts/tests/adr-facts.test.mjs, +barwise/scripts/tests/adr-model.test.mjs,
barwise/scripts/lib/adr-enforcement.mjs, barwise/scripts/tests/expected-counts.json,
barwise/package.json, package.json, .github/workflows/ci.yml

## Principle

The rules that govern the ADRs are relations between decisions, gates,
tests and gap issues, with constraints over them: what an ORM model
states. Today they live as hand-written branches in `check:architecture`
and `check:adr-tests`, where reading the repository and judging it happen
in the same loop. This spec separates the two, then moves the judging into
a barwise schema whose constraints verbalize as plain sentences and are
checked by core's own population validation, until the schema is the one
statement of the rules.

The principles at stake are **explicit over implicit** (the rules become a
declared, reviewable schema rather than code paths), **determinism in
core** (judging is core's pure population check; reading the repository
is I/O and stays in `barwise/scripts/`), and **orthogonality** (reading
and judging stop being one concern).

## Should the model replace the gates? (resolved: yes, in stages)

The owner chose this on 2026-11-04, over keeping the model advisory and
over making it the authority in one step. A first draft ran the model
beside the gates and held the two to the same exit codes; its review
found that the agreement forced the model to re-implement everything the
gates do while reading -- which `ci.yml` step counts as a gate, how a
finding and a refusal rank, how fixtures are built -- until the
constraints restated conclusions the extractor had already reached. The
staged path removes that: first the gates are split into a reader that
produces facts and a judge that applies rules to them, with no change in
behaviour (WS1); then the model judges the same facts beside the existing
judge, so the two can be compared fact set by fact set (WS2); then the
model becomes the judge (WS3).

Two risks stay, and are why WS3 waits for evidence. The model sees only
the facts the reader produced, so a reader bug blinds both judges alike;
and barwise judging barwise's own governance is circular, so a regression
in core's population validation would silence it. The guard for the
second is that the probes run in CI against the built core.

## What the prototype showed

A scratch prototype (2026-11-04) built the schema below, generated its
population from the real tree through the gates' parsers, and validated it
with `barwise validate`: the real tree gave exactly 87 errors, each a gap
issue without the label of `enforceable-adr-practice.spec.md` WS3, not
yet backfilled; with the labels supplied it was clean; and six planted
violations each gave exactly one error naming the planted fact. Its
extractor re-read `ci.yml` and the reports on its own, which is the
duplication WS1 removes.

## Scope

In scope:

- When `check:architecture` or `check:adr-tests` runs after WS1, it shall
  read the repository only through `readGovernanceFacts(root)` in
  `adr-facts.mjs` and judge only those facts, and every existing test of
  either gate shall pass unchanged, with the same output.
- When `readGovernanceFacts` cannot read an input it needs, it shall
  return a refusal naming the input, never an empty fact set.
- When `check:adr-model` runs, it shall judge the same facts against
  `barwise/docs/adr/governance.orm.yaml` with `@barwise/core`, and exit 1
  naming each violated rule by its fact type and the instance that
  violates it; exit 2 on a refusal from the reader or an unbuilt core,
  printing no pass.
- When the WS2 comparison runs over a fact set, the existing judge and the
  model shall reach the same verdict for every rule both state; a fact
  set that makes them disagree is a test failure naming the rule.
- When the schema alone is validated, it shall have no error; when barwise
  verbalizes it, each rule shall read as one sentence.

Out of scope:

- Behavioural decisions (core does no I/O, the same input gives the same
  output). They keep their gates and tests; the facts record only the
  evidence (a gate has a qualifying step, a tagged test passed).
- Code-level facts (the package graph, the capability matrix): WS4 and
  WS5, provisional.
- Writing facts or the population to disk. They are produced per run and
  never committed, so they cannot become a second copy of the headers.

## Inventory

| Area                                      | Current state (verified 2026-11-04)                                                                                                                                                    | Verdict                                                                               |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `check-architecture.mjs` declaration pass | one loop over the ADRs that reads `ci.yml`, the tracker and the root scripts lazily and judges each entry inline (about 170 lines)                                                     | WS1: reading moves to `adr-facts.mjs`, judging to `adr-judge.mjs`                     |
| `check-adr-tests.mjs`                     | reads the expected reports and classifies each tagged test, then judges each tested decision                                                                                           | WS1: the same split                                                                   |
| core population validation                | uniqueness, mandatory, disjunctive mandatory, subset, equality, exclusion, ring and value constraints over populations; diagnostics carry `severity`, `message`, `ruleId`, `elementId` | WS2 uses it as is                                                                     |
| `@barwise/core` from a script             | `measure-comparison.mjs` imports it and refuses when it is not built                                                                                                                   | WS2 follows that precedent                                                            |
| `run-script-tests.mjs`, knip              | `test:scripts` runs `scripts/tests/*.test.mjs` before the build; knip's entry covers the same glob                                                                                     | the model's tests live there, skip without `dist`, and also run after the build (WS2) |
| `META_GATES` in `adr-enforcement.mjs`     | `check:adr-tests` undeclarable, `check:architecture` only by `package-graph-authority`, because each would vouch for any decision                                                      | WS2 adds `check:adr-model` beside `check:adr-tests`                                   |

## Target architecture

```
adr-facts.mjs   readGovernanceFacts(root) -> { facts, refusals }
                the only reader of ADR headers, ci.yml, the root scripts,
                the tracker and the test reports for these rules. A fact
                is normalized: "gate G has a qualifying ci.yml step" (the
                guard and step rules applied here, once), "gap issue I is
                closed / not closed", "I carries the gap label", "decision
                D's tagged tests: passed / failed / skipped".
adr-judge.mjs   judge(facts) -> findings: today's rules as code, moved
                out of the two gates unchanged (WS1); retired in WS3.
governance.orm.yaml + check-adr-model.mjs
                facts -> population -> ValidationEngine -> findings (WS2);
                the judge from WS3.

check:architecture = its graph and reference passes + judge(facts)
check:adr-tests    = judge(facts) for tested decisions
```

The WS2 schema's rules, each also stated by today's judge:

```
Each decision id is unique within its ADR.     (check:architecture)
Each Decision is held by some Gate, is declared tested, or has gap
  recorded by some GapIssue.                   (header and coverage)
Each declared Gate has a qualifying CiStep.    (check:architecture)
If a Decision is declared tested, some Test proves it.  (check:adr-tests)
Each GapIssue records the gap of at most one Decision.  (enforceable WS3)
Each GapIssue is not closed.                   (check:architecture)
Each GapIssue carries the gap label.           (enforceable WS3)
```

## Alternatives considered

- **Run the model beside the gates, held to the same exit codes.** The
  first draft. Rejected by its own review: agreement forced the model to
  absorb the gates' reading logic, and the drift test could not pass on
  the existing fixtures.
- **Keep the model advisory.** Rejected by the owner: a second statement
  of the rules that may drift is the must-agree copy
  `docs/adr/must-agree-copies.md` forbids.
- **Replace the gates in one step.** Rejected: the judge would change
  while its reader changed too, and nothing would show which caused a new
  verdict.
- **Commit the generated facts.** Rejected: a third copy of the headers.

## Workstreams (each independently shippable)

### 1. Split each gate into a reader and a judge

No behaviour change. `adr-facts.mjs` takes over every read the
declaration pass of `check-architecture.mjs` and all of
`check-adr-tests.mjs` make for these rules, including the lazy loading
(an input is read only when an entry needs it) and the refusals.
`adr-judge.mjs` takes the rules, reading only facts. Each gate keeps its
own exit precedence (`check:architecture`: any finding is 1;
`check:adr-tests`: an unproven decision with a report unread is 2), now
stated beside its call to the judge. The existing tests of both gates are
the acceptance test and do not change; new cases in `adr-facts.test.mjs`
pin the reader alone: each input read only when needed, each unreadable
input a refusal, each fact normalized as above.

### 2. The model as a second judge, compared fact set by fact set

Lands after `enforceable-adr-practice.spec.md` WS3 (barwise-ym8.gxp.y5o),
whose label and one-issue-per-decision rules the schema states.
`governance.orm.yaml`, `check-adr-model.mjs`, the `check:adr-model` npm
script and root forwarder, and `check:adr-model` added to `META_GATES`.
`adr-model.test.mjs` builds fact sets directly, with no fixture repository:
the clean set; one planted violation per rule above, each judged by both
and required to agree, with the model's diagnostic naming the fact type
and instance in its message (`ruleId` alone cannot tell four mandatory
constraints apart). It skips without `@barwise/core` built, like the
`audit-rubric` writer test, so two ci.yml steps run it for real: `node
--test scripts/tests/adr-model.test.mjs` after `npm run build`, and
`npm run check:adr-model` after `check:adr-tests`, which checks the real
tree against the reports the test steps wrote.

### 3. The model becomes the judge

Removes `adr-judge.mjs`'s rule code; both gates judge through the model,
and the WS2 comparison retires with it. One exit precedence for both is
decided here (Open decisions). Starts only after the owner reviews WS2's
record: how long the two judges ran side by side and whether they ever
disagreed.

### 4. The package graph as facts (provisional: not yet grounded)

`Package depends on Package` and `Package may depend on Package` from
`INTENDED`, with a subset constraint. Grounding question: whether the
facts come from manifests (`#runtime-deps-within`) or the import graph
(`#intended-is-graph`).

### 5. The capability matrix and relations between decisions (provisional: not yet grounded)

`Surface registers Tool` against `Surface reaches Capability`, which needs
a `Tool serves Capability` mapping that exists nowhere (barwise-1005,
barwise-xpt); and conflicts and restatements between decisions
(barwise-ym8.gc9), the first rules no gate states today.

## API and migration impact

- No package API changes. WS2 uses `@barwise/core`'s public
  `ValidationEngine` and serializer.
- WS1 changes no output. WS2 adds two CI steps; `check:adr-model` can
  fail only on a rule today's judge also enforces, or refuse where the
  reader refuses. WS3 changes which code decides, not what is decided.

## Open decisions (for review)

- **One exit precedence for WS3.** `check:architecture` lets any finding
  win; `check:adr-tests` refuses an unproven decision while a report is
  unread. Recommended: per decision, a refusal that concerns that
  decision's own evidence wins over a finding about it, and otherwise a
  finding wins -- which is both gates' behaviour today restated as one
  rule.
- **How long WS2 runs before WS3.** Recommended: one release cycle with no
  disagreement in CI.
- **The command's name.** `check:adr-model` (recommended) or
  `audit:adr-model`.
- **Where the schema lives.** `barwise/docs/adr/governance.orm.yaml`,
  beside what it models (recommended), or under `barwise/scripts/`.
