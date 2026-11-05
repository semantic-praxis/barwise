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
barwise/package.json, package.json, .github/workflows/ci.yml,
barwise/packages/core/src/validation/Diagnostic.ts, barwise/packages/core/src/validation/rules/population/,
barwise/packages/core/tests/validation/

## Principle

The rules that govern the ADRs are relations between decisions, gates,
tests and gap issues, with constraints over them: what an ORM model
states. Since #910 the two gates that hold them read the repository through
`scripts/lib/adr-facts.mjs` and judge through `scripts/lib/adr-judge.mjs`.
This spec moves the relational rules out of that judge into a barwise
schema whose constraints verbalize as plain sentences and are checked by
core's own population validation.

The rules are of two kinds, and the schema does different work for each.
A **fact rule** is decided by the schema from plain facts: an entry lists
an id its ADR has, every decision has an entry, the named script is in
`package.json`, the named issue is tracked and open, a tag names a decision
that exists, a meta gate vouches only for its own ADRs (`META_GATES` read
as facts). For these the schema becomes the one statement. A **verdict
rule** is decided by code the two judges share: whether a script is a
gate name (`gateName`), whether a step qualifies (`stepVerdict`, with
`guard`), whether a decision is proven (`evidenceVerdict`). The schema
states only that the verdict must hold; the deciding logic stays one
function in `adr-judge.mjs`. So comparing the two judges tests the fact
rules independently and the verdict rules only for their wiring: a bug in
`guard` moves both judges the same way, and WS3's record says so rather
than counting it as agreement.

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

Each relational rule is one constraint with an explicit id, its `RULES`
id; most are a pair of fact types, an obligation and its satisfaction,
with a subset constraint from the first to the second. A diagnostic maps
back to its rule by its `elementId`, which core sets in two ways: subset
and external uniqueness violations carry `constraintRef(c)` and mandatory
ones `c.id ?? ft.id`, both the constraint's id when the schema gives one,
which it always does; internal uniqueness, value, frequency and ring
violations carry the population's id. So a rule stated in one of the
second forms (enforceable-adr-practice's "no issue named by two entries"
is a uniqueness) owns its fact type, and `check-adr-model.mjs` reads the
population-to-rule map from the schema. "Gate G must have a qualifying step" is populated only for a
gate whose steps `stepVerdict` could read; "G has a qualifying step" only
when it found one. "Decision D must be proven" is populated only when
`evidenceVerdict` answered; "D is proven" only for a passing tag. Coverage
("every decision has an entry") uses the declarations themselves, which
the reader always answers.

Which instance violates a rule is the subject the comparison needs, and
core's `Diagnostic` does not carry it: the violating tuple is only in the
prose message, joined with ", ", which an entry's own text can contain.
WS3 adds an optional `instance` field to population diagnostics in core,
the violating tuple's values in role order. It is additive, pure, and the
one package change in this spec. The builder also gives every subject an
opaque id (`entry:<adr>:<n>`) and keeps the map back to the subject, so
nothing reads a message.

