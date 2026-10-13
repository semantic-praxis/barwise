# Effect against hand-written sealed records: a measured comparison before the rest of barwise-973

Status: Draft -- no workstream implemented
Created: 2026-10-13
Last-updated: 2026-10-13
Tracking: barwise-cu0 (this spec); barwise-973 (WS1 of
`core-branching-load.spec.md`, held until WS4 here decides its style);
barwise-5fg (a regression the grounding found, fixed before either arm
starts); barwise-0lf (an unchecked copy WS0 closes); barwise-r7j (a
build-cache hazard every measurement here must avoid); barwise-e8m (the
core-purity commitment, Open decision 1); barwise-933 (the ReScript
experiment, whose method this borrows)

In one sentence: before writing the remaining four element kinds and the
builder of barwise-973, build the already-converted `ObjectType` slice to
the same scope twice -- once in hand-written TypeScript as
`core-branching-load.spec.md` intends, once with Effect -- measure both
against criteria fixed here and tested before use, and let the result
choose the style for the rest. Testing the criteria found the cost that
looked most likely to decide it, startup, and it does not: one Effect
Schema import adds about 160 ms, and `barwise validate` takes about
0.7 s today, inside the 1-second limit Open decision 3 settled on.

## Principle

barwise-973 makes invalid models unrepresentable by hand. One object type
is described four times, in three files: the JSON Schema
(`core/schemas/orm-model.schema.json`), the YAML shape and its two mapping
functions (`core/src/serialization/yaml/objectType.ts`), the config type
and the refusals in `createObjectType`, and the `EntityType | ValueType`
records (both in `core/src/model/ObjectType.ts`). "An entity type has a
reference mode" is stated three times. `core/CLAUDE.md` asks that the
schemas be kept "in sync with the serializers", which is a comment
guarding a must-agree copy.

