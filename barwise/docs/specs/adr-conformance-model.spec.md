# ADR conformance as an ORM model

Status: WS1 implemented 2026-11-04 by docs/specs/adr-gate-reader-split.spec.md (#910); WS2-WS5 not started.

Created: 2026-11-04
Last-updated: 2026-11-05
Tracking: barwise-ym8.z9g (follows docs/specs/adr-gate-reader-split.spec.md)
Touches: barwise/scripts/lib/adr-judge.mjs, barwise/scripts/check-architecture.mjs,
+barwise/scripts/lib/adr-population.mjs, +barwise/docs/adr/governance.orm.yaml,
+barwise/scripts/check-adr-model.mjs, +barwise/scripts/tests/adr-model.test.mjs,
barwise/scripts/tests/adr-facts.test.mjs, barwise/scripts/lib/adr-enforcement.mjs,
barwise/scripts/tests/expected-counts.json, barwise/package.json, package.json,
.github/workflows/ci.yml

## Principle

Some of the rules that govern the ADRs are relations between plain facts:
an entry lists an id its ADR has, every decision has an entry, a named
script is in `package.json`, a cited issue is tracked and open. That is
what an ORM schema states. This spec moves those rules, and only those,
out of `scripts/lib/adr-judge.mjs` into a barwise schema whose constraints
verbalize as sentences and are checked by core's population validation,
with the repository's facts, read through `scripts/lib/adr-facts.mjs`
(#910), as the population.

The principles at stake are **explicit over implicit** (the rules become
a declared, reviewable schema rather than code paths), **determinism in
core** (judging is core's pure population check; reading stays in
`barwise/scripts/`), and **orthogonality** (the reader, the facts, and the
rules are three concerns).

This plan is written from a prototype, not from predictions. Six reviews
of the earlier drafts each found new ways core's population semantics
differ from the code judge's; the owner chose to prototype (2026-11-05).
The prototype (five rules, a fact builder over the real reader, both
judges on the real tree, sixteen planted cases and three violations
planted into real ADRs) is the evidence for every claim below marked
_(prototype)_.

## Which rules does the model judge? (resolved: the fact rules)

A **fact rule** is decided from facts alone. These move to the schema:

| Rule id                                                                               | Constraint                                                     | Key (the instance a violation names) |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------ |
| `ids-exist`                                                                           | Decision listed by an entry is a decision its ADR has (subset) | decision `<adr>#<id>`                |
| `coverage`                                                                            | Decision an ADR has is listed by some entry (subset)           | decision                             |
| `script-exists`                                                                       | Script an entry names is defined in `package.json` (subset)    | script                               |
| `issue-tracked`                                                                       | Issue an entry cites is in the tracker (subset)                | issue                                |
| `issue-open`                                                                          | Issue an entry cites is open (subset)                          | issue                                |
| enforceable-adr-practice WS3's gap-issue rules (label, title, one issue per decision) | as that spec states them                                       | issue                                |

A **verdict rule** is decided by code that reads something no fact
captures: whether a script is a gate name (`gateName`, `GATE_EXCEPTIONS`),
whether a meta gate may vouch for an ADR (`META_GATES`), whether a ci.yml
step qualifies (`guard` over `shouldRun`), whether a decision is proven
(report statuses). These stay in `adr-judge.mjs`. The builder uses their
answers only to decide which facts to write: an entry whose script fails
the gate-name or meta-gate verdict gets no "names script" fact, exactly as
the code judge never looks that script up. Stale tags, the evidence scope
and the step rule are out of scope here (see Out of scope).

## At what grain are the two judges compared? (resolved: one finding per rule and key)

Core reports a subset violation once per distinct tuple
(`tuplesForRoleSeq` collects a `Set`), so two entries naming the same
missing script are one model violation and two code findings
_(prototype)_. Counting per entry is a property of the code judge's
output, not of the rule. So both judges are compared as **sets of (rule,
key)**, the key being the single value in the table above, and
`check:adr-model` reports each violation with the entries that carry it,
looked up from its own facts.

On that grain the two judges agreed on every case except two, both
short-circuits _(prototype)_:

- An issue not in the tracker is also not open: the code judge reports
  only `issue-tracked`, the model both. `issue-tracked` and `issue-open`
  form a chain, and a model violation is **shadowed** when the code judge
  reported a lower-ranked rule of the same chain on the same key.
- A script that is not a gate name and is also undefined: the code judge
  reports the gate-name finding only. The builder's use of the verdict
  (above) removes this case; the prototype's builder did not yet do so.

Any other difference in the sets is a **disagreement**.

## How is "could not answer" kept? (resolved: the builder leaves the facts out)

Population validation has two outcomes; the gates have three. When the
reader answers `null` for `package.json` or the tracker, the builder
writes no "names script" or "cites issue" fact, so no obligation exists
and the model reports nothing where the code judge refuses; the reader's
own refusal is the answer, as it is for the code judge. Both agreed on
these cases _(prototype)_. An ADR with no `Enforced-by:` header gets no
facts at all, matching the code judge's `continue` _(prototype)_. Each
judge gets its own reader, since a reader pushes each unreadable input's
refusal once, into its own list.

## How do diagnostics map back to rules? (resolved: `idFromPrior`)

Core renames every constraint on load to a name derived from its sentence
(`If_Decision_in_..._then_...`); an id the schema states survives as a
prior id, and `model.idFromPrior(ruleId)` returns the derived name
_(prototype)_. `check-adr-model.mjs` builds the derived-name-to-rule map
once from the loaded schema. Every rule is a subset constraint, whose
`elementId` is `constraintRef(c)`, the derived name.

The key comes from the message, `tuple [<value>] in roles [...]`. Each
rule's subset is over one role, so the tuple is one value and contains no
separator; a test pins that message shape against core, so a change to
it fails a test rather than a parse. Coverage is a subset and not a
mandatory constraint: core checks a mandatory role against every value
that plays any role of the type, so a tag fact naming a decision that
does not exist made the mandatory form report it as uncovered _(prototype)_.

Every diagnostic is classified. The schema is validated alone first and
its own diagnostics (completeness warnings) set aside. Of the rest, a
violation of a mapped rule is a finding; any other error is a refusal
("the population could not be judged"), exit 2, never dropped. Core's
`graphOf` checks a population's fact type but not its role keys, so a
misspelled role would be silently empty: the builder takes every role id
from the schema module's exports, and a test asserts every role key the
builder writes exists in the schema.

## Scope

In scope:

- When WS2 lands, `check:architecture`'s stdout, stderr and exit code
  shall be what they were, on every tree the existing tests build and on
  the real tree; every finding `judgeDeclarations` makes for a rule in
  the table shall carry its rule id and key.
- When `check:adr-model` runs, it shall read the tree through
  `createGovernanceReader`, build the population through
  `adr-population.mjs`, validate it against
  `barwise/docs/adr/governance.orm.yaml`, run `judgeDeclarations` on a
  second reader, and compare the two as sets of (rule, key) with
  shadowing. During WS3 it shall exit 0 when they agree, 1 on any
  disagreement (naming it), and 2 on a refusal, an unbuilt core, or an
  unclassified diagnostic.
- When the schema's rule ids and `RULES` differ, a builder role key is not
  in the schema, or a rule has no planted case, a test shall fail naming
  it.
- When the schema alone is validated, it shall have no error; when barwise
  verbalizes it, each rule shall read as one sentence.

Out of scope:

- The verdict rules, which stay code.
- Stale tags and the evidence scope (`check:adr-tests`): a later spec,
  once this one has run, because tag facts cross into the declarations'
  object universe.
- The package graph and the capability matrix, and conflicts between
  decisions: later specs, which this schema is the base for.
- Any change to `@barwise/core`.

## Inventory

| Code today (main, after #910)                                                                                                            | Verdict                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `adr-facts.mjs` `createGovernanceReader`: `scripts()`, `steps(command)`, `issues()`, each `null` when unreadable                         | used as is                                                                                   |
| `adr-judge.mjs` `judgeDeclarations`: well-formedness, the fact rules, the verdict rules, the step classification                         | WS2: `RULES` (id, chain, rank) and a (rule, key) on each fact-rule finding; no output change |
| core population validation: subset violations once per distinct tuple, `elementId` the derived constraint name, the tuple in the message | used as is; the message shape pinned by a test                                               |
| the prototype (scratch: `schema.mjs`, `build.mjs`, `judge.mjs`, `run.mjs`, `real.mjs`)                                                   | WS3 starts from it; its cases become the tests                                               |

## Target architecture

```
adr-facts.mjs        reader (#910)
adr-judge.mjs        RULES: { id, chain, rank }; judgeDeclarations tags
                     each fact-rule finding with (rule, key)
adr-population.mjs   build(adrs, reader) -> populations; role ids from the
                     schema module; verdicts decide which facts are written
governance.orm.yaml  one subset constraint per RULES id
check-adr-model.mjs  two readers -> code judge and model -> sets of
                     (rule, key), shadowed by chain -> 0 / 1 / 2
```

## Alternatives considered

- **Compare per entry.** Rejected: core reports per distinct value, and
  making it count entries means keying satisfaction facts per entry,
  which has the builder decide the rule _(prototype)_.
- **Put the verdict rules in the schema too.** Rejected: their inputs
  (`if:` expressions, report statuses) are not facts, and stating them as
  facts moves the same code into the builder, after which the comparison
  could not tell the judges apart.
- **Add the violating tuple to core's `Diagnostic`.** Not needed: every
  rule here is single-role, so the message's tuple is one value; a pinned
  test guards its shape. Revisit for a multi-role rule.
- **State coverage as a mandatory constraint.** Rejected: it leaked
  through other fact types' values _(prototype)_; a subset does not.
- **Hold the two judges to the same output on fixture repositories.**
  The first drafts; rejected by their reviews.
- **Keep the model advisory.** Rejected by the owner.

## Workstreams (each independently shippable)

### 1. Split each gate into a reader and a judge (done)

`docs/specs/adr-gate-reader-split.spec.md` (barwise-ym8.pw0, #910).

### 2. Rule ids in the code judge

`RULES` in `adr-judge.mjs` gives each fact rule an id, a chain and a rank;
`judgeDeclarations` returns each fact-rule finding's (rule, key) beside its
unchanged message, and `check:architecture` prints only the message. No
output change, held as #910 held it: the existing tests and a
before-and-after diff on the real tree. Starts after enforceable-adr-
practice WS3 (barwise-ym8.gxp.y5o), which the tracker records as
blocking, so the gap-issue rules have ids from the start.

### 3. The model as a second judge

`governance.orm.yaml`, `adr-population.mjs`, `check-adr-model.mjs`, the
`check:adr-model` script and root forwarder, and a `META_GATES` entry (it
vouches for no ADR). `adr-model.test.mjs` drives both judges through stub
readers: the clean input, one planted violation per rule enumerated from
`RULES`, two entries naming one missing value, the untracked-issue chain,
an unreadable `package.json` and tracker, a headerless ADR, an
unclassified diagnostic (a refusal), and the pinned message shape. The
role-key and id-set tests need no core and live in `adr-facts.test.mjs`.
`adr-model.test.mjs` skips without `@barwise/core` built, so it also runs
in the CI step below, after core is built.

### 4. The model becomes the judge of the fact rules (provisional)

The fact rules' code leaves `adr-judge.mjs`; `check:adr-model` exits 1 on
a model finding and `check:architecture` stops judging them. Starts after
the owner reviews WS3's record: how many runs, and every disagreement.

## API and migration impact

- No package API changes.
- WS2 changes no output. WS3 adds a CI step and an npm script. WS4 moves
  the fact rules' findings from `check:architecture` to `check:adr-model`;
  the owner approves it first.

## Open decisions (for review)

- **Where `check:adr-model` runs in CI.** It needs core built, and it
  must run when `check:architecture` fails (a disagreement hides exactly
  then) and on tracker-only changes, which are docs-only and skip the
  build, and which the gap-issue rules are about. Recommended: its own job
  in `ci.yml`, unguarded, that runs `npm ci`, builds `@barwise/core` alone
  and runs the check and `adr-model.test.mjs`, independent of the main
  job. Rejected: a step after `check:adr-tests` in the main job, which
  never runs when an earlier gate fails or on a docs-only change, so the
  WS3 record would show no disagreement by construction.
- **How long WS3 runs before WS4.** Recommended: one release cycle, and a
  look at every disagreement it records.
- **Names.** `check:adr-model` and `barwise/docs/adr/governance.orm.yaml`;
  `audit:adr-model` or a schema under `barwise/scripts/` are renames.