Every diagnostic `check-adr-model.mjs` sees is classified, and none is
dropped. It first validates the schema alone and sets those diagnostics
aside (the schema's own completeness warnings); of the rest, a violation
of a `RULES` constraint is a finding, and anything else is a refusal ("the
population could not be judged: ..."), exit 2. That covers a population
that names a fact type or role the schema lacks: `graphOf` fails, no
population rule runs, and `ValidationEngine` returns reference
diagnostics, never an empty list that would read as a pass. It also covers
the schema's structural constraints (the uniqueness and identifiers a
valid schema needs), which the builder cannot break because it writes
facts as sets. A broken one is a builder bug, so it is a refusal, not a
finding the code judge never makes. Those constraints' ids are listed in
`STRUCTURAL` beside `RULES`.

The code judge's one whole-ADR short-circuit is the absent header: it
`continue`s past every rule for that ADR. The builder writes no facts for
such an ADR, so the model reports nothing the code judge cut short there.
Well-formedness findings come from `wellFormed`, which both judges call,
and are compared as they are.

The builder asks every question its facts need, so it can ask what the
code judge skips after a short-circuit (an entry whose script is not a gate
name is never looked up in `package.json`). Those questions arise only for
a subject the code judge has already given a finding or a refusal, so an
extra refusal they produce always sits beside one, and the exit code cannot
differ: a finding is exit 1 for both, and refusals alone are exit 2 for
both. Their order can differ: the reader refuses an unreadable file once,
at the first ask, and the builder asks sooner than the code judge does (an
entry that is not a gate name followed by a `none` entry puts the
tracker's refusal first for the code judge and `package.json`'s first for
the builder). The comparison therefore requires the same exit code and the
code judge's refusals to be a subset of the model's as a set, with any
extra refusal either for a file the code judge never asked for or a step
or evidence refusal on such a subject. `check:adr-model` prints its
refusals in its own order.

## How are two judges compared when one short-circuits? (resolved: every code finding, and the model's extras shadowed)

The code judge stops at the first failing rule of a chain (a script that is
not a gate name is never looked up in `package.json`), but not of every
entry: an entry can carry both "lists an id no decision has" and "is not a
gate name". The model checks every constraint. So the comparison runs per
subject (an entry, a decision, an ADR, a report tag): every (subject, rule)
the code judge reports is reported by the model too, and every (subject,
rule) the model reports beyond those is shadowed: the code judge reported a
lower-ranked rule of the same chain on the same subject. WS2 records each
rule's chain (the rules one `continue` cuts short; a rule that stops
nothing is a chain of one) and its rank, its order in today's loop. A model
finding in a chain where the code judge reported nothing is a
disagreement, not a shadow. `check:adr-model` prints the code judge's view:
the model's violations not shadowed in their chain.

The model judges in two scopes, the declarations and the evidence. Each is
compared with the code judge's function for that scope, not with the
gate's exit code: `check:architecture` also fails on `INTENDED`, ADR
references and a stale generated section, none of which the model judges.
The declarations scope is compared with `judgeDeclarations`' problems and
refusals; the evidence scope with `readTestReports`' refusals followed by
`judgeTestedDecisions`' findings and refusals. Each scope's exit is
derived from its findings and refusals under the rule the gates share:
any finding is exit 1, refusals alone are 2. `check:adr-model`'s one exit
code combines the two scopes the same way.

Each judge gets its own reader, because a reader pushes each unreadable
input's refusal once, into the list it was built with, at the first ask: a
reader shared between the two judges would hand that refusal to whichever
asked first. In the tests, one stub's answers back two readers;
`check:adr-model` builds its own reader on the real tree.

## What keeps the schema and the code judge stating the same rules? (resolved: shared rule ids)

WS2 gives each relational rule of the code judge an id in a `RULES` table
in `adr-judge.mjs`, attached with its subject instance to the finding it
produces (the message text is unchanged), and the kind of each rule (fact
or verdict). The schema names each constraint by the same id. A test
asserts that `RULES` and `STRUCTURAL` together equal the schema's
constraint ids, and the WS3 tests plant one violation per `RULES` id,
enumerated from `RULES`, so a rule added to either side without the other
fails. This replaces the hand-kept rules table of the previous draft,
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
  each violated rule not shadowed in its chain, by id and the instance
  that violates it; exit 1 on any finding, 2 on refusals alone, an
  unbuilt core, or any diagnostic that is not a `RULES` violation and was
  not in the schema's own.
- When the WS3 comparison runs one input through both judges, each with
  its own reader, each scope shall reach the same exit code as the code
  judge's function for it; every (subject, rule id) that function reports
  shall be among the model's, and the model's others shall be shadowed in
  their chain as above; and its refusals shall be a subset of the model's
  as a set, any extra as above.
- When `RULES` with `STRUCTURAL` and the schema's constraint ids differ,
  or a `RULES` id has no planted case, the tests shall fail naming the id.
