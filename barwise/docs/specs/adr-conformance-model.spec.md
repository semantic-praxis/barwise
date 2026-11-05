# ADR conformance as an ORM model

Status: WS1 implemented 2026-11-04 by docs/specs/adr-gate-reader-split.spec.md (#910); WS2-WS4 not started.

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
The prototype is five rules in a format-4.0 schema, a fact builder over the
real reader, and both judges compared on sixteen stub cases (the clean
input among them) and on the real tree, clean and with four violations
planted into a real ADR, each plant checked to change the ADR's text.
Every claim below marked _(prototype)_ rests on it.

## Which rules does the model judge? (resolved: the fact rules)

A **fact rule** is decided from facts alone. These move to the schema:

| Rule id         | Constraint                                                     | Key (the instance a violation names) |
| --------------- | -------------------------------------------------------------- | ------------------------------------ |
| `ids-exist`     | Decision listed by an entry is a decision its ADR has (subset) | decision `<adr>#<id>`                |
| `coverage`      | Decision an ADR has is listed by some entry (subset)           | decision                             |
| `script-exists` | Script an entry names is defined in `package.json` (subset)    | script                               |
| `issue-tracked` | Issue an entry cites is in the tracker (subset)                | issue                                |
| `issue-open`    | Issue an entry cites is open (subset)                          | issue                                |

A **verdict rule** is decided by code that reads something no fact
captures: whether a script is a gate name (`gateName`, `GATE_EXCEPTIONS`),
whether a meta gate may vouch for an ADR (`META_GATES`), whether a ci.yml
step qualifies (`guard` over `shouldRun`), whether a decision is proven
(report statuses). These stay in `adr-judge.mjs`. The builder uses their
answers only to decide which facts to write: an entry whose script fails
the gate-name or meta-gate verdict gets no "names script" fact, exactly as
the code judge never looks that script up _(prototype)_. Stale tags, the
evidence scope, the step rule, and enforceable-adr-practice WS3's
gap-issue rules are out of scope here (see Out of scope).

## At what grain are the two judges compared? (resolved: one finding per rule and key)

Core reports a subset violation once per distinct tuple
(`tuplesForRoleSeq` collects a `Set`), so two entries naming the same
missing script are one model violation and two code findings
_(prototype)_. Counting per entry is a property of the code judge's
output, not of the rule. So both judges are compared as **sets of (rule,
key)**, the key being the single value in the table above, and
`check:adr-model` reports each violation with the entries that carry it,
looked up from its own facts.

On that grain the two judges agreed on all sixteen stub cases and all
five real-tree runs _(prototype)_. One case needs a rule beyond set
equality: an issue not in the tracker is also not open, and the code
judge reports only `issue-tracked` while the model reports both.
`issue-tracked` and `issue-open` form a chain, and a model violation is
**shadowed** when the code judge reported a lower-ranked rule of the same
chain on the same key. A script that fails the gate-name verdict never
reaches the model (above), so it needs no shadow. Any other difference in
the sets is a **disagreement**.

## How is "could not answer" kept? (resolved: the builder leaves the facts out)

Population validation has two outcomes; the gates have three. The builder
asks the reader exactly what the code judge asks: `scripts()` only for an
npm entry the gate-name and meta-gate verdicts accept, `issues()` only
for a `none` entry, and never the workflow (its reader is built with
`needsWorkflow: false`). When the reader answers `null`, the builder
writes no "names script" or "cites issue" fact, so no obligation exists
and the model reports nothing; the reader's refusal is the answer, as it
is for the code judge. An ADR with no `Enforced-by:` header gets no facts
at all, matching the code judge's `continue`. Each judge gets its own
reader, since a reader pushes each unreadable input's refusal once, into
its own list, and the two refusal lists are compared as sets of the
input they name. The prototype's stubs push refusals as the real reader
does, and the cases include an unreadable `package.json` and tracker
both when an entry asks for them and when none does _(prototype)_.

## How do diagnostics map back to rules? (resolved: stated ids, format 4.0)

`governance.orm.yaml` is a format-4.0 file, and each rule's subset
constraint states its `RULES` id as its `id`, which a 4.0 load keeps as
written; a subset violation's `elementId` is `constraintRef(c)`, that id
_(prototype)_. A 3.x file would not do: its load renames every constraint
to a name derived from its sentence and keeps the stated id only as a
prior id, and a `barwise migrate` or an editor save writes 4.0, after
which the prior ids are gone. Role ids are also as written in a 4.0 file
(`Entry_names_Script.is_named_by`), so `adr-population.mjs` holds a
table of the role ids it writes, and a test with no core asserts each
appears in `governance.orm.yaml`.

The key comes from the message, `tuple [<value>] in roles [...]`. Each
rule's subset is over one role, so the tuple is one value and contains no
separator; a test pins that message shape against core, so a change to
it fails a test rather than a parse. Coverage is a subset and not a
mandatory constraint: core checks a mandatory role against every value
that plays any role of the type, so a tag fact naming a decision that
does not exist made the mandatory form report it as uncovered _(prototype)_.

Every error diagnostic is classified; warnings and info are not findings
and are ignored (the schema alone has 26 diagnostics and no error
_(prototype)_). An error that is a subset violation of a `RULES`
constraint is a finding; any other error is a refusal ("the population
could not be judged"), exit 2, never dropped. That covers a misspelled
role key: core reports `population/incomplete-instance`, an error
_(prototype)_, so the role-id test catches it earlier, not alone.

## Scope

In scope:

- When WS2 lands, `check:architecture`'s stdout, stderr and exit code
  shall be what they were, on every tree the existing tests build and on
  the real tree; every finding `judgeDeclarations` makes for a rule in
  the table shall carry its rule id and key.
- When `check:adr-model` runs, it shall read the tree through
  `createGovernanceReader`, build the population through
  `adr-population.mjs`, validate it against
  `barwise/docs/adr/governance.orm.yaml` (format 4.0), run `judgeDeclarations` on a
  second reader, and compare the two as sets of (rule, key) with
  shadowing. During WS3 it shall exit 0 when they agree, 1 on any
  disagreement (naming it), and 2 on a refusal, an unbuilt core, or an
  unclassified diagnostic.
- When the schema's rule ids and `RULES` differ, a builder role id is not
  in the schema, or a rule has no planted case, a test shall fail naming
  it.
- When the schema alone is validated, it shall have no error; when barwise
  verbalizes it, each rule shall read as one sentence.

Out of scope:

- The verdict rules, which stay code.
- enforceable-adr-practice WS3's gap-issue rules (label, title, one id per
  `none` entry): their shapes are a uniqueness, a per-entry frequency and
  a string test, none a single-role subset, and none was prototyped; they
  stay code until a later spec prototypes them.
- Stale tags and the evidence scope (`check:adr-tests`): a later spec,
  once this one has run, because tag facts cross into the declarations'
  object universe.
- The package graph and the capability matrix, and conflicts between
  decisions: later specs, which this schema is the base for.
- Any change to `@barwise/core`.

## Inventory

| Code today (main, after #910)                                                                                                                       | Verdict                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `adr-facts.mjs` `createGovernanceReader`: `scripts()`, `steps(command)`, `issues()`, each `null` when unreadable                                    | used as is                                                                                   |
| `adr-judge.mjs` `judgeDeclarations`: well-formedness, the fact rules, the verdict rules, the step classification                                    | WS2: `RULES` (id, chain, rank) and a (rule, key) on each fact-rule finding; no output change |
| core population validation: subset violations once per distinct tuple, `elementId` the stated constraint id in a 4.0 file, the tuple in the message | used as is; the message shape pinned by a test                                               |
| the prototype (scratch: `schema.mjs`, `build.mjs`, `judge.mjs`, `run.mjs`, `real.mjs`)                                                              | WS3 starts from it; its cases become the tests                                               |

## Target architecture

```
adr-facts.mjs        reader (#910)
adr-judge.mjs        RULES: { id, chain, rank }; judgeDeclarations tags
                     each fact-rule finding with (rule, key)
adr-population.mjs   build(adrs, reader) -> populations; a table of the 4.0
                     role ids it writes; verdicts decide which facts are
                     written; asks the reader only what the code judge asks
governance.orm.yaml  format 4.0; one subset constraint per RULES id, by id
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
blocking: both change `judgeDeclarations`, and WS2's no-output-change
diff is cleaner against a judge that is not also moving.

### 3. The model as a second judge

`governance.orm.yaml`, `adr-population.mjs`, `check-adr-model.mjs`, the
`check:adr-model` script and root forwarder, and a `META_GATES` entry (it
vouches for no ADR). `adr-model.test.mjs` drives both judges through stub
readers: the clean input, one planted violation per rule enumerated from
`RULES`, two entries naming one missing value, the untracked-issue chain,
an unreadable `package.json` and tracker, a headerless ADR, an
unclassified diagnostic (a refusal), and the pinned message shape. The
role-key and id-set tests need no core and live in `adr-facts.test.mjs`.
`adr-model.test.mjs` skips without `@barwise/core` built, so it runs for
real in the comparison's own CI job (Open decisions), after that job
builds core.

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