Effect (npm `effect`, 4.0.x) offers three things this design otherwise
builds by hand, each tied to a principle. Schema derives the type, the
YAML decoder and encoder, and a JSON Schema from one definition (DRY,
composability). Decoding returns every problem as a value instead of
throwing on the first (define errors out of existence). A declared
requirement puts the id source in the type, where today it hides behind
a process-wide install (explicit over implicit). Against it: core allows
two runtime dependencies (`yaml`, `ajv`; `core/CLAUDE.md`, "no others
without discussion"), and the grounding below found a startup cost that
no criterion in the first draft would have seen. Determinism in core is
not at stake: decoding is a pure function in either style.

## Should this be an experiment rather than a decision? (resolved: yes)

Both prior positions were reasoned, not measured.
`functional-design-quality.spec.md` decided "no `Result` type, no
library" for core's throws; `core-in-rescript.spec.md` dismissed Effect
in one line because it adds no exhaustiveness beyond `switch`. Both are
right about what they examined, and neither examined Schema's derivation
or the cost of loading it. The comparison costs one slice built twice;
choosing wrong costs four element kinds and a builder written in the
wrong style, across the 84 sites barwise-973 already counts.

The experiment also tests a claim that prompted it: that effect-typed
code gets coding agents to correct code faster, because the type checker
reports a missed failure or an unwired dependency before a test does.
The evidence for it is adjacent (studies of type-error feedback to
agents, in other languages) and none of it is specific to Effect, which
is why D3 measures it rather than assumes it.

## Scope

In scope:

- When WS0 lands, the repository shall have an instrument for every
  criterion in the table below, each shown to detect the failure it
  measures by a deliberate break, and the spec shall record each
  instrument's baseline.
- When either arm is built, it shall start from the same base commit and
  the same brief (Appendix A), without access to the other arm's branch.
- When an arm decodes a malformed object type, it shall report every
  problem in the probe set in one pass, each naming the object type and
  the field.
- When WS4 applies the decision rule, the outcome shall be recorded in
  this spec, on barwise-973 and on barwise-cu0, with every criterion's
  measured value.

Out of scope: adopting Effect (an adoption spec follows only if the rule
says so); Effect in the outer packages (`llm` retries, timeouts and
cancellation are a separate question); the ReScript experiment
(barwise-933), which this neither blocks nor replaces; fixing
barwise-5fg, which is its own PR ahead of the arms.

## Decision criteria (fixed in review, before either arm is built)

Gates must hold in an arm for it to be eligible; they do not choose
between arms. Deciders choose. Reported measures inform an adoption spec
and decide nothing. Inventory gives each one's instrument and baseline.

| #  | Criterion                    | Stands for                                   | Role                  |
| -- | ---------------------------- | -------------------------------------------- | --------------------- |
| G1 | Valid input unchanged        | Nothing changes for a model that loads today | gate                  |
| G2 | YAML layout preserved        | Users' model diffs stay quiet                | gate                  |
| G3 | No unchecked must-agree copy | Drift defects like barwise-5fg               | gate                  |
| G4 | Startup under 1 second       | Responsiveness of every CLI command          | gate                  |
| D1 | Change amplification         | Cost and drift risk of the next field        | decider               |
| D2 | Malformed-input reporting    | Time to fix a bad model; no silent loss      | completion bar        |
| D3 | Agent cost to correct code   | The claim that prompted this                 | decider if resolvable |
| R1 | Consumer radius              | Migration cost of the four remaining kinds   | reported, tripwire    |
| R2 | Bundle size                  | Shadow of G4                                 | reported              |
| R3 | Source size                  | Shadow of D1                                 | reported              |

D2 is a completion bar, not a decider: Appendix A makes it part of the
brief, so an arm is not finished until it clears it, and what the bar
costs each arm shows up in D1, R3 and D3.

G1 covers valid input only. D2 changes what malformed input produces --
every problem, each naming the object type and the field, where today
one plain `Error` names the first -- and that change is the point of the
brief, not a breach of G1. A test that pins today's first-error message
may be updated in either arm; each such edit is listed and counted.

**Decision rule.** Recommend Effect for the rest of barwise-973 only if
the Effect arm clears G1-G4 (for G4, a mitigation counts only if it
ships in the arm and both arms are measured with it), is not resolvably
worse on D3, and is better on D1 or resolvably better on D3. Otherwise
resume barwise-973 in hand-written TypeScript, starting from the plain
arm. A tie goes to TypeScript: the dependency is a cost no single
criterion carries.

A D3 difference is resolvable when it exceeds twice the standard error
of the difference between arm means, computed from the runs. Below that,
D3 casts no vote and the spec says so.

## How each criterion was tested

The table above is what survived testing; this is the log of that
testing. Each criterion stands in for a property through some mechanism,
and diverges from it where the mechanism is bypassed, so each rested on
an anchor, and each anchor was tested before the criterion was trusted:
on 2026-10-13, against main `8d2f526b`. Seven were wrong or only partly
right, one held, one turned out to be a shadow of a larger cost, and one
cannot be tested without running the trials.

1. **"Golden bytes unchanged" has an instrument -- partly wrong.** Test:
   move `reference_mode` to the end of `serializeObjectType`; a byte pin
   should fail. All 1,932 core tests pass. Across the monorepo only
   promptlab's `referenceDrift.test.ts` fails (10 tests); the CLI goldens
   hold DDL, Avro, OpenAPI and prose, never YAML. _Changed:_ WS0 adds a
   byte-level test (G2).
2. **That drift test covers every object type field -- wrong.** The 10
   reference models use 5 of the 10 optional fields; `default_value`,
   `cardinality`, `independent`, `note` and `source_context` never
   appear, so their order and presence are unpinned. _Changed:_ same as
   1.
3. **The schema and the model cannot drift unnoticed -- split.**
   Dropping any object type property from the JSON Schema fails 4-18
   tests (the serialization law generates every field). Dropping
   `"other"` from the data type enum fails none: the law's arbitrary
   samples a hand-picked 5 of 14 data types. A sweep of the schema's
   other multi-member enums with `mutate.mjs` found each one caught;
   the data type enum is the only gap. _Changed:_ G3 counts unchecked
   copies, not copies; WS0 closes this one (barwise-0lf).
4. **Loading reports problems and loses nothing -- wrong twice.** A file
   holding a value type with a `reference_mode`, a cardinality with
   `max < min` and a blank name reports only the first, as a plain
   `Error`. An entity type with a `data_type` loads without complaint
   and the field is gone on save -- a regression from WS1 step 1
   (barwise-5fg). _Changed:_ D2's probe set includes both; barwise-5fg is
   fixed before either arm starts.
5. **Comparing Effect's error reporting with today's is fair -- wrong.**
   barwise-973 plans collect-every-problem (`build()` returning
   `BuildResult`) and has not built it, so today is a baseline, not the
   opponent. _Changed:_ both arms build it for the slice (Appendix A).
6. **Effect can express the slice and report every problem --
   verified.** A scratch probe defined the `ObjectType` union in Effect
   4.0.4 Schema and decoded the cases from 4: all four problems in one
   pass, the entity `data_type` included. Its messages name an array
   index (`at [0]["reference_mode"]`) where barwise names the element,
   and its first draft rejected an untrimmed name that barwise trims.
   _Changed:_ message quality is part of the D2 bar.
7. **"Tests pass unchanged" and "id source in the type" can coexist --
   wrong.** `ObjectType.test.ts` calls `createObjectType(config)` 21
   times; a signature that declares its id source changes those calls.
   _Changed:_ the behavioral oracle (G1, G2) stays untouched; unit-test
   edits are allowed and counted.
8. **Core has no injected effect port (barwise-e8m, 2026-06-21) --
   wrong.** `setIdGenerator` landed 2026-07-25 (`4726a026`) and every
   surface installs a generator at startup. Every importer but NORMA --
   DDL, OpenAPI, SQL, dbt, LLM extraction, the code importers -- relies
   on it. _Changed:_ Open decision 1 asks "implicit or visible", not
   "allow a port or not".
9. **Bundle size stands in for what users feel -- a shadow, and the
   property is worse.** Measured directly in the table below. _Changed:_
   startup is a gate with an absolute limit (Open decision 3); bundle
   size (R2) is reported.
10. **Agent runs vary less than the difference worth detecting --
    unverified.** It cannot be tested without runs. _Changed:_ a pilot
    measures spread first, and "unresolvable" is a stated outcome.

The startup measurements behind 9. Each probe linked Effect 4.0.4 into
`node_modules` (no `package.json` change), appended one Schema import to
`core/src/index.ts`, rebuilt, timed, and reverted. Medians of 10 runs of
`barwise --version`, each pair taken back to back:

| CLI distribution, import form                          | Without | With          |
| ------------------------------------------------------ | ------- | ------------- |
| npm package (unbundled, the `bin`), `effect`           | 461 ms  | 894 ms (+94%) |
| npm package, `effect/Schema`                           | 436 ms  | 596 ms (+37%) |
| npm package with `NODE_COMPILE_CACHE`, `effect/Schema` | 378 ms  | 582 ms (+54%) |
| release asset (esbuild bundle), `effect/Schema`        | 380 ms  | 419 ms (+10%) |

The probe imported one schema; a full slice pulls in more. The compile
cache helps the baseline more than the probe, so the cost is loading
Effect's module graph, not compiling it. Bundling is the mitigation that
works, and today only the release asset is bundled (it grew 209 KB).

Where today's `barwise validate` spends its time, measured 2026-10-13 at
main `fdce28fa` on the npm package, Node 26.7.0, against
`examples/models/learning-design.orm.yaml` (703 ms median of 15 runs), by
`node --cpu-prof` and by timing each import alone in a fresh process.
These are hand measurements and a snapshot; WS0's `startup` subcommand is
where their commands and the module-count hook live from then on:

| Part                                                | Time         |
| --------------------------------------------------- | ------------ |
| Node process start                                  | about 50 ms  |
| Importing all 18 commands (568 modules, 3.8 MB)     | about 350 ms |
| -- of which `validate`'s own import chain           | about 150 ms |
| Compiling the JSON Schema (`new SchemaValidator()`) | about 120 ms |
| Parsing, validation rules, output                   | about 100 ms |

The 1-second limit leaves about 300 ms. Two costs already in the CLI are
each larger than the probe's 160 ms and unrelated to this comparison:
the roughly 200 ms spent importing the 17 commands `validate` never runs
(barwise-8nx), and the schema compile, paid on every model load in every
short-lived process (barwise-aqa).

## Competing frames

Three explanations for whatever the arms show, with the evidence that
tells them apart:

- **F1, Effect pays for itself.** One definition removes copies, decoding
  collects problems for free, the id source shows in the type. Predicts:
  Effect lower on D1, equal or better on D2, D3 not worse.
- **F2, hand-written TypeScript suffices.** A drift test per copy and a
  hand-written decoder reach the same D1 and D2 at no dependency or
  startup cost. Predicts: D1 close, and the slowdown G4 reports favors
  TypeScript.
- **F3, style is not where the cost is.** barwise-973's remaining cost is
  consumer migration, which is the same in both styles. Predicts: R1
  dwarfs any D1 difference. If F3 holds, the comparison cannot change
  the plan much, and the honest result is "finish 973 either way, in the
  cheaper style".

## Premortem and tripwires

Assume the decision shipped and proved wrong. The likely stories:

- **The slice did not predict the rest.** `ObjectType` has no nested
  unions; `FactType` carries the 16-kind `Constraint` union. Tripwire: if
  T2's Effect arm needs a schema for every constraint kind to decode one
  fact type, T2 is not the same task in both arms; re-scope it (Appendix
  C) before running it.
- **The comparison measured familiarity, not the approach.** Agents know
  Effect 3; 4.0.0 shipped 2026-10-01 with renamed APIs. Tripwire: if more
  than a third of the Effect arm's red checks in D3 are API misuse
  (classified by hand from transcripts), report D3 as measuring
  familiarity and give it no vote.
- **Startup regressed and nobody noticed.** G4 exists for this.
- **A field's YAML order changed and every user's model diff got noisy.**
  G2 exists for this.
- **An agent passed by editing the tests.** The T1 and T2 scorer fails a
  run that edits a protected file (the WS0 instruments, the law tests,
  the goldens).
- **A measurement read a stale bundle.** Observed during this grounding:
  after a revert and a cached rebuild, the vscode bundle still held the
  reverted code (barwise-r7j). Every measurement builds with `--force`.
- **The plain arm had hindsight.** Its first implementation already
  solved the slice's design problems (for example, `dataType` had to stay
  optional; the step-1 notes in `core-branching-load.spec.md` count 54 of
  302 value types without one). Both arms build only the new scope from
  one base, and T1 and T2 are new to both.