- When a population diagnostic is a violation, it shall carry the
  violating tuple in `instance`.
- When the schema alone is validated, it shall have no error; when barwise
  verbalizes it, each constraint shall read as one sentence.

Out of scope:

- Behavioural decisions (core does no I/O, the same input gives the same
  output). They keep their gates and tests.
- Code-level facts (the package graph, the capability matrix): WS5 and
  WS6, provisional.
- Writing the population to disk; it is built per run and never committed.

## Inventory

| Code today (main, after #910)                                                                                                                                                                                                                  | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adr-facts.mjs`: `createGovernanceReader` (`scripts()`, `steps(command)`, `issues()`, each `null` when unreadable), `readTestReports` (`unreadable` fixed at read time)                                                                        | used as is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `adr-judge.mjs` `judgeDeclarations`: well-formedness (header, parse, ids, empty Decision), relations (ids exist, coverage, gate name, meta gate, script exists, step qualifies, issue tracked, issue open), and the inline step classification | WS2: `wellFormed`, `stepVerdict`, `RULES` ids and ranks extracted, no behaviour change                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `adr-judge.mjs` `judgeTestedDecisions`: stale tags, and the inline evidence classification (passed, failed, skipped, unread)                                                                                                                   | WS2: `evidenceVerdict` extracted; stale tags become a relational rule with an id                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| core population validation                                                                                                                                                                                                                     | uniqueness, mandatory, disjunctive mandatory, exclusive-or, subset, equality, exclusion, ring, value, value-comparison, frequency, cardinality and join-path constraints, run only when `graphOf` resolves the model (reference diagnostics otherwise); a diagnostic carries `severity`, `message`, `ruleId` and `elementId` and no violating tuple; `elementId` is `constraintRef(c)` for subset and external uniqueness, `c.id ?? ft.id` for mandatory, and the population's id for internal uniqueness, value, frequency and ring. WS3 adds `instance` |
| `run-script-tests.mjs`                                                                                                                                                                                                                         | runs before the build and has no single-file mode, and treats a manifest file it did not run as gone; WS3 adds `--only <file>`, which holds only that file to its manifest count and refuses `--write`                                                                                                                                                                                                                                                                                                                                                    |
| `META_GATES`                                                                                                                                                                                                                                   | WS3 adds `check:adr-model` with no declaring ADR, like `check:adr-tests`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## Target architecture

```
adr-facts.mjs        reader (#910): scripts(), steps(command), issues(),
                     readTestReports()
adr-judge.mjs        wellFormed(adr), stepVerdict(steps), evidenceVerdict(..)
                     RULES: { id, kind, chain, rank, subject } per rule
                     STRUCTURAL: the schema's other constraint ids
                     the code judge: wellFormed + verdicts + rules as code
adr-population.mjs   build(adrs, reader, reports) -> { facts, refusals }
                     wellFormed + verdicts, then one fact per answer,
                     obligation facts only where a verdict answered
governance.orm.yaml  one constraint per RULES id, named by it
check-adr-model.mjs  population -> ValidationEngine -> every diagnostic
                     classified (finding, refusal, schema's own) ->
                     violations not shadowed in their chain -> 0 / 1 / 2
core (WS3)           population diagnostics gain `instance`
```

## Alternatives considered

- **Hold the two judges to the same output on fixture repositories.** The
  first drafts. Rejected by their reviews: fixtures built for the code
  judge make the model fail, and per-rule agreement breaks on the code
  judge's short-circuits. Both judges now take readers over the same
  stubbed answers, one each, and are compared per subject, with shadowing
  by chain.
- **Read the violating instance from core's message.** Rejected: the
  tuple is joined with ", ", which entry text contains, and nothing pins
  the message's wording. An additive `instance` field states it.
- **Decide the verdict rules in the schema too.** Rejected for now: step
  qualification reads `if:` expressions through `shouldRun`, which is code,
  and evidence reads report statuses. Stating them as facts would move the
  same code into the builder. They stay shared functions, and the record
  says the comparison cannot test them.
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
functions and exported; `RULES` gives each relational rule an id, its kind
(fact or verdict), a chain, a rank (its order in today's loop) and its
subject kind; each relational finding
carries its id and subject beside its unchanged message, and the gates print only the
message. Stale tags become a rule with an id. New unit tests pin the three
functions on the cases the gates' tests cover end to end. WS2 starts after
enforceable-adr-practice WS3 (barwise-ym8.gxp.y5o) lands, which the
tracker records as blocking, so its gap-issue rules are in `RULES` from
the start.

### 3. The model as a second judge

The `instance` field in core first, with its own tests and a full build
(a change to core's public API). Then `governance.orm.yaml` (one
constraint per `RULES` id, the structural ones per `STRUCTURAL`),
`adr-population.mjs`, `check-adr-model.mjs`, the `check:adr-model` npm
script and root forwarder, `META_GATES`, and `run-script-tests.mjs --only
<file>`. `adr-model.test.mjs`
drives both judges through a stub reader and stub reports, with no fixture
repository: the clean input; one planted violation per `RULES` id, enumerated from
`RULES`; inputs with two co-occurring violations on one subject; and each
"unknown" case `stepVerdict` and `evidenceVerdict` produce; an ADR with no
header; a population naming a role the schema lacks (a refusal); and a
broken structural constraint (a refusal). The id-set equality needs no
core, since it compares `RULES` and `STRUCTURAL` with the constraint ids
read from the schema file, so it lives in `adr-facts.test.mjs`.
`test:scripts` skips on docs-only changes, but neither side of the
equality is docs-only (`adr-judge.mjs` is code, and the schema is not
Markdown and sits under `docs/adr/`, which `changed-class.mjs` treats as
a gate input), so it runs on every change that can make them differ.
`adr-model.test.mjs` skips without
`@barwise/core` built, so two ci.yml steps run it for real after the build:
`npm run test:scripts -- --only adr-model.test.mjs`, and `npm run
check:adr-model` after `check:adr-tests`, which judges the real tree. Any
rule the code judge gains later joins the schema in the same change,
because the id-set test fails until it does. WS3's record counts
disagreements by rule kind: agreement on a fact rule is evidence about
the schema; agreement on a verdict rule is evidence only that the verdict
is wired through.

### 4. The model becomes the judge of the relational rules (provisional)

The fact rules' code leaves `adr-judge.mjs`; the gates keep
`wellFormed` and the verdict functions, and judge the rest through the model. Starts
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

- One package API change: WS3 adds the optional `instance` field to
  core's population diagnostics, additive and deterministic, so every
  existing consumer is unaffected. WS3 otherwise uses `@barwise/core`'s
  public `ValidationEngine` and serializer.
- WS2 changes no output. WS3 adds two CI steps and a `--only` option. WS4
  changes which code judges the relational rules and, by the Open decision,
  where CI runs that judgment; the owner approves it before it starts.

## Open decisions (for review)

- **Where WS4's judgment runs.** The relational rules include the gap-issue
  rules, which a tracker-only change breaks, and a tracker-only change is
  docs-only, so a step after `npm run build` (which docs-only skips) would
  stop checking them exactly then. Recommended: the declaration scope
  (`check:adr-model -- --scope declarations`) gets its own unguarded step that builds `@barwise/core` alone first
  (`npm run build --workspace=@barwise/core`), so every change is judged.
  The evidence scope stays guarded beside the steps that write the test
  reports: a docs-only change writes none, so it could only refuse there,
  and the gap-issue rules are all declaration rules.
  Rejected: keeping the code rules for docs-only changes, which is two
  statements of each rule forever.
- **How long WS3 runs before WS4.** Recommended: one release cycle with no
  disagreement in CI.
- **The command's name and the schema's home.** The spec is written with
  `check:adr-model`, never declarable, and
  `barwise/docs/adr/governance.orm.yaml`; `audit:adr-model` or a schema
  under `barwise/scripts/` are renames.
