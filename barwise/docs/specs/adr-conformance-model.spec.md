# ADR conformance as an ORM model

Status: Draft -- no workstream implemented

Created: 2026-11-04
Last-updated: 2026-11-04
Tracking: barwise-ym8.z9g (follows docs/specs/enforceable-adr-practice.spec.md)
Touches: barwise/scripts/check-architecture.mjs, barwise/scripts/check-adr-tests.mjs,
+barwise/scripts/lib/adr-facts.mjs, +barwise/scripts/lib/adr-judge.mjs,
+barwise/docs/adr/governance.orm.yaml, +barwise/scripts/check-adr-model.mjs,
+barwise/scripts/tests/adr-facts.test.mjs, +barwise/scripts/tests/adr-model.test.mjs,
barwise/scripts/lib/adr-enforcement.mjs, barwise/scripts/run-script-tests.mjs,
barwise/scripts/tests/expected-counts.json, barwise/spec-status-baseline.json,
barwise/package.json, package.json, .github/workflows/ci.yml

## Principle

The rules that govern the ADRs are relations between decisions, gates,
tests and gap issues, with constraints over them: what an ORM model
states. Today they live as hand-written branches in `check:architecture`
and `check:adr-tests`, where reading the repository and judging it happen
in the same loop. This spec separates the two, then moves the relational
rules into a barwise schema whose constraints verbalize as plain sentences
and are checked by core's own population validation, until the schema is
their one statement.

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
gates do while reading. The staged path: first each gate is split into a
reader that answers questions about the repository and a judge that
applies rules to the answers, with no change in behaviour (WS1); then the
model judges the same answers beside the existing judge, compared fact set
by fact set (WS2); then the model becomes the judge of the relational rules
(WS3), after the owner reviews WS2's record.

Two risks stay, and are why WS3 waits for evidence. The model sees only
what the reader answered, so a reader bug blinds both judges alike; and
barwise judging barwise's own governance is circular, so a regression in
core's population validation would silence it. The guard for the second is
that the model's tests run in CI against the built core.

## Who decides "could not answer"? (resolved: the reader)

Population validation has two outcomes, holds or violated; the gates have
three. A rule cannot be judged when the facts it needs are unknown: a
tested decision whose tagged tests all skipped, or whose passing test may
be in an unread report; a gate whose `ci.yml` guard cannot be read. So the
reader, not the judge, decides when a fact is unknown, and reports it as
"unknown" rather than as true or false. Both judges then skip the rules
that need an unknown fact, and the gate reports the refusal. Because the
reader decides once, the two judges cannot disagree about it. Exit
precedence stays what both gates do today: any finding is exit 1, and
refusals alone are exit 2.

## What the prototype showed

A scratch prototype (2026-11-04) built a schema of these rules, generated
its population from the real tree through the gates' parsers, and
validated it with `barwise validate`: the real tree gave exactly 87
errors, each a gap issue without the label of
`enforceable-adr-practice.spec.md` WS3, not yet backfilled; with the
labels supplied it was clean; and six planted violations each gave exactly
one error naming the planted fact. Its extractor re-read `ci.yml` and the
reports on its own, which is the duplication WS1 removes.

## Scope

In scope:

- When `check:architecture`'s declaration pass or `check:adr-tests` runs
  after WS1, it shall read the ADR headers, the root scripts, `ci.yml`,
  the tracker and the test reports only through the reader in
  `adr-facts.mjs`, and every existing test of either gate shall pass
  unchanged, with the same output. The other passes of
  `check:architecture` (graph, references, the generated section) are not
  governance facts and keep their own reads.
- When the reader is asked a question whose input cannot be read, or whose
  answer is unknown, it shall record a refusal naming the input or the
  decision, in the order the questions were asked, and answer "unknown".
- When `check:adr-model` runs, it shall judge the reader's answers against
  `barwise/docs/adr/governance.orm.yaml` with `@barwise/core`, and exit 1
  naming each violated rule by its fact type and the instance that
  violates it; exit 2 on a refusal alone or an unbuilt core, printing no
  pass.
