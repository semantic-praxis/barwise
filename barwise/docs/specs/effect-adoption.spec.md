# Adopting Effect Schema for the rest of the sealed-record metamodel

Status: WS0 implemented 2026-10-15 (the instruments and their baselines;
see WS0); the spike (WS1) and the workstreams after it not started
Created: 2026-10-15
Last-updated: 2026-10-15
Tracking: barwise-jo5 (this spec); barwise-973 (WS1 of
`core-branching-load.spec.md`, the work this restyles; held until WS1
here passes or fails); barwise-cu0 (`effect-comparison.spec.md`, whose
Result opens this spec); barwise-e8m (the core-purity commitment,
Open decision 2)

In one sentence: build `FactType` and its 16-kind `Constraint` union in
Effect Schema on a branch first, against gates fixed here, because that
union is the one part of the metamodel the comparison did not test; if
it passes, land Effect in core kind by kind, starting from the
comparison's `ObjectType` slice, with Effect types in core's public API;
if it fails, resume barwise-973 in plain TypeScript from the plain arm.

## Principle

The comparison (`effect-comparison.spec.md`, Result) recommends Effect
for the rest of barwise-973 on composability and DRY: one Schema
definition yields the record type, the YAML codec and the refusals,
where today one object type is stated four times in three files. It
recommended it narrowly. G1-G4 held for both arms, D3 cast no vote, and
D1 favoured Effect on hunks and lines while tying on files, under a
reading of "better" the owner chose after seeing the data. A narrow
recommendation is a reason to buy the next piece of evidence before the
dependency, not after.

The next piece of evidence is the `Constraint` union. `ObjectType` and
`SubtypeFact`, the two kinds the comparison built, have no nested
unions. `FactType` carries 16 constraint kinds, three of which nest a
join-path operand, and the first premortem story in the comparison --
"the slice did not predict the rest" -- names exactly this. Determinism
in core is not at stake in either style: decoding is pure.

## Should the adoption start with a spike? (resolved: yes, owner's call)

Merging the `ObjectType` slice first would be faster to start, and it
would leave core half in Effect if the union then went badly: a mixed
metamodel is worse than either style, and backing the slice out costs a
second migration of the same 84 sites. The spike costs one branch that
may be thrown away. The owner chose the spike on 2026-10-15.

The measurement that makes the spike more than caution, taken while
grounding this spec: the Effect arm's one `ObjectType` schema raised
core's cold type-check from 25,911 to 38,815 instantiations (+50%) and
from 2.5 s to 3.3 s total, against the plain arm on the same base
(`tsc --noEmit --incremental false --extendedDiagnostics`, median of
three, `8398a193` against `8d36e4fc`; `main` at `a94ea276` reads
25,382 and 2.5 s).
Instantiation counts grow with union width in Schema's type-level
machinery, so a 16-member union with nested members is where a
type-check cost would show if it is going to.

## Scope

In scope:

- When WS0 lands, `main` shall carry the instruments the spike's gates
  read, each shown to detect its failure by a deliberate break, with
  their baselines recorded in this spec.
- When the spike (WS1) is read, the result shall be recorded here with
  every gate's measured value, and the next step taken is the one the
  gates select: WS2 onward, or barwise-973 resumed in plain TypeScript.
- When a fact type, a role or a constraint fails to decode, core shall
  report every problem in one pass, each naming the fact type, the
  constraint (by id when it has one, else by position) and the field.
- When Effect lands in core (WS2), `core/CLAUDE.md`'s dependency rule
  shall list `effect` beside `yaml` and `ajv`, pinned to an exact
  version.
- When any workspace package declares `effect`, a test shall fail
  unless its version is exactly core's.
- When core exports an Effect-returning decoder, it shall also export
  the synchronous boundary for the same decode, so a caller can stay
  out of Effect.

Out of scope: `ModelBuilder`, `build()` and `ModelFragment` (WS5 below,
provisional; their style follows from WS1 to WS4 but they are
barwise-973's design, not this spec's); Effect in the outer packages
(`llm` retries, timeouts and cancellation, a separate question the
comparison set aside); the ReScript experiment (barwise-933); the
JSON Schema's generation (Open decision 3 keeps it hand-written).