## Inventory

How each criterion is measured. Rows marked new are built by WS0, and
their locations are provisional until WS0 grounds them; the script is
`barwise/scripts/measure-comparison.mjs`.

| #  | Instrument                                                             | Baseline, main `8d2f526b`               |
| -- | ---------------------------------------------------------------------- | --------------------------------------- |
| G1 | Full suite, `validate:examples`, promptlab `referenceDrift.test.ts`    | green                                   |
| G2 | New: `core/tests/serialization/objectTypeLayout.test.ts`               | missing; 5 of 10 optional fields pinned |
| G3 | `audit:duplication -- --check`, `check:parity`; new enum drift test    | one unchecked copy (barwise-0lf)        |
| G4 | New: script `startup`, `barwise validate`, median of 15, both builds   | `validate`: 703 ms npm, 566 ms bundle   |
| D1 | New: script `diff` over passing T1 runs (Appendix B), median           | from the WS3 pilot                      |
| D2 | New: fixtures in `core/tests/fixtures/malformed/`, script `malformed`  | first problem only; one silent loss     |
| D3 | New: script `trial` -- oracle pass, tokens, tool calls, time, red runs | spread from the WS3 pilot               |
| R1 | New: script `diff`, files outside `core/src/{model,serialization}`     | WS1 step 1 changed 30 files in all      |
| R2 | New: script `bundles`, `--force` builds of the vscode and CLI bundles  | 8.21, 8.81, 1.25, 0.74 MB; CLI 7.92 MB  |
| R3 | New: script `diff`, lines in the slice's files                         | 440 (332 + 108)                         |