- When the WS2 comparison runs over a fact set, the code judge and the
  model shall reach the same verdict for every rule the Rules table
  assigns to the schema; a fact set that makes them disagree is a test
  failure naming the rule.
- When the schema alone is validated, it shall have no error; when barwise
  verbalizes it, each rule shall read as one sentence.

Out of scope:

- Behavioural decisions (core does no I/O, the same input gives the same
  output). They keep their gates and tests; the facts record only the
  evidence.
- Code-level facts (the package graph, the capability matrix): WS4 and
  WS5, provisional.
- Writing facts or the population to disk. They are produced per run and
  never committed, so they cannot become a second copy of the headers.

## The rules, and where each lives

Every rule the two gates enforce today, read from the code on 2026-11-04,
and where it lives after WS3. "Reader" rules are about whether an input is
well formed; they stay in the reader as findings, because a schema needs
the input parsed before it can state anything about it. "Schema" rules are
relations; they move. Nothing retires unlisted.

| Rule today                                                    | Gate                        | After WS3                                                                                                                              |
| ------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| an ADR has an `Enforced-by:` header                           | architecture                | reader                                                                                                                                 |
| the header parses, and is the last field                      | architecture                | reader                                                                                                                                 |
| the `## Decision` section has a numbered decision             | architecture                | reader                                                                                                                                 |
| a decision has a well-formed `{#id}`                          | architecture                | reader                                                                                                                                 |
| a report's tag names an ADR and id that exist                 | adr-tests                   | reader                                                                                                                                 |
| two decisions of one ADR do not share an id                   | architecture                | schema: uniqueness over (ADR, id)                                                                                                      |
| an entry lists only ids its ADR has                           | architecture                | schema: subset, entry ids within decision ids                                                                                          |
| every decision has an entry                                   | architecture                | schema: disjunctive mandatory                                                                                                          |
| an npm entry's script is `check:*`, `audit:*` or an exception | architecture                | schema: mandatory "Gate is gate-named"                                                                                                 |
| a meta gate is declared only where allowed                    | architecture                | schema: subset, meta declarations within allowed pairs                                                                                 |
| the script exists in `barwise/package.json`                   | architecture                | schema: mandatory "Gate is a root script"                                                                                              |
| the gate has a qualifying `ci.yml` step                       | architecture                | schema: mandatory "Gate has a qualifying CiStep" (the step and guard rules stay in the reader, which answers "qualifies" or "unknown") |
| a `none` issue is in the tracker                              | architecture                | schema: mandatory "GapIssue is tracked"                                                                                                |
| a `none` issue is not closed                                  | architecture                | schema: value constraint                                                                                                               |
| a tested decision has a passing tagged test                   | adr-tests                   | schema: subset, declared tested within proven                                                                                          |
| the label, title and one-to-one rules of enforceable WS3      | architecture, after that WS | schema: mandatory label, equality of title and gap, two uniqueness constraints                                                         |

## Target architecture

```
adr-facts.mjs   createReader(root): answers questions lazily and in the
                order they are asked, so a gate reads only what its rules
                reach and records refusals in today's order:
                  adrs(), decisions(adr), entries(adr),
                  gate(script) -> { gateNamed, meta, rootScript,
                                    qualifies: yes | no | unknown },
                  gapIssue(id) -> { tracked, closed, label, title },
                  evidence(decision) -> proven | failed | none | unknown
                plus readerFindings() and refusals().
adr-judge.mjs   judge(reader) -> findings: today's rules, moved out of the
                two gates unchanged (WS1); its schema rules retire in WS3.
governance.orm.yaml + check-adr-model.mjs
                asks the reader every question, builds the population,
                and runs ValidationEngine (WS2); the judge of the schema
                rules from WS3.
```

## Alternatives considered

