# ADR conformance as an ORM model

Status: WS1 implemented 2026-11-04 by docs/specs/adr-gate-reader-split.spec.md (#910); WS2-WS6 not started.

Created: 2026-11-04
Last-updated: 2026-11-04
Tracking: barwise-ym8.z9g (follows docs/specs/adr-gate-reader-split.spec.md)
Touches: barwise/scripts/lib/adr-judge.mjs, barwise/scripts/check-architecture.mjs,
barwise/scripts/check-adr-tests.mjs, +barwise/scripts/lib/adr-population.mjs,
+barwise/docs/adr/governance.orm.yaml, +barwise/scripts/check-adr-model.mjs,
+barwise/scripts/tests/adr-model.test.mjs, barwise/scripts/tests/adr-facts.test.mjs, barwise/scripts/lib/adr-enforcement.mjs,
barwise/scripts/run-script-tests.mjs, barwise/scripts/tests/expected-counts.json,
barwise/package.json, package.json, .github/workflows/ci.yml

## Principle

The rules that govern the ADRs are relations between decisions, gates,
tests and gap issues, with constraints over them: what an ORM model
states. Since #910 the two gates that hold them read the repository through
`scripts/lib/adr-facts.mjs` and judge through `scripts/lib/adr-judge.mjs`.
This spec moves the relational rules out of that judge into a barwise
schema whose constraints verbalize as plain sentences and are checked by
core's own population validation, until the schema is their one statement.

The principles at stake are **explicit over implicit** (the rules become a
declared, reviewable schema rather than code paths), **determinism in
core** (judging is core's pure population check; reading stays in
`barwise/scripts/`), and **orthogonality** (the reader, the classification
of its answers, and the rules are three concerns).

## Should the model replace the gates? (resolved: yes, in stages)

The owner chose this on 2026-11-04 (option C, aiming at A), and then chose
to build the reader first as its own spec, after three plan reviews of this
spec failed on predictions about a reader that did not exist. It now
exists. The stages: share what decides "could not answer" and name each
rule (WS2, no behaviour change); run the model as a second judge beside
the code judge, compared case by case (WS3); then make the model the judge
of the relational rules (WS4), after the owner reviews WS3's record.

## How do the two judges agree on "could not answer"? (resolved: one classifier, called by both)

Population validation has two outcomes; the gates have three. In today's
judge the third comes from two decisions made inline: whether a declared
gate's steps qualify, cannot be read, or fail (`unreadable`, `why` in
`judgeDeclarations`), and whether a tested decision is proven, failed,
skipped, unproven, or unknown because a report was not read (in
`judgeTestedDecisions`). WS2 lifts both into exported functions,
`stepVerdict` and `evidenceVerdict`, each returning its kind and the exact
finding or refusal text the judge prints today, so no caller rebuilds a
message. The code judge calls them unchanged; the population builder calls
the same two. For a case either answers "unknown", the builder records the
returned refusal and leaves out the obligation fact the rule constrains
(below), so the model cannot report a finding there.

Each relational rule is a pair of fact types: an obligation and its
satisfaction, with a subset constraint from the first to the second, and
each rule has its own obligation fact type, so a diagnostic maps back to its
rule by the fact type (or population) it names. Core's diagnostics name
the constraint's own id only for mandatory constraints; uniqueness, ring
and subset violations name the population, which is why the mapping goes
by fact type. "Gate G must have a qualifying step" is populated only for a
gate whose steps `stepVerdict` could read; "G has a qualifying step" only
when it found one. "Decision D must be proven" is populated only when
`evidenceVerdict` answered; "D is proven" only for a passing tag. Coverage
("every decision has an entry") uses the declarations themselves, which
the reader always answers.

The builder asks every question its facts need, so it can ask what the
code judge skips after a short-circuit (an entry whose script is not a gate
name is never looked up in `package.json`). Those questions arise only for
a subject the code judge has already given a finding or a refusal, so an
extra refusal they produce always sits beside one, and the exit code cannot
differ: a finding is exit 1 for both, and refusals alone are exit 2 for
both. The comparison therefore requires the same exit code and the code
judge's refusals to be a subset of the model's, in the same relative order,
with any extra refusal only on such a subject.

## How are two judges compared when one short-circuits? (resolved: every code finding, and the model's extras shadowed)

The code judge stops at the first failing rule of a chain (a script that is
not a gate name is never looked up in `package.json`), but not of every
entry: an entry can carry both "lists an id no decision has" and "is not a
gate name". The model checks every constraint. So the comparison runs per
subject (an entry, a decision, an ADR, a report tag): every (subject, rule)
the code judge reports is reported by the model too, and every (subject,
rule) the model reports beyond those ranks after one the code judge
reported on the same subject, in the code judge's rule order, which WS2
records as each rule's rank. `check:adr-model` prints the code judge's view:
of the model's violations for one subject, those not shadowed by a
lower-ranked one in the same chain.