One script with subcommands rather than five, so the measurement has one
home and the gate-refusal contract (exit 2 when it cannot see its input)
is implemented once. The two tests stay after the experiment whatever
it decides: they guard today's behavior.

## Target architecture

Both arms expose the same two entry points for the slice, so the
behavioral oracle runs against either. The shapes differ only in how the
id source and the problems are carried.

```ts
// Plain arm: hand-written decoder and an explicit id source (Open decision 1).
interface ObjectTypeProblem {
  readonly objectType: string; // the name as written, or the id
  readonly field: string;
  readonly message: string;
}

type DecodeResult =
  | { readonly ok: true; readonly value: ObjectType; }
  | { readonly ok: false; readonly problems: readonly ObjectTypeProblem[]; };

declare function decodeObjectType(
  doc: unknown,
  newId: () => string,
): DecodeResult;
```

```ts
// Effect arm, in outline (names per Effect 4.0.x):
//   ObjectTypeYaml = Schema.Union([EntityTypeYaml, ValueTypeYaml])
//     one definition: the record type, the snake_case YAML codec, and
//     (if the arm chooses) the object_type JSON Schema
//   decodeObjectType: (doc: unknown) =>
//     Effect<ObjectType, ObjectTypeProblems, IdSource>
//     decoded with { errors: "all" }; IdSource is a declared requirement,
//     provided at the OrmModel boundary
```