- **Run the model beside the gates, held to the same exit codes.** The
  first draft. Rejected by its own review: agreement forced the model to
  absorb the gates' reading logic.
- **One eager read of every fact.** Rejected: today a gate reads
  `barwise/package.json` only for an npm entry that passed the name rules,
  and `ci.yml` only for a script that exists; an eager reader would add
  refusals and reorder them, which WS1 promises not to do.
- **Keep the model advisory.** Rejected by the owner: a second statement
  of the rules that may drift is the must-agree copy
  `docs/adr/must-agree-copies.md` forbids.
- **Replace the gates in one step.** Rejected: the judge would change while
  its reader changed too, and nothing would show which caused a new
  verdict.

## Workstreams (each independently shippable)

### 1. Split each gate into a reader and a judge

No behaviour change. `adr-facts.mjs` takes over every governance read the
declaration pass of `check-architecture.mjs` and all of
`check-adr-tests.mjs` make, keeping their laziness: the judge asks, and the
reader reads only then, memoizing. The skip-only, unread-report and
unreadable-guard decisions move into the reader as "unknown" answers with
their refusal text unchanged. `adr-judge.mjs` holds the rules, reading only
answers. Each gate keeps its order of passes and its exit rule (any
finding is 1, refusals alone are 2). The existing tests of both gates are
the acceptance test and do not change; `adr-facts.test.mjs` pins the
reader alone: an input read only when a question needs it, an unreadable
input a refusal, each "unknown" case, and the order refusals are recorded.

### 2. The model as a second judge, compared fact set by fact set

Lands after `enforceable-adr-practice.spec.md` WS3 (barwise-ym8.gxp.y5o),
whose label and one-to-one rules move into the code judge first.
`governance.orm.yaml` states the schema rows of the table;
`check-adr-model.mjs`, the `check:adr-model` npm script and root forwarder;
and `check:adr-model` added to `META_GATES` with `check:adr-tests`, since
it vouches for every decision (Open decisions). `adr-model.test.mjs` builds
fact sets as a stub reader, with no fixture repository: the clean set, and
one planted violation per schema row, judged by both and required to
agree, the model's diagnostic naming the fact type and instance in its
message (`ruleId` alone cannot tell the mandatory rows apart). It skips
without `@barwise/core` built, so `run-script-tests.mjs` gains
`--only <file>`, which holds one file to its manifest count, and two ci.yml
steps run it for real: `npm run test:scripts -- --only adr-model.test.mjs`
after `npm run build`, and `npm run check:adr-model` after
`check:adr-tests`, which judges the real tree.

### 3. The model becomes the judge of the schema rules

The schema rows' code leaves `adr-judge.mjs`, and the WS2 comparison
retires with it. Because the model needs the built core, the judgment
leaves `check:architecture`, which runs before the build and keeps its
graph, reference and reader-rule passes; the schema rules are judged by
`check:adr-model`, which takes over `check:adr-tests`'s step after the test
reports exist. A changed CI gate, so it starts only after the owner reviews
WS2's record and this step list. When the model asks every question, a
tree can list more refusals than today beside a finding; the exit code
cannot change, because a finding is already exit 1.

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
- WS1 changes no output. WS2 adds two CI steps and a `--only` option.
  WS3 moves the schema rules from `check:architecture` and
  `check:adr-tests` into `check:adr-model`, which is a change to CI gates
  the owner approves first.

## Open decisions (for review)

- **How long WS2 runs before WS3.** Recommended: one release cycle with no
  disagreement in CI.
- **Whether `check:adr-model` may be declared.** Recommended: never, like
  `check:adr-tests`, since it vouches for every decision; the spec is
  written that way.
- **The command's name and the schema's home.** The spec is written with
  `check:adr-model` and `barwise/docs/adr/governance.orm.yaml`
  (recommended: declarable later as a gate, and beside what it models);
  `audit:adr-model` or a schema under `barwise/scripts/` are renames.