## Decision gates for the spike (fixed here, before it is built)

The spike passes only if every gate holds. There is no decider: the
comparison already chose between the styles, and the spike asks only
whether the choice survives the union.

| #  | Gate                                  | Stands for                                         |
| -- | ------------------------------------- | -------------------------------------------------- |
| S1 | Valid input unchanged                 | Nothing changes for a model that loads today       |
| S2 | Fact type and constraint YAML layout  | Users' model diffs stay quiet                      |
| S3 | `Constraint` type is the target       | Code that switches on a kind keeps compiling       |
| S4 | Every problem, named, in one pass     | Time to fix a bad model; no silent loss            |
| S5 | Startup under 1 second                | Responsiveness of every CLI command                |
| S6 | Core cold type-check under 10 seconds | A commit or a save stays a pause, not a task break |

**How each is read.**

- **S1.** The full suite, `validate:examples`, and promptlab's
  `referenceDrift.test.ts` green; the golden files and round-trip corpus
  unchanged. Same instrument as the comparison's G1.
- **S2.** A byte-layout test for fact types, roles and constraints, the
  counterpart of `objectTypeLayout.test.ts`, written in WS0. Today's
  constraint serialization is pinned in parts by
  `Phase2ConstraintSerialization.test.ts` and
  `JoinConstraintSerialization.test.ts`, which check values after a round
  trip, not key order; G2 in the comparison found the same gap for
  object types (5 of 10 optional fields pinned).
- **S3.** A compile-time test that the Schema-derived `Constraint` is
  mutually assignable, kind by kind, with `ConstraintRecord`: the record
  type barwise-973 targets (`core-branching-load.spec.md`, Target
  architecture), which is today's union with two narrowings -- `id` and
  `modality` required, and a join constraint's `operands` a tuple of at
  least two. (That spec's third, `ValueConstraintDef.ranges` required,
  is on an object type's value constraint, not on a member of this
  union; see WS0's implementation notes.) Comparing against
  today's union instead would fail a correct conversion, because the
  spike makes those narrowings too. `ConstraintRecord` is frozen in
  WS0 (`core/tests/types/constraintRecord.ts`): written out kind by kind,
  importing nothing from `src/`, because the spike replaces `Constraint`
  and a reference computed from it would move with it. On `main` a type
  test holds the frozen copy to today's union with the two narrowings
  applied, so it cannot have drifted before the spike starts; on the
  spike the same comparison, made against the derived `Constraint`, is
  S3. This is the union-specific gate:
  consumers switch on `c.type` with `assertNever`
  (`core-branching-load.spec.md`, WS4), and a derived type that widens
  a field or loses a discriminant breaks them silently at the type
  level, not at run time. Sites that build a constraint without an `id`
  or `modality` change, as barwise-973 already plans; the spike counts
  them and they do not fail the gate.
- **S4.** Malformed-input fixtures for fact types and constraints in
  `core/tests/fixtures/malformed/`, scored by the same `malformed`
  subcommand. The completion bar is the comparison's D2: every case
  reported, every message naming the element and the field, no silent
  loss, singly and in one combined file. WS0 writes the cases; the
  plain decoder they are baselined against is today's loader. The
  scorer must be extended first: `scripts/lib/malformed-score.mjs`
  reads only `object_types` -- `caseProblem` picks the failing object
  type, `combine` copies only object types into the combined file, and
  `lostKeys` compares only their top-level fields -- so a fact type case
  today would be blamed on its supporting object type, vanish from the
  combined file, and lose a nested constraint field unseen.
- **S5.** `measure:comparison -- startup`, median of 15, npm package and
  release bundle, on one machine. The 1-second limit and its reason are
  the comparison's Open decision 3: about 1 second is where a wait
  starts to interrupt a train of thought. The Effect arm read 564 ms; the
  headroom is what the remaining schemas may spend.
- **S6.** `measure:comparison -- typecheck`: `tsc --noEmit --incremental
  false` in `core`, median of three.
  The limit is 10 seconds because the pre-commit hook builds every
  package a change touches and a developer waits on it at every commit,
  and about 10 seconds is where a wait stops being a pause in the task
  and becomes a switch away from it -- the same response-time research
  the 1-second limit rests on, at its second threshold. Today 2.5 s; the
  Effect arm 3.3 s. Instantiations are reported beside it and judge
  nothing.

**The outcome where everything goes as intended passes every gate.** A
Schema union that decodes today's corpus to today's records, through
today's serializer, is S1-S3 by construction; S4 is the brief; S5 and S6
have headroom of 436 ms and 6.7 s at the arm's readings (taken on the
comparison's machine; WS0's baselines below are from another, which is
why the spike reads both heads back to back).