`OrmModel.addObjectType` and `OrmYamlSerializer` keep their signatures in
both arms: each runs the slice's decoder and raises the problems through
today's error path, so consumers outside core do not change. Whether the
Effect arm generates the `object_type` definition in
`orm-model.schema.json` or keeps it hand-written behind a drift test is
the arm's call, and either way G3 must hold.

## Alternatives considered

- **Compare on `graphOf` instead.** The closest preview of `build()`, but
  it has no YAML boundary and no id source, so it tests error collection
  alone. A follow-up if the slice is close.
- **Compare on `FactType` only.** No hindsight in either arm, but it is
  the largest kind (37 importing files, the constraint union) and too
  expensive to build twice by hand. It stays as the agent task T2.
- **Skip the experiment and finish barwise-973.** The honest default,
  and what the decision rule falls back to. Rejected as the first step
  because the slice costs less than the four kinds it would steer.
- **A three-way comparison with ReScript.** The criteria here reuse
  `core-in-rescript.spec.md`'s method so the numbers can sit beside
  each other later. Folding them together now would block this on that
  experiment's Phase B, which waits on barwise-973.
- **Effect in `@barwise/llm` first.** That is where effects live
  (retries, timeouts, cancellation are absent), and the "effects in the
  signature" half of the claim is tested better there. It does not
  answer whether to finish barwise-973, which is the decision in front
  of us. A separate spec if this one is promising.

## Workstreams (each independently shippable)

### 0. Instruments and baseline

The tests the criteria need, landed on `main` before anything is built,
each proven by a deliberate break the way the grounding above proved the
existing ones -- through `barwise/scripts/mutate.mjs`, not by hand, and
with a `--force` rebuild after each restore wherever a bundle is read
(barwise-r7j):

- `measure-comparison.mjs startup | bundles | malformed | diff | trial`, each
  exiting 2 when it cannot see its input. `startup` and `bundles` build
  with `--force`. `startup` reproduces the hand measurements in "How each
  criterion was tested" and adds `barwise validate`.
- The byte-layout test (G2): one entity type and one value type carrying
  every optional field, serialized and compared to literal YAML. Proven
  by moving any one field assignment in `serializeObjectType`.
- The data type enum drift test (G3, closes barwise-0lf). Proven by
  dropping a member from each side.
