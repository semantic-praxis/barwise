# ADR conformance as an ORM model

Status: WS1 implemented 2026-11-04 by docs/specs/adr-gate-reader-split.spec.md (#910); WS2 implemented 2026-11-05 (RULES, scriptVerdict, and a { rule, adr, position, key } fact per fact-rule finding, with no output change); WS3-WS4 not started.

Created: 2026-11-04
Last-updated: 2026-11-05
Tracking: barwise-ym8.z9g (follows docs/specs/adr-gate-reader-split.spec.md)
Touches: barwise/scripts/lib/adr-judge.mjs, barwise/scripts/check-architecture.mjs,
+barwise/scripts/lib/adr-population.mjs, +barwise/docs/adr/governance.orm.yaml,
+barwise/scripts/check-adr-model.mjs, +barwise/scripts/tests/adr-model.test.mjs,
barwise/scripts/tests/adr-facts.test.mjs, barwise/scripts/lib/adr-enforcement.mjs,
barwise/scripts/tests/expected-counts.json, barwise/package.json, package.json,
.github/workflows/ci.yml, barwise/scripts/lib/ci-gates.mjs,
barwise/scripts/tests/ci-conditions.test.mjs
Plan-reviewed: 05383a2a (code-review, pr-review)

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
The prototype is committed beside this spec, in
`docs/specs/adr-conformance-model.prototype/`: five rules in a format-4.0
schema (`governance.orm.yaml`), a fact builder over the real reader
(`build.mjs`), both judges and their comparison (`judge.mjs`), twenty-five stub cases (`run.mjs`), the real tree clean and with four violations
planted into a real ADR, each plant checked to change the ADR's text
(`real.mjs`), and the classifier's edge cases, core's one-violation-per-value count, the mandatory-coverage leak and the exit when the model cannot load (`typo.mjs`). Each runs
with `node <file>` from that directory after `npm run build`. Every claim
below marked _(prototype)_ rests on it. It was measured against today's
`judgeDeclarations`; WS3 re-runs it against the judge enforceable-adr-
practice WS3 leaves, and any short-circuit that spec adds before the
tracked and open checks joins the shared verdict below.

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
the code judge never looks that script up _(prototype)_. WS2 extracts that
decision into one exported function, `scriptVerdict(entry, adr)` (the
gate-name or meta-gate finding, or `null`), which `judgeDeclarations`
and the builder both call, so the builder holds no copy of it. Stale tags, the
evidence scope, the step rule, and enforceable-adr-practice WS3's
gap-issue rules are out of scope here (see Out of scope).

## At what grain are the two judges compared? (resolved: per rule, ADR, entry and key)

Core reports a subset violation once per distinct tuple
(`tuplesForRoleSeq` collects a `Set`), so two entries naming the same
missing script are one core violation _(prototype)_. The key is the single
value in the table above. `check-adr-model.mjs` expands each violation to
the entries that carry its key, from its own facts (coverage has no
entry, only its ADR), and the two judges are compared as **multisets of
(rule, ADR, entry, key)**, where the entry is its position, its index in `parseEnforcedBy(text).entries` on both sides (a malformed part is dropped from that list, so a count over the raw header would differ),
so a disagreement on a second entry with the same key is not hidden
behind the first, and two identical entries are two findings on both
sides. The code judge's side comes from the (rule, key, entry position)
WS2 attaches to each finding. The prototype recovers the code side's position from the entry's text,
a stand-in WS2 replaces with `judgeDeclarations`' own loop index; its
cases include two identical entries, a malformed entry before a finding,
and two identical entries each listing an unknown id twice _(prototype)_. `ids-exist` counts once per time an entry lists
the id, as the code judge reports it: the facts hold each id once (the
schema's uniqueness on "Entry lists Decision"), so the expansion counts
the entry's own list _(prototype: `(one, ghost, ghost)`)_.

On that grain the two judges agreed on all twenty-five stub cases and all five
real-tree runs _(prototype)_. One case needs a rule beyond set equality:
an issue not in the tracker is also not open, and the code judge reports
only `issue-tracked` while the model reports both. `issue-tracked` and
`issue-open` form a chain, and a model violation is **shadowed** when the
code judge reported a lower-ranked rule of the same chain on the same
ADR, entry and key. A script the shared verdict rejects never reaches the
model, so it needs no shadow. Any other difference in the sets is a
**disagreement**.

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
its own list. The two refusal lists are compared as sets of the input
they name, for the inputs the model reads (`package.json` and the
tracker); the code judge's other refusals (`ci.yml`, the workflow
reader's import, a step guard it cannot read) belong to verdict rules the
model does not judge and are left out of the comparison. The prototype's
stubs push refusals as the real reader does, and the cases include an
unreadable `package.json` and tracker both when an entry asks for them
and when none does, an unreadable `ci.yml`, and an unreadable step
guard, the last with two entries asking so that the refusal is pushed
once _(prototype)_. A difference between the two refusal sets is a
disagreement: the builder asked the reader differently.

The model's **own** refusals are another matter: an unbuilt core (core is
loaded with a dynamic import, so a missing build is a refusal, not an
import crash, which would exit 1), a population that does not load, a deontic `RULES` constraint, an error diagnostic that is not a
`RULES` violation, or a violation message that does not have the pinned
shape. With any of them the model has no answer, so the comparison does
not run and the check exits 2. Comparing anyway would turn every code
finding into "missed by the model" and report a refusal with the finding
code, which the gate-refusal contract forbids _(prototype: exit 2 with a
code finding beside a load failure, and beside an unbuilt core)_.

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

The key comes from the message, `tuple [<value>] in roles [...]`: the
text between the first `tuple [` and the last `] in roles [`, so a value
containing `]` (`parseEntry` accepts any non-space script name) is read
whole _(prototype)_. Each rule's subset is over one role, so the tuple is
one value; a test pins that message shape against core, and a message
that does not match it is a refusal, never a key. Coverage is a subset and not a
mandatory constraint: core checks a mandatory role against every value
that plays any role of the type, so a tag fact naming a decision that
does not exist made the mandatory form report it as uncovered _(prototype)_.

Every error diagnostic is classified; warnings and info are not findings
and are ignored (the schema alone has 26 diagnostics and no error
_(prototype)_). That is sound only because every `RULES` constraint is
alethic: core gives a deontic constraint's violations the severity
`warning` (`severityForModality`), so `check-adr-model.mjs` refuses a
schema in which any `RULES` constraint is deontic, which the loaded
model shows _(prototype)_. An error that is a subset violation of a
`RULES` constraint is a finding; any other error is a refusal ("the
population could not be judged"), exit 2, never dropped. A misspelled
role key is such an error (`population/incomplete-instance`)
_(prototype)_. A misspelled fact type is not a diagnostic: the load
throws, and `check-adr-model.mjs` catches it as one of the model's own
refusals, so it exits 2 even beside a code finding _(prototype)_. The role-id test, which also checks the fact-type
ids, catches both earlier.

## Scope

In scope:

- When WS2 lands, `check:architecture`'s stdout, stderr and exit code
  shall be what they were, on every tree the existing tests build and on
  the real tree; every finding `judgeDeclarations` makes for a rule in
  the table shall carry its rule id, its key and its entry's position.
- When `check:adr-model` runs, it shall read the tree through
  `createGovernanceReader`, build the population through
  `adr-population.mjs`, validate it against
  `barwise/docs/adr/governance.orm.yaml` (format 4.0), run `judgeDeclarations` on a
  second reader, and compare the two as multisets of (rule, ADR, entry
  position, key) with shadowing, and their refusals for the inputs the
  model reads as sets. During WS3 it shall exit 2 when the model refuses
  on its own account (an unbuilt core, a population that does not load, a
  deontic `RULES` constraint, an unclassified diagnostic or message),
  without comparing; else 1 on any disagreement, naming it; else 2 on a
  reader refusal on either side; else 0.
- When the schema's rule ids and `RULES` differ, a fact-type or role id
  the builder writes is not in the schema, or a rule has no planted case,
  a test shall fail naming it.
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

| Code today (main, after #910)                                                                                                                       | Verdict                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `adr-facts.mjs` `createGovernanceReader`: `scripts()`, `steps(command)`, `issues()`, each `null` when unreadable                                    | used as is                                                                                                   |
| `adr-judge.mjs` `judgeDeclarations`: well-formedness, the fact rules, the verdict rules, the step classification                                    | WS2: `RULES` (id, chain, rank) and a (rule, key, entry position) on each fact-rule finding; no output change |
| core population validation: subset violations once per distinct tuple, `elementId` the stated constraint id in a 4.0 file, the tuple in the message | used as is; the message shape pinned by a test                                                               |
| the prototype (`docs/specs/adr-conformance-model.prototype/`, ignored by knip)                                                                      | WS3 starts from it; its cases become the tests                                                               |

## Target architecture

```
adr-facts.mjs        reader (#910)
adr-judge.mjs        RULES: { id, chain, rank, key }; scriptVerdict(entry, adr),
                     shared; judgeDeclarations tags each fact-rule finding
                     with (rule, key, entry position)
adr-population.mjs   build(adrs, reader) -> populations; a table of the 4.0
                     role ids it writes; verdicts decide which facts are
                     written; asks the reader only what the code judge asks
governance.orm.yaml  format 4.0; one subset constraint per RULES id, by id
check-adr-model.mjs  two readers -> code judge and model; the model's own
                     refusal -> 2; else multisets of (rule, ADR, entry,
                     key), shadowed by chain, and the model's inputs'
                     refusals -> 1 / 2 / 0
```

## Alternatives considered

- **Key the schema's facts per entry.** Rejected: core reports per
  distinct value, and keying satisfaction facts per entry has the builder
  decide the rule. Expanding a value's violation to its entries after
  validation gives the per-entry comparison without that.
- **Compare per (rule, key) only.** Rejected by review: a disagreement on
  a second entry with the same key would be hidden behind the first.
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
`judgeDeclarations` returns each fact-rule finding's (rule, key, entry
position) beside its unchanged message, and `check:architecture` prints only the message.
`scriptVerdict` is extracted from `judgeDeclarations`' gate-name and
meta-gate checks and exported. No
output change, held as #910 held it: the existing tests and a
before-and-after diff on the real tree. Starts after enforceable-adr-
practice WS3 (barwise-ym8.gxp.y5o), which the tracker records as
blocking: both change `judgeDeclarations`, and WS2's no-output-change
diff is cleaner against a judge that is not also moving.

### 3. The model as a second judge

`governance.orm.yaml`, `adr-population.mjs`, `check-adr-model.mjs`, the
`check:adr-model` script and root forwarder, and a `META_GATES` entry (it
vouches for no ADR). `adr-model.test.mjs` drives both judges through stub
readers, from the prototype's cases: the clean input, one planted
violation per rule enumerated from `RULES`, two entries naming one
missing value, two identical entries, an id listed twice in one entry,
a malformed entry before a finding, one value on two entries the verdict
splits, the
untracked-issue chain, an unreadable `package.json` and tracker (asked
and not), an unreadable `ci.yml` (asked by two entries) and step guard (code-only
refusals), a
headerless ADR, a value containing `]`, a deontic rule, a population
that does not load and an unbuilt core, each beside a code finding (exit
2), an unclassified diagnostic, and the pinned message shape. It carries no `[adr:...]` tag. The role-id and id-set tests need
no core and live in `adr-facts.test.mjs`. `adr-model.test.mjs` skips
without `@barwise/core` built, as it is when `test:scripts` runs (before
the build), so a `test:adr-model` npm script runs it in the CI steps
below, after core is built; an npm script, so `ci:local` runs it too.
`test:adr-model` first checks that core's build is there and exits 2 if
it is not, so it never passes with every case skipped.
Every disagreement CI reports is resolved in a commit that adds its input
as a case here; that test file's history and the job's run count are the
record WS4 starts from.

Requirements the build must meet, from the plan's last review rounds. The owner closed the plan review on these (2026-11-05): the last round's findings were requirements of this kind, not design problems, so they are recorded here rather than starting another round.

- **Positions come from the loop.** `judgeDeclarations` attaches each
  finding's entry position from its own loop index over
  `parseEnforcedBy(text).entries`, never recovered from the message text;
  the combined case (identical entries, each listing an id twice) is a
  test.
- **Every import can refuse.** Under `!cancelled()` the steps also run
  after `npm ci` fails, so `check-adr-model.mjs` loads every dependency
  (core, `yaml`, the `scripts/lib` modules) with a dynamic import inside
  one `try`, and a failure is the model's own refusal, exit 2. The test
  for it runs where core is absent (`test:scripts`, before the build) and
  makes the real import fail, through a path the check takes as an
  argument, not through a flag that skips the import.
- **`test:adr-model` refuses on skips, not on a file.** It runs the file
  and exits 2 when the run's own count of skipped cases is not zero, so a
  build that exists but does not import is not a pass.
- **The test file registers the same tests either way.** Every case in
  `adr-model.test.mjs` registers whether core is built or not and skips
  with `{ skip }`, so `test:scripts`' per-file count in
  `expected-counts.json` does not depend on whether a build exists.
- **One condition form.** `shouldRun` understands `${{ !cancelled() }}`
  as written and nothing more: the bare `!cancelled()` is a YAML tag, read
  as an empty `if:` by the YAML reader and as a condition by the line
  reader, so it stays not-understood; and no general `${{ }}` stripping,
  which would make the wrapped docs-only guard understood and break the
  existing test that pins it as not.

### 4. The model becomes the judge of the fact rules (provisional)

The fact rules' findings leave `adr-judge.mjs`; `check:adr-model` exits 1
on a model finding and `check:architecture` stops reporting them. A fact
check that guards a verdict rule stays as a silent guard: the step check
needs the script to exist, so `judgeDeclarations` still skips an entry
whose script is undefined, without a finding, and the same defect is not
reported by two gates. Starts after
the owner reviews WS3's record: how many runs, and every disagreement.

## API and migration impact

- No package API changes.
- WS2 changes no output. WS3 adds three CI steps and three npm scripts
  (`build:core`, `check:adr-model`, `test:adr-model`), each with its root
  forwarder, and teaches `shouldRun` the `!cancelled()` condition. The knip ignore for spec
  prototypes lands with the prototype, in the plan PR. WS4 moves
  the fact rules' findings from `check:architecture` to `check:adr-model`;
  the owner approves it first.

## Open decisions (for review)

- **Where `check:adr-model` runs in CI** (decided by the owner,
  2026-11-05: option A). It needs core built, it must run when
  `check:architecture` fails (a disagreement hides exactly then) and on
  tracker-only changes, which are docs-only and skip the build, and it
  must be required, or WS3's judge is advisory, which the owner rejected.
  Three steps at the end of the required `ci` job, each guarded
  `if: ${{ !cancelled() }}` and not by `docs_only` (`npm ci` already
  runs unguarded): `npm run build:core` (`turbo run build
  --filter=@barwise/core`, a cache hit after the job's full build), `npm
  run check:adr-model`, and `npm run test:adr-model`. At the end, a
  failure in them skips no other gate; under `!cancelled()`, they run
  after a failed gate and on a docs-only change. `shouldRun`
  (`scripts/lib/ci-gates.mjs`) learns exactly the condition
  `${{ !cancelled() }}`, as always true locally, since `ci:local` is
  never cancelled; `ci-conditions.test.mjs` gains its case, so the
  real-`ci.yml` test keeps passing and `ci:local` runs the steps.
  Rejected: the same steps first, after `npm ci`, where any failure in
  them (a core compile error, an unreadable tracker) skips every later
  gate; a separate job, which branch protection does not require without
  an admin change; `continue-on-error`, which makes the judge advisory;
  and steps guarded like their neighbours, which never run after a failed
  gate or on a docs-only change.
- **How long WS3 runs before WS4.** Recommended: one release cycle, and a
  look at every disagreement it records.
- **Names.** `check:adr-model` and `barwise/docs/adr/governance.orm.yaml`;
  `audit:adr-model` or a schema under `barwise/scripts/` are renames.