## How this spec weighs D1

The comparison's Result asks the adoption spec to weigh the files-only
tie D1 would otherwise have been. It is weighed in three places, and
nowhere else:

- The spike exists, rather than an immediate merge. A recommendation
  that rests on a post-data reading of one criterion buys more evidence
  before it buys a dependency.
- The spike's fallback is the plain arm, not a fresh start, so failing
  costs the spike and nothing that came before it.
- The spike has no decider of its own. Re-litigating D1 on fact types,
  where no plain arm exists to compare against, would measure one arm
  against nothing.

## Inventory

| Area                                                  | Today on `main`                                    | Verdict                                           |
| ----------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------- |
| `core/src/model/ObjectType.ts`, `objectType.ts`       | hand-written sealed union (barwise-973 step 1)     | WS2: replaced by the Effect arm's schema          |
| `core/src/model/SubtypeFact.ts`, `yaml/subtype.ts`    | class                                              | WS3: from the `trial/effect-t2-m2` run            |
| `core/src/model/Population.ts`, `ObjectifiedFactType` | classes                                            | WS3                                               |
| `core/src/model/FactType.ts`, `Role.ts`               | classes, 206 + 28 lines                            | WS1 spike, landed in WS4                          |
| `core/src/model/Constraint.ts`, `yaml/constraint.ts`  | 16-kind union, 704 + 227 lines, plus `rolePath.ts` | WS1 spike, landed in WS4                          |
| `core/src/model/id.ts`                                | `setIdGenerator`, installed by each surface        | stays; boundaries provide `IdSource` from it      |
| `core/schemas/orm-model.schema.json`                  | hand-written                                       | stays hand-written, drift-tested per kind         |
| `core/CLAUDE.md` dependency rule                      | `yaml`, `ajv`                                      | WS2: adds `effect`, exact                         |
| `core/tests/fixtures/malformed/`                      | 11 object type cases                               | WS0 (done): 17 fact type and constraint cases     |
| `core/tests/serialization/`                           | `objectTypeLayout.test.ts` only pins key order     | WS0 (done): `factTypeLayout.test.ts`              |
| `scripts/measure-comparison.mjs`                      | `startup`, `bundles`, `malformed`, `diff`, `trial` | WS0 (done): a `typecheck` subcommand for S6       |
| `scripts/lib/malformed-score.mjs`                     | reads `object_types` only                          | WS0 (done): fact types, constraints, nesting (S4) |
| `core/tests/types/`, `vitest.shared.ts`               | core type-checks no test file                      | WS0 (done): the S3 harness and its own tsconfig   |
| Downstream packages                                   | no `effect` dependency                             | WS2: version-agreement test; declare on first use |

`ModelGraph`, validation, verbalization and mapping read records, not
decoders, so they are untouched by the style as long as S3 holds; that
is the claim S3 exists to check rather than assume.

## Target architecture

```ts
// core, after WS4. One Schema per element kind; the record type, the
// YAML codec and the refusals derive from it.
//   ConstraintSchema = Schema.Union([InternalUniqueness, Mandatory, ...16])
//   FactTypeYamlCodec: snake_case YAML <-> FactType record
//
// Exported from core's root, both forms for every kind:
//   decodeFactType(doc: unknown):
//     Effect<FactType, FactTypeProblems, IdSource>
//   runFactTypeDecode(decoded, newId): FactType   // throws FactTypeError
//   IdSource                                       // Context.Service
//
// OrmModel and OrmYamlSerializer keep their signatures until barwise-973's
// ModelBuilder replaces them; each boundary provides IdSource from the
// installed generator, as the Effect arm's addObjectType does.
```