- The malformed-input probe set (D2): one fixture per case -- value type
  with `reference_mode`; entity without one; entity with `data_type`,
  `value_constraint` or `default_value`; cardinality `max < min`;
  negative `min`; empty value constraint; blank name; unknown data type;
  an excess property -- plus one file holding all of them. The scorer
  records problems reported, silent losses (a round trip that drops a
  field) and whether each message names the element and the field. It
  measures rather than asserts, because today fails by design; its own
  test plants a silent loss and checks the scorer reports it.
- The baseline run of each, recorded in this spec in a Baseline section
  that WS0 adds.

### Prerequisite: barwise-5fg

Refuse an entity type carrying `data_type`, `value_constraint` or
`default_value`, in the loader and the JSON Schema. Its own PR, merged
before the arms branch, so both start from a base that loses nothing.

### 1. Plain arm (provisional: grounded when WS0 lands)

On `experiment/effect-comparison-plain`, from the agreed base: a
hand-written `decodeObjectType` collecting every problem, the id source
per Open decision 1, messages that name the element and the field. If
TypeScript wins, this branch is barwise-973 progress and merges.

### 2. Effect arm (provisional: grounded when WS0 lands)

On `experiment/effect-comparison-effect`, from the same base and brief:
the slice as one Schema definition, decoded with `errors: "all"`, the id
source a declared requirement, messages customized to clear the D2 bar.
Merges only if the rule adopts, and then through an adoption spec.

### 3. Agent trials (provisional: not yet grounded)

Claude Code subagents, each in its own worktree, one pinned model, the
same prompt but for the style line and a primer of similar length, both
written in this workstream: an Effect 4 primer for the Effect arm, since
the model's training predates 4.0, and the sealed-record conventions of
`core-branching-load.spec.md` WS1 for the plain arm, so that context size
is not the difference measured. First a pilot of three T1 runs on the
plain arm to measure spread and cost; then five T1 runs and two T2 runs
on each arm (Open decision 4).
T1 and T2 branches are thrown away.

### 4. Measure, decide, record