The model judges in two scopes, the declarations (`check:architecture`'s
relational rules) and the evidence (`check:adr-tests`'s), each compared
with its own gate. Its one exit code is the two scopes' under the rule both
gates already share: any finding is exit 1, refusals alone are 2.

## What keeps the schema and the code judge stating the same rules? (resolved: shared rule ids)

WS2 gives each relational rule of the code judge an id in a `RULES` table
in `adr-judge.mjs`, attached to the finding it produces (the message text
is unchanged). The schema names each constraint by the same id. A WS3 test
asserts the two id sets are equal, and plants one violation per id
enumerated from `RULES`, so a rule added to either side without the other
fails it. This replaces the hand-kept rules table of the previous draft,
which nothing checked. Well-formedness rules (a header that parses, a
decision with an id) are not relations: they stay code, in one
`wellFormed` function both judges call, and carry no schema id.

## Scope

In scope:

- When WS2 lands, both gates' stdout, stderr and exit codes shall be what
  they were, on every tree the existing tests build and on the real tree;
  `stepVerdict`, `evidenceVerdict` and `wellFormed` shall be exported from
  `adr-judge.mjs` and called by the code judge, and every finding it makes
  for a relational rule shall carry an id from `RULES`.
- When `check:adr-model` runs, it shall build the population from the
  reader's answers through `adr-population.mjs`, validate it against
  `barwise/docs/adr/governance.orm.yaml` with `@barwise/core`, and report
  for each subject the lowest-ranked violated rule, by id and the instance
  that violates it; exit 1 on any finding, 2 on refusals alone or an
  unbuilt core.
- When the WS3 comparison runs one input through both judges, each scope
  shall reach the same exit code as its gate; every (subject, rule id) its
  gate reports shall be among the model's, and the model's others shall be
  shadowed as above; and the gate's refusals shall be a subset of the
  model's, in the same relative order, any extra on a subject the gate
  already flagged.
- When `RULES` and the schema's constraint ids differ, or a `RULES` id has
  no planted case, the WS3 tests shall fail naming the id.
- When the schema alone is validated, it shall have no error; when barwise
  verbalizes it, each constraint shall read as one sentence.

Out of scope:

- Behavioural decisions (core does no I/O, the same input gives the same
  output). They keep their gates and tests.
- Code-level facts (the package graph, the capability matrix): WS5 and
  WS6, provisional.
- Writing the population to disk; it is built per run and never committed.

## Inventory

| Code today (main, after #910)                                                                                                                                                                                                                  | Verdict                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adr-facts.mjs`: `createGovernanceReader` (`scripts()`, `steps(command)`, `issues()`, each `null` when unreadable), `readTestReports` (`unreadable` fixed at read time)                                                                        | used as is                                                                                                                                                                                                                                                                                   |
| `adr-judge.mjs` `judgeDeclarations`: well-formedness (header, parse, ids, empty Decision), relations (ids exist, coverage, gate name, meta gate, script exists, step qualifies, issue tracked, issue open), and the inline step classification | WS2: `wellFormed`, `stepVerdict`, `RULES` ids and ranks extracted, no behaviour change                                                                                                                                                                                                       |
| `adr-judge.mjs` `judgeTestedDecisions`: stale tags, and the inline evidence classification (passed, failed, skipped, unread)                                                                                                                   | WS2: `evidenceVerdict` extracted; stale tags become a relational rule with an id                                                                                                                                                                                                             |
| core population validation                                                                                                                                                                                                                     | uniqueness, mandatory, disjunctive mandatory, subset, equality, exclusion, ring and value constraints; diagnostics carry `message`, `ruleId` and `elementId`, which is the constraint's own id only for a mandatory constraint and the population for uniqueness, ring and subset violations |
| `run-script-tests.mjs`                                                                                                                                                                                                                         | runs before the build and has no single-file mode; WS3 adds `--only <file>`, held to the manifest count                                                                                                                                                                                      |
| `META_GATES`                                                                                                                                                                                                                                   | WS3 adds `check:adr-model` with no declaring ADR, like `check:adr-tests`                                                                                                                                                                                                                     |

## Target architecture

```
adr-facts.mjs        reader (#910): scripts(), steps(command), issues(),
                     readTestReports()
adr-judge.mjs        wellFormed(adr), stepVerdict(steps), evidenceVerdict(..)
                     RULES: { id, rank, subject } per relational rule
                     the code judge: wellFormed + verdicts + rules as code
adr-population.mjs   build(adrs, reader, reports) -> { facts, refusals }
                     wellFormed + verdicts, then one fact per answer,
                     obligation facts only where a verdict answered
governance.orm.yaml  one constraint per RULES id, named by it
check-adr-model.mjs  population -> ValidationEngine -> lowest-ranked
                     violation per subject -> exit 0 / 1 / 2
```

## Alternatives considered

- **Hold the two judges to the same output on fixture repositories.** The
  first drafts. Rejected by their reviews: fixtures built for the code
  judge make the model fail, and per-rule agreement breaks on the code
  judge's short-circuits. Both judges now take the same reader, stubbed
  in the tests, and compare first findings.
- **Let the model own "could not answer".** Rejected: population
  validation has no third outcome, and a second classifier would be a
  must-agree copy. One classifier, called by both.
- **A hand-kept table of which rule lives where.** The previous draft.
  Rejected by its review as an unchecked copy; shared ids and a set test
  replace it.
- **Keep the model advisory.** Rejected by the owner.

## Workstreams (each independently shippable)

### 1. Split each gate into a reader and a judge (done)

Built by `docs/specs/adr-gate-reader-split.spec.md` (barwise-ym8.pw0,
#910).

### 2. Shared verdicts and rule ids, in the code judge

No behaviour change, on the same terms as #910: the existing tests and a
before-and-after diff of both gates on the real tree. `wellFormed`,
`stepVerdict` and `evidenceVerdict` are extracted from the two judge
functions and exported; `RULES` gives each relational rule an id, a rank
(its order in today's loop) and its subject kind; each relational finding
carries its id beside its unchanged message, and the gates print only the
message. Stale tags become a rule with an id. New unit tests pin the three
functions on the cases the gates' tests cover end to end.

### 3. The model as a second judge

`governance.orm.yaml` (one constraint per `RULES` id), `adr-population.mjs`,
`check-adr-model.mjs`, the `check:adr-model` npm script and root forwarder,
`META_GATES`, and `run-script-tests.mjs --only <file>`. `adr-model.test.mjs`
drives both judges through a stub reader and stub reports, with no fixture
repository: the clean input; one planted violation per `RULES` id, enumerated from
`RULES`; inputs with two co-occurring violations on one subject; and each
"unknown" case `stepVerdict` and `evidenceVerdict` produce. The id-set
equality needs no core, since it compares `RULES` with the constraint ids
read from the schema file, so it lives in `adr-facts.test.mjs`, which
`test:scripts` runs on every tree. It skips without
`@barwise/core` built, so two ci.yml steps run it for real after the build:
`npm run test:scripts -- --only adr-model.test.mjs`, and `npm run
check:adr-model` after `check:adr-tests`, which judges the real tree. Rules
the code judge gains meanwhile (enforceable-adr-practice WS3, barwise-ym8.gxp.y5o)
join the schema in the same change, because the id-set test fails until
they do.

### 4. The model becomes the judge of the relational rules (provisional)

The relational rules' code leaves `adr-judge.mjs`; the gates keep
`wellFormed` and the verdicts and judge relations through the model. Starts
after the owner reviews WS3's record (how long both judges ran in CI, and
whether they ever disagreed) and decides where the judgment runs (Open
decisions), because the model needs the built core and `check:architecture`
runs before the build on every change, docs-only ones included.

### 5. The package graph as facts (provisional: not yet grounded)

`Package depends on Package` and `Package may depend on Package` from
`INTENDED`, with a subset constraint; whether the facts come from manifests
(`#runtime-deps-within`) or the import graph (`#intended-is-graph`).

### 6. The capability matrix and relations between decisions (provisional: not yet grounded)

`Surface registers Tool` against `Surface reaches Capability`, which needs
a `Tool serves Capability` mapping that exists nowhere (barwise-1005,
barwise-xpt); and conflicts and restatements between decisions
(barwise-ym8.gc9), the first rules no gate states today.

## API and migration impact

- No package API changes. WS3 uses `@barwise/core`'s public
  `ValidationEngine` and serializer.
- WS2 changes no output. WS3 adds two CI steps and a `--only` option. WS4
  changes which code judges the relational rules and, by the Open decision,
  where CI runs that judgment; the owner approves it before it starts.

## Open decisions (for review)

- **Where WS4's judgment runs.** The relational rules include the gap-issue
  rules, which a tracker-only change breaks, and a tracker-only change is
  docs-only, so a step after `npm run build` (which docs-only skips) would
  stop checking them exactly then. Recommended: `check:adr-model` gets its
  own unguarded step that builds `@barwise/core` alone first
  (`npm run build --workspace=@barwise/core`), so every change is judged.
  Rejected: keeping the code rules for docs-only changes, which is two
  statements of each rule forever.
- **How long WS3 runs before WS4.** Recommended: one release cycle with no
  disagreement in CI.
- **The command's name and the schema's home.** The spec is written with
  `check:adr-model`, never declarable, and
  `barwise/docs/adr/governance.orm.yaml`; `audit:adr-model` or a schema
  under `barwise/scripts/` are renames.