A consumer that wants Effect composes the `decode*` functions and
provides `IdSource`; a consumer that does not calls the synchronous
boundary and never imports `effect`. Both are exported because the owner
chose Effect in the public API (Open decision 1) and because the 84
consumer sites barwise-973 counts should not all have to learn Effect
to keep compiling.

## Alternatives considered

- **Merge the `ObjectType` slice now, `FactType` last.** Faster start;
  rejected because a failure on the union would strand core half in
  Effect (see "Should the adoption start with a spike?").
- **Effect internal to core.** Public functions keep plain signatures;
  downstream never imports `effect`, and Effect could be replaced
  without touching consumers. Rejected by the owner (Open decision 1):
  the declared requirement in the type is the half of the case for
  Effect that a consumer can use, and hiding it at core's edge discards
  it.
- **Generate the JSON Schema from Effect.** One less copy. Deferred: the
  comparison's Effect arm found three differences between the generated
  and hand-written schema, and the hand-written one feeds the editor and
  the LLM, where a change is user-visible (Open decision 3).
- **Spike a smaller union first** (`ValueConstraint`'s ranges). Cheaper,
  and it would not exercise the join-path operands, the widest nesting
  in the metamodel.

## Workstreams (each independently shippable)

### 0. Instruments and baselines, on `main` (done 2026-10-15)

Shipped: `core/tests/serialization/factTypeLayout.test.ts` (S2); the
`ConstraintRecord` target, `KindsMatch` and their type tests in
`core/tests/types/`, run by vitest's typecheck with a tsconfig of their
own (S3); 17 fact type and constraint cases in
`core/tests/fixtures/malformed/`, and `malformed-score.mjs` extended to
attribute a problem to a fact type and the constraint it sits in, carry
fact types and their object types into the combined file, and find a
field lost at any depth (S4); and `measure-comparison typecheck` (S6).
Each was shown to catch the failure it measures by a deliberate break:

- S2: swapping `definition` and `note` in `serializeFactType` fails the
  layout test and none of the other 209 serialization tests.
- S3: adding a member to `RingType` in `src/model/Constraint.ts` fails
  exactly the check that holds the frozen record to `src/` -- the
  assertion that is S3 on the spike; `KindsMatch` rejects a widened
  field, array join operands, a missing kind, an extra kind and an extra
  field; and `wiring.test.ts`, which reads the files TypeScript resolves
  for the type tests' tsconfig, fails when that tsconfig stops
  compiling them (dropping its `exclude: []` lets core's inherited
  `tests/` exclusion back in).
- S4: six stand-in scorer defects -- a fact type position read as an
  object type's, a `combine` that drops fact types, a `lostKeys` that
  stops at the top level, a constraint credited whatever it names, a
  field matched inside a longer word, and a constraint with an id
  credited for its position -- each fail their test in
  `measure-comparison.test.mjs`.
- S6: a stand-in `tsc` in a throwaway tree drives each exit: a reading,
  over the limit, no totals printed, and a tree that does not compile.

**Baselines**, taken 2026-10-15 on `main` at `2704da6a` with this
workstream's tests and scripts added -- WS0 changes no file under
`core/src`, so these are main's readings -- on Node v26.7.0 and an Intel
Xeon 2.10 GHz x4 (not the comparison's machine):

| Gate | Reading on `main`                                                                                                                   |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------- |
| S1   | full suite, `validate:examples`, `referenceDrift.test.ts` green (`ci:local` on the WS0 head)                                        |
| S2   | `factTypeLayout.test.ts` green                                                                                                      |
| S3   | 10 type tests green; today's union does not match the frozen record, and does once the two narrowings are applied                   |
| S4   | singly: object types 10/11 (9 named), fact types 13/17 (13 named; constraint named 4/11); combined 19/28 (19 named; 4/11); 0 losses |
| S5   | `validate` 341 ms npm, 387 ms bundle, 302 modules and 1.47 MB loaded                                                                |
| S6   | 2,410 ms median (2,300-2,790), 25,382 instantiations                                                                                |

What S4 leaves for the spike, singly: the four unknown-field cases (a
fact type's, a role's, a constraint's, and the object type's from the
comparison) are refused with a message that never names the field;
`frequency-max-below-min` loads without a word; and five of the eleven
constraint cases give their constraint an id, which today's loader never
names -- it reports a position, which S4 accepts only for a constraint
without one. The other six have no id, so positional naming is measured
too. In the combined file
the schema check stops before the reading check, so a bad placeholder
reported singly goes unreported there.

**Implementation notes** (what grounding WS0 changed in the draft):

- **S3 names two narrowings, not three.** The draft listed
  `ValueConstraintDef.ranges` among the narrowings to `Constraint`.
  `ValueConstraintDef` is the object type's value constraint
  (`model/ObjectType.ts`); the `value_constraint` constraint kind has
  its own optional `ranges` and `core-branching-load.spec.md` leaves it
  as today. Found writing the mapped type against `Constraint.ts`.
- **A type test outside its tsconfig passes.** Core's tsconfig excludes
  `tests/`, and vitest's typecheck given it reported a deliberately false
  assertion as "no errors": the compiler never saw the file. The type
  tests get `tests/types/tsconfig.json`, `PackageTestShape` gains a
  `typecheck` option that requires one, and `wiring.test.ts` checks
  every type test is among the files TypeScript resolves for it. knip
  names the `*.test-d.ts` files as core entries, since its vitest plugin
  reads only `test.include`.
- **Review found three ways the instruments could pass what they
  measure** (Copilot on PR #670, all fixed before merge). The first
  `ConstraintRecord` was a mapped type over `Constraint`, so once the
  spike replaced `Constraint` the reference would have moved with it;
  it is now frozen. `namesField` matched a field as a substring, so
  `type` was found inside `fact_types` and a message naming no field was
  credited; it now matches whole words. And a constraint with an id
  could be credited for its position, which S4 does not allow. The
  first two changed no baseline reading. The third could not have,
  because no fixture gave its constraint an id -- so the id rule was
  never measured, which a second review caught. Five constraint cases
  now carry ids, and constraint naming reads 4/11 where it read 9/11. A
  third review found two more, also fixed: whole-word matching still
  read the `type` in "Fact type" as the field, and the S2 layout pinned
  only one of a range's two inclusive flags, so swapping their order in
  the serializer passed. Neither changed a reading. The first `wiring.test.ts` matched include patterns as
  written, so an inherited exclusion could drop the type tests unseen;
  it now reads TypeScript's resolved file list.
- **S4's cases stop at the element.** A problem that needs another
  element to see -- a constraint naming a role outside its fact type, a
  role naming an object type that does not exist -- is not a case: the
  validator reports all six such problems tried today, and barwise-973
  moves those reference checks into the model builder, not into decoding
  one element. A value check inside one constraint (frequency max below
  min) is a case, as cardinality's was for object types in the
  comparison. Two cases first carried a second problem (a ring and a
  value comparison across a Person role and an Age role); every
  constraint case was then checked by fixing its one problem and
  confirming the model loads and validates clean.
- **The object type half of the combined reading moved from 4 to 7 of
  11** against the six messages `measure-comparison.test.mjs` holds from
  `78b52f5b`. The loader's messages have improved since (each now names
  its field), and each credited message was checked to be an object
  type's own; the test's text stays as the record of that commit.

### 1. The spike: `FactType`, `Role` and `Constraint` in Effect (experiment branch)

On `experiment/effect-adoption-facttype`, from `main` with the Effect
arm's `ObjectType` slice brought forward, so the spike measures the
metamodel as it would be after WS2. Converts `FactType`, `Role`, every
constraint kind and the join-path operand to Schema, with the decoder,
the YAML codec, the problem type and the synchronous boundary. Reads
S1-S6 and records the result here. Pass: WS2 starts. Fail: this spec is
closed with the reading, barwise-973 resumes in plain TypeScript from
`experiment/effect-comparison-plain`, and the branch stays as the
evidence. Nothing merges from this workstream.

### 2. Effect in core: the dependency and the `ObjectType` slice (provisional: not yet grounded)

The Effect arm (`8d36e4fc`) rebased onto `main`: `effect` pinned exact
(4.0.5 is current; the arm used 4.0.4, and the bump is part of this
workstream's grounding), `core/CLAUDE.md`'s dependency rule, the version
agreement test, and the `ObjectType` schema, decoder and drift test. The
first PR that changes malformed-object-type error text; G1-G4 re-read on
the rebased head.

### 3. `SubtypeFact`, `ObjectifiedFactType`, `Population` (provisional: not yet grounded)

`SubtypeFact` starts from `trial/effect-t2-m2`, which passed every T2
check in one round. Each kind is its own PR if the radius allows, with
the name-rule mutations `core-branching-load.spec.md` (WS1 step 1)
found every conversion needs.

### 4. `FactType`, `Role` and `Constraint` from the spike (provisional: not yet grounded)

The spike's branch, rebased and split as review needs. Largest radius
in the spec: 30 files in core import `Constraint.ts`, and 22 source
files in other packages use its types.

### 5. `ModelBuilder` (provisional: not yet grounded)

barwise-973's remaining scope -- `build()`, `BuildResult`,
`ModelFragment`, `ModelBuilder.from(model)` -- in the style WS1-WS4
established. Its design stays in `core-branching-load.spec.md`; this
entry only records that it follows.

## API and migration impact

- **Core's public API gains Effect types**: `decode*` functions
  returning `Effect<Record, Problems, IdSource>`, the `IdSource` service,
  and the problem classes, beside a synchronous boundary for each.
- **Downstream packages** do not depend on `effect` until they import
  from it; when one does, it declares `effect` at core's exact version,
  checked by WS2's test. A package that only calls synchronous
  boundaries never declares it.
- **Error text** for malformed input changes kind by kind (one problem
  per line, each naming the element and the field), as the comparison's
  D2 already accepted for object types.
- **Bundles** grow about 0.2 MB each where core loads (comparison R2);
  startup about 154 ms (G4). Both re-read per workstream.

## Open decisions (for review)

1. **Effect types in core's public API -- resolved 2026-10-15 by the
   owner: exported.** Alternative and trade-off under Alternatives
   considered. Consequence carried here: a future Effect major is a
   breaking change to core's API, not an internal upgrade, so it needs
   its own spec.
2. **`IdSource` against barwise-e8m.** barwise-e8m commits core to "no
   injected effect ports". `IdSource` is the existing `setIdGenerator`
   port named in the type rather than a new one, and it is now public.
   Options: (a) keep `setIdGenerator` as what each surface installs and
   have every boundary provide `IdSource` from it, so nothing changes
   for the surfaces; (b) retire `setIdGenerator` and make every caller
   provide `IdSource`, which removes the process-wide install but
   touches every surface. Recommend (a) for this spec, and revisit (b)
   with `ModelBuilder`, where the edit path is redesigned anyway. Either
   way, barwise-e8m's note should record that core now names a port it
   previously hid.
3. **JSON Schema: hand-written or generated.** Recommend hand-written
   with a drift test per kind, as the Effect arm did: the Effect
   arm found three differences between the generated and hand-written
   object type definition, and the schema
   is read by the editor and the LLM, where a change is user-visible.
   Revisit when the drift tests show the two agreeing for every kind.
4. **What a failed spike leaves behind.** Recommend: the WS0
   instruments stay on `main`, the branch is kept as evidence, and
   barwise-973 resumes from the plain arm (`8398a193`), the comparison's
   fallback.

## Risks and testing

- The spike is measured, not merged. Every gate is read on one machine,
  the spike head and `main` back to back, with `--force` builds
  (barwise-r7j).
- S3 is a compile-time test, run by vitest's typecheck; WS0 showed it
  fails when a candidate widens the join operands, lacks a kind, or adds
  a field, and that `wiring.test.ts` fails when a type test is not
  compiled at all.
- Each landing workstream re-reads S1, S2, S5 and S6 on its own head;
  the full monorepo build and tests run after each, since every
  workstream changes core's public API.

## Non-goals

- No change to `main` beyond WS0's instruments before the spike passes.
- No Effect in `llm`, `cli`, `mcp` or `vscode` beyond declaring the
  dependency where a package imports a core decoder.
- No new capability: this restyles how core holds and decodes a model,
  not what it accepts or serializes.