Fill the criteria table, apply the rule as written, record the result
here and on barwise-973 and barwise-cu0. If TypeScript wins, merge the
plain arm and resume barwise-973. If Effect wins, open the adoption spec
(core's dependency rule, barwise-e8m, the remaining kinds).

## API and migration impact

None on `main` until WS4. WS0 adds two tests, a fixture directory and
one script; the prerequisite tightens the loader and the JSON Schema for
a document no example contains. The arms live on branches. Either arm's
merge keeps `OrmModel.addObjectType` and `OrmYamlSerializer` signatures,
so the radius beyond core is the id source (Open decision 1) and the
error text a malformed object type produces (D2).

## Open decisions (all resolved 2026-10-13)

1. **The id source -- resolved 2026-10-13: both arms make it visible.**
   barwise-e8m rules out "injected effect ports" in core, and one has
   existed since 2026-07-25: `setIdGenerator`, installed by every surface,
   read by every importer but NORMA. Each arm makes it visible in its own
   idiom -- a `newId` parameter in TypeScript, a declared requirement in
   Effect -- scoped to the slice's decoder, with `OrmModel` supplying the
   installed generator as today. Chosen over leaving it out because it is
   the only place in converted code where the "effects in the signature"
   half of the claim can be tested, and it adds no port, it names one.
   barwise-e8m stands on `main` unless WS4 adopts.
2. **Effect in core, on the arm branch -- resolved 2026-10-13: yes, on
   that branch only.** `core/CLAUDE.md` allows `yaml` and `ajv` "without
   discussion"; this spec is that discussion for one branch. The
   dependency is pinned exactly and never merged except through an
   adoption spec.
3. **The startup limit (G4) -- resolved 2026-10-13: an absolute 1
   second.** `barwise validate examples/models/learning-design.orm.yaml`
   stays under 1 second, median of 15, on both the npm package and the
   release bundle; the slowdown against today is reported and judges
   nothing. That model is the reference because it is the largest in
   `examples/models/` (531 lines). An absolute limit depends on the machine,
   so `startup` records the Node version, CPU model and commit with every
   reading, both arms are read on one machine back to back, and the gate
   is judged on that machine. The draft recommended a
   10% relative threshold, which would have rejected changes no user
   could notice: about 1 second is where a wait starts to interrupt a
   person's train of thought, and today's CLI sits near 0.7 s, inside
   it. At the probe numbers the Effect arm passes with the
   `effect/Schema` import and fails with the full `effect` entry point.
4. **Agent trial size -- resolved 2026-10-13: full trials.** A pilot of
   three T1 runs on the plain arm measures spread and cost first, then
   five T1 runs and two T2 runs per arm, whatever the pilot shows. The
   draft recommended running T2 only if T1 resolved or D1 and D2 split;
   the full set was chosen so the agent claim is tested on the larger
   task as well. Each T2 run is about the size of WS1 step 1 (30 files),
   so T2 carries most of the cost; the pilot still sets the
   resolvability bound D3 reports against.
5. **Effect version -- resolved 2026-10-13: 4.0.x, pinned exactly.**
   3.22 is mature and better known to agents, but adopting it now would
   mean a forced major migration later; the familiarity risk is what the
   D3 tripwire watches.

## Risks and testing

- Every experiment branch keeps `ci:local` green at each push; the arms
  are measured, not merged, until WS4.
- The byte-layout and enum tests land on `main` and stay: they guard
  today's serializer whatever the comparison decides.
- Measurements are medians of 15 runs on one machine, taken back to back
  for both arms; a run-to-run spread wider than the difference between
  arms is reported as such, not averaged away.
- `--force` on every build that feeds a measurement (barwise-r7j).

## Non-goals

- No change to any surface, command, or file format on `main` before
  WS4, beyond barwise-5fg's refusal of a document that loses data today.
- No Effect anywhere on `main` before WS4 decides.
- No conclusion about Effect in the outer packages; this tests only the
  sealed-record slice and the two agent tasks.

## Appendix A: the arm brief

Given to both arms verbatim, with one line differing.

> Starting from commit `<base>`, add a decoder for object types that
> turns one parsed YAML object type into either an `ObjectType` or every
> problem with it. Each problem names the object type (by name, or by id
> when the name is the problem) and the field. The decoder must not
> reach the installed id generator itself: it takes the source of fresh
> ids as your arm's line below says, and `OrmModel.addObjectType`
> supplies today's installed generator. `OrmModel.addObjectType` and
> `OrmYamlSerializer.deserialize` keep their signatures and route through
> the decoder. For a model that loads today nothing visible changes: the
> full suite, `validate:examples` and the promptlab drift test stay green,
> and you may not edit the WS0 tests, the law tests or any golden file.
> For malformed input the error a caller receives changes as this brief
> requires. Unit tests of `createObjectType`, and tests that pin today's
> first-error message, may change; list each one and say why.
>
> Plain arm: write it in TypeScript with no new dependency; the id
> source is a `newId: () => string` parameter.
>
> Effect arm: write it with Effect 4.0.x Schema, pinned exactly in
> `packages/core/package.json`; the id source is a declared requirement
> of the decoding effect.

## Appendix B: agent task T1, add a field

> Add an optional `unit` (a string, e.g. "kg") to value types: the model,
> construction, YAML in both directions, the JSON Schema, and the model
> diff, which reports a changed unit. An entity type carrying `unit` is
> refused. Done when the full suite, `validate:examples` and the
> promptlab drift test pass, with a round-trip test for the new field.

Synthetic and never merged; chosen because adding a field is the most
common future change to this slice, and its diff is D1's measurement.

## Appendix C: agent task T2, convert `FactType` (provisional)

> Convert `FactType` to a sealed record as `core-branching-load.spec.md`
> WS1 describes, keeping `OrmModel.addFactType` and the YAML layout.

Re-scope before running if the Effect arm would need a schema for every
constraint kind (the first premortem tripwire); `SubtypeFact` (114 lines,
10 importing files) is the fallback.
