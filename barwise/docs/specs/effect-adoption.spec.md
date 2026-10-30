# Adopting Effect Schema for the rest of the sealed-record metamodel

Status: WS0 implemented 2026-10-15 (the instruments and their baselines;
see WS0); WS1 read on format 2.0 at #672 and passed (see 1r); the spike
restarted on format 3.0 2026-10-29 (1r), R0 to R3 done, R4 built and its
WS1 reading taken 2026-10-30 and passed (S4 as Open decision 15 resolved
it); WS1b parts B3, C, D and E not started; WS2 onward not started
Created: 2026-10-15
Last-updated: 2026-10-30
Tracking: barwise-jo5 (this spec); barwise-4r3 (Effect alone on load,
WS1b part B); barwise-r27 (the blind-spot harness, part A); barwise-wia (generated JSON
Schema, part C); barwise-5ly (one format definition, part E); barwise-s6q
(derived generators, part D); barwise-973 (WS1 of
`core-branching-load.spec.md`, the work this restyles; held until WS1
here passes or fails); barwise-cu0 (`effect-comparison.spec.md`, whose
Result opens this spec); barwise-e8m (the core-purity commitment,
Open decisions 2 and 8); barwise-elq (experiments on "names the field", Open
decision 6)

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
in core is kept by Open decision 8: the decoder requires ids and takes no id source, so decoding is a pure function of its input. Ids are minted only at the synchronous boundary.

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
whether the choice survives the union. On 2026-10-15, before the spike was
built, the owner moved S6 from a gate to a measure: a time limit was not
one the owner cared about, so no number decides.

| #  | Gate                                      | Stands for                                    |
| -- | ----------------------------------------- | --------------------------------------------- |
| S1 | Valid input unchanged                     | Nothing changes for a model that loads today  |
| S2 | Fact type and constraint YAML layout      | Users' model diffs stay quiet                 |
| S3 | `Constraint` type is the target           | Code that switches on a kind keeps compiling  |
| S4 | Every problem, named, in one pass         | Time to fix a bad model; no silent loss       |
| S5 | Startup under 1 second                    | Responsiveness of every CLI command           |
| S6 | Core cold type-check, reported (no limit) | Recorded with each head; no threshold decides |

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

  **What "names the field" means, for now (accepted 2026-10-15).** A field
  counts as named when its words appear in sequence as a path segment or a
  standalone phrase. It does not count inside a longer identifier (`type`
  inside `fact_types`), or as the kind word of an element label (the
  `type` in `Fact type "X"`). The best definition is an experiment,
  tracked as barwise-elq. The scorer's property tests will use
  `fast-check`, which the owner approved as a dev dependency on 2026-10-15;
  it lands with its first import, not before.
- **S5.** `measure:comparison -- startup`, median of 15, npm package and
  release bundle, on one machine. The 1-second limit and its reason are
  the comparison's Open decision 3: about 1 second is where a wait
  starts to interrupt a train of thought. The Effect arm read 564 ms; the
  headroom is what the remaining schemas may spend.
- **S6, reported.** `measure:comparison -- typecheck`: `tsc --noEmit
  --incremental false` in `core`, median of three. It reports time and
  instantiations for every head and judges neither, since the owner set no
  limit. Today 2.5 s and 25,382 instantiations; the Effect arm 3.3 s and
  38,815. The reading is kept because a slow type-check is what a
  developer feels at commit time, and the numbers show whether a union
  makes it worse.

**The outcome where everything goes as intended passes every gate.** A
Schema union that decodes today's corpus to today's records, through
today's serializer, is S1-S3 by construction; S4 is the brief; S5 has
436 ms of headroom at the arm's readings (taken on the comparison's
machine; WS0's baselines below are from another, which is why the spike
reads both heads back to back). S6 is reported, not judged.

### Reported measures for the spike (added 2026-10-15; not gates)

Added after the gates above were fixed, so they change no pass or fail
rule. They inform the adoption decision as the comparison's R-measures
did. M1 to M4 are read on the spike's own head. `main` has no Effect
schemas or derived values, so its M1 to M4 baselines are not applicable.
M5's baseline on `main` is the hand-written count. Every reading is taken
on one machine, with the same definitions.

- **M1, derivation.** `Arbitrary.schema` returns a generator for the
  kind's Schema, and for the whole union. Reads yes or no, and on a no,
  the construct it names. Derivation is marked unstable in the pinned
  Effect version, so each yes is reported with that version.
- **M2, encodability (self-consistency).** The share of derived values
  that the same Schema encodes. It shows the generator stays inside the
  Schema's own domain. It does not show the values are valid for the
  class: only M4 does that.
- **M3, round trip.** The share of derived values for which encoding and
  then decoding gives back the same value, with object keys compared
  unordered. Key order is pinned separately, by S2.
- **M4, independent acceptance.** The share of encoded values that the
  hand-written JSON Schema accepts, through core's existing
  `SchemaValidator`. This is the only measure whose answer key does not
  come from the Schema under test. `SchemaValidator` validates whole
  documents, so each encoded element is checked inside the smallest valid
  document around it. The root requires `orm_version` and `model`.
  - An object type sits in `model.object_types` and needs no enclosing
    element.
  - A fact type sits in `model.fact_types`. Its roles name object types,
    so the document also carries those, from the same generator run.
  - A role, a constraint, or a join-path operand is not valid alone. It is
    checked inside an enclosing fact type, which must itself be valid: an
    `id`, a `name`, nonempty `roles` and nonempty `readings`, which the
    JSON Schema requires. The wrapper supplies those fields and no others.
    Every generated field is kept unchanged, so the wrapper cannot hide a
    defect in the element it encloses.
- **M5, replaced lines.** The lines of hand-written generator in
  `core/tests/arbitraries/model.ts` that a demonstrated derived generator
  replaces, by kind. A replacement counts only if it keeps reference
  coordination and shrinking (below). Adapter code is reported separately
  and is not netted against the lines it serves.
- **Shrinking, reported with M5.** For each replaced generator, whether a
  failing value still shrinks to a small failing value that the Schema
  accepts. The hand-written generators depend on this: the `arbRange`
  default on line 250 exists so the shrinker never produces a range the
  model would reject. A derived generator's shrinking is unmeasured until
  the spike reads it.

Refusal cases stay out of M2 to M4, and out of every property. A derived
generator produces values the Schema accepts. The refusal cases come from
the S4 fixtures and the frozen reference, not from the Schema being
measured.

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

| Area                                                  | Today on `main`                                    | Verdict                                                                               |
| ----------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `core/src/model/ObjectType.ts`, `objectType.ts`       | hand-written sealed union (barwise-973 step 1)     | WS2: replaced by the Effect arm's schema                                              |
| `core/src/model/SubtypeFact.ts`, `yaml/subtype.ts`    | class                                              | WS3: from the `trial/effect-t2-m2` run                                                |
| `core/src/model/Population.ts`, `ObjectifiedFactType` | classes                                            | WS3                                                                                   |
| `core/src/model/FactType.ts`, `Role.ts`               | classes, 206 + 28 lines                            | WS1 spike, landed in WS4                                                              |
| `core/src/model/Constraint.ts`, `yaml/constraint.ts`  | 16-kind union, 704 + 227 lines, plus `rolePath.ts` | WS1 spike, landed in WS4                                                              |
| `core/src/model/id.ts`                                | `setIdGenerator`, installed by each surface        | stays; read only at the synchronous boundary (Open decision 8)                        |
| `core/schemas/orm-model.schema.json`                  | hand-written                                       | generated from Effect, draft 2020-12 (Open decision 9)                                |
| `core/CLAUDE.md` dependency rule                      | `yaml`, `ajv`                                      | WS2: adds `effect`, exact; `ajv` to dev once nothing loads with it (Open decision 10) |
| `core/tests/fixtures/malformed/`                      | 11 object type cases                               | WS0 (done): 17 fact type and constraint cases                                         |
| `core/tests/serialization/`                           | `objectTypeLayout.test.ts` only pins key order     | WS0 (done): `factTypeLayout.test.ts`                                                  |
| `scripts/measure-comparison.mjs`                      | `startup`, `bundles`, `malformed`, `diff`, `trial` | WS0 (done): a `typecheck` subcommand for S6                                           |
| `scripts/lib/malformed-score.mjs`                     | reads `object_types` only                          | WS0 (done): fact types, constraints, nesting (S4)                                     |
| `core/tests/types/`, `vitest.shared.ts`               | core type-checks no test file                      | WS0 (done): the S3 harness and its own tsconfig                                       |
| Downstream packages                                   | no `effect` dependency                             | WS2: version-agreement test; declare on first use                                     |

`core/tests/arbitraries/model.ts` (1,010 lines) is the suite's hand-written
whole-model generator. Lines 242 to 319, 78 lines, are the candidate
inventory for M5: element-level generators a Schema might describe. The
range is not all element data. Lines 297 to 308 hold reference-coordination
fields (`playerPicks`, `ownerPick`, `rolePicks`) that the materializers at
lines 487 to 552 use to wire roles to object types and fact types. No
element Schema supplies those, so a replacement must keep them, and any
adapter code that does is reported separately. Only demonstrated
replacements count toward M5. Nothing in the file changes on `main` before
the spike passes.

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
// Exported from core's root, both forms for every kind. The decoder
// requires every id and takes no id source (Open decision 8); no Effect
// service is exported.
//   decodeFactType(doc: unknown): Effect<FactType, FactTypeProblems>
//   runFactTypeDecode(doc): FactType              // throws FactTypeError
//
// OrmModel and OrmYamlSerializer keep their signatures until barwise-973's
// ModelBuilder replaces them. Two boundaries fill missing ids from the
// installed generator, then decode: config construction (an importer, the
// LLM, createObjectType) for any kind, and the file loader only for kinds the
// file format lets omit an id (every constraint kind today). Where the file
// format requires an id, a missing one is refused, not filled.
```

A consumer that wants Effect composes the `decode*` functions; a consumer
that does not calls the synchronous boundary and never imports `effect`. Both are exported because the owner
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
  the LLM, where a change is user-visible (Open decision 3). Re-probed on
  the spike 2026-10-16 (WS1b, part C), with five differences named, and
  adopted by the owner the same day (Open decision 9).
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
  a slow reading (reported, not failed), no totals printed, and a tree that
  does not compile.

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

**Property tests (added 2026-10-15).** On the spike branch, each kind's
Schema gets derived generators, and three properties run over them, with
the run count and seed recorded:

- P1, every derived value encodes (M2).
- P2, encoding then decoding returns the same value, with object keys
  compared unordered (M3).
- P3, every encoded value passes the hand-written JSON Schema (M4).
  From WS1b the file is generated, and P3 is restated under Open
  decision 9.

P3 was the only independent check while the JSON Schema was hand-written;
from WS1b the file is generated and P3 checks agreement instead (Open
decision 9). P1 and P2 are self-consistency checks:
their expected answer comes from the Schema alone, by design. They show
the generator and the Schema agree, and they say nothing about validity for
the class. A Schema that is wrong the same way on both sides passes them.
Refusal expectations are never generated from the Schema. They stay with
the S4 fixtures.

Two constraints from the grounding below. A derived schema may not
contain `Schema.declare` unless the declaration carries a derivable link
(Open decision 5, now verified). And a property must encode a derived value
before decoding it, because derived values are the decoded type, with
camelCase keys.

A failed derivation is a result, not a blocker. If M1 reads no for a
kind, M2 to M4 are recorded as not applicable for that kind, and the
spike still passes if S1 to S5 pass. The declaration link is needed only
to measure the model codec. The spike takes it as its first step because
it is verified and cheap, not because a gate needs it.

The spike deletes no hand-written generator. Deletion happens in WS2 to
WS4, one kind at a time, and only for a kind whose M2 to M4 pass on its
own head.

**Grounding (2026-10-15, before the spike).** Probes ran on the Effect
arm's `ObjectType` schema, at `8d36e4fc`, because `main` has no Effect.
The probes are reproduced below. The spike's first commit turns them into
tests, so none stays a one-off.

- `Arbitrary.schema(ObjectTypeYamlCodec)` derives. 1,000 of 1,000
  generated values encode (M2), and 1,000 of 1,000 round trip with keys
  unordered (M3). That is the file-facing codec, whose data type names
  are literals.
- `Arbitrary.schema(ObjectTypeModelCodec)` throws `Unable to derive an
  arbitrary for an unsupported Declaration` at `dataType.name`. The
  cause is `Schema.declare` in `CONFIG_LEAVES`, the lenient leaf the model
  codec uses so that a config may name a data type outside the list.
  Open decision 5 covers the options, and the probe below verifies one.
- **Option (a) works.** A declaration whose annotation `toCodecArbitrary`
  returns a link to `Schema.String`, with a passthrough transformation,
  derives. Its runtime check and its TypeScript type are unchanged. 200 of
  200 derived values round-trip. The probe:

  ```ts
  const leaf = Schema.declare(
    (u: unknown): u is string => typeof u === "string",
    {
      toCodecArbitrary: () =>
        ({
          to: Schema.String.ast,
          transformation: SchemaTransformation.passthrough<string>(),
        }) as SchemaAST.Link,
    } as any,
  );
  const xs = Effect.runSync(
    Arbitrary.sampleEffect(Arbitrary.schema(leaf), { count: 200 }),
  );
  ```

  Without the annotation, the same call throws `Unable to derive an
  arbitrary for an unsupported Declaration`.
- Effect 4 has its own runner, `Arbitrary.sampleEffect` and
  `Arbitrary.checkEffect`. Passing an Effect arbitrary to fast-check fails
  with `this.arb.generate is not a function`.
- A first run decoded derived values directly. It rejected all 484
  entity values among its 1,000 samples. That was the probe's error, not a finding
  about the generator: derived values are the decoded type, so they must
  be encoded first. A property written that way fails every value and
  tests nothing.

Not yet measured: M1 on the 16-kind union, M4 on any kind, M5 for the
spike's derived generators, and whether the union needs `Schema.suspend`
to derive. Those are the spike's first readings.

### 1r. The restart on format 3.0 (added 2026-10-29)

In one sentence: the spike is rebuilt on `main`, merged step by step, on format 3.0,
porting what #672 showed still applies, and the 3.0 load path is decoded
by Effect alone once every key in it has a decoder, so the two-validator
merge layer #672 built and WS1b part B would have removed is never
written. The
owner chose the restart on 2026-10-29 over merging `main` into #672.

**WS1's reading on format 2.0, recorded from #672 at `55c56671`.**
Every gate held, `main` read back to back on the same machine:

| Gate | `main`                          | Spike                                                                                              |
| ---- | ------------------------------- | -------------------------------------------------------------------------------------------------- |
| S1   | suite green                     | all 12 packages green; 3,074 constraints and 1,502 fact types in 85 files read to the same records |
| S2   | layout tests green              | layout tests green                                                                                 |
| S3   | --                              | the Schema type is the frozen `ConstraintRecord`, kind by kind; a planted widening fails it        |
| S4   | combined 19/28 reported         | 28/28 reported and named, constraints named 11/11, 0 silent losses                                 |
| S5   | `validate` bundle 438-451 ms    | 471-483 ms, under the 1 s limit; 430 modules and 4.12 MB loaded, against 302 and 1.47 MB           |
| S6   | 2,730 ms, 25,382 instantiations | 3,590 ms, 70,036 instantiations (reported, no limit)                                               |
| M1   | --                              | derives for all 16 kinds and both object type codecs; P1 to P3 1,000 of 1,000 (seed 1)             |

M5 and the shrinking reading were not taken. The spike therefore passed
WS1 on the format of its day. It is restarted because that format is gone,
not because a gate failed.

**What format 3.0 changed under the spike (verified on `main` at
`a91fe22c`).**

- **There are 17 constraint kinds, not 16.** `join_ring` joined the
  union after #672, and `disjunctive_mandatory`, `exclusion` and
  `exclusive_or` now take an operand over roles or over subtype facts
  (orm-format-3 WS4b). #672's Schemas have neither. The frozen
  `ConstraintRecord` on `main` already has both, so S3 refuses a port that
  lacks them.
- **A constraint lives where its kind says.** `PLACEMENT` in
  `model/Constraint.ts` splits the kinds into internal ones, under
  `fact_types[].constraints`, and external ones, under
  `model.constraints`. `refuseMisplacedConstraints` refuses a kind in the
  wrong list by name, before validation, and stops at the first one.
- **A 3.0 file states every constraint id.** The 3.0 schema requires it,
  so Open decision 8's fill for file loading never runs on 3.0: the 3.0
  loader fills nothing. Ids are filled only by construction, and the 2.0
  reader derives the ones a 2.0 file omits (`derivedId.ts`). The
  optional-id stage WS1b part C described is not written.
- **The preferred identifier is the entity's.** An entity carries
  `preferred_identifier` (a constraint id), and no constraint carries
  `is_preferred`. #672's refusal of `isPreferred: false` goes with the
  field.
- **A file below 3.0 has its own reader.** `readLegacy` reads 2.0 (and
  1.x, migrated to 2.0 first) straight into the model, validated against
  the frozen `orm-model-2.0.schema.json`. There is no 2.0-to-3.0 document
  migration. It shares the element deserializers (`yaml/objectType.ts`,
  `yaml/factType.ts`, `yaml/constraint.ts`) with the 3.0 reader.
- **The header gained `namespace`** beside `name`, `domain_context` and
  `note`, and a document with no `orm_version` reaches the 3.0 path,
  which reports it missing.
- **The corpus.** Of the 119 tracked models, 13 are 3.0 and 106 older;
  28 of the 2.0 files are the S4 fixtures, which `main` refuses on
  purpose.
- **The WS0 instruments still hold on `main`:** the layout tests pin the
  3.0 writer's output (S2), and the frozen `ConstraintRecord` matches the
  union with its two narrowings (S3). The 28 malformed fixtures and the
  scorer's combined file are 2.0 (S4), and the scorer knows only
  `object_types` and `fact_types`.

**What the restart changes in the plan.**

- **ajv leaves the 3.0 path once, when every key has a decoder.** Until
  then the loader is `main`'s, unchanged. Each new decoder is held by its
  own tests, and a test runs the 3.0 S4 fixtures for its element kind
  through it, requiring each problem at the fixture's path and naming its
  field, so a decoder regression shows in the step that made it. The
  scorer reads whole documents, so S4 itself is read on the R4 head. Dropping ajv
  one element kind at a time would leave the keys not yet decoded checked
  by nothing, or need the merge layer #672 built. So the rest of the
  document, which WS1b's B2 scheduled after the WS1 reading, moves before
  it (R4).
- **No merge layer.** With one validator on the 3.0 path, `elementRecheck.ts`,
  the `merge*Problems` functions, the branch validators and
  `schemaErrorOf` are not ported, and WS1b's B1 and B4 have nothing to
  delete. Part A's harness is what keeps the reports complete, so it is
  built first (R1) and every later rule is written against it.
  `withPresence`, `readingsOf` and the range supplement are not ported.
- **One owner for placement.** Each constraint list's Schema accepts any
  kind and the decoder refuses a kind outside its placement, in the
  wording `format30.test.ts` pins today ("move it to model.constraints"),
  in the same pass as every other problem. The decoder reads
  `PLACEMENT`, so placement is stated once. `refuseMisplacedConstraints`
  is deleted in R4, the commit that puts the decoder on the load path; it
  owns the refusal on the load path until then.
- **The hand-written JSON Schema stays the shipped file until part C,**
  so each Effect Schema is a copy that must agree with it. Each kind gets
  a drift test against the hand-written 3.0 schema in the commit that adds
  its Schema, as #672's `objectTypeSchemaDrift.test.ts` did, comparing
  fields, required fields and enumerated values, and for the two
  constraint lists which kinds each accepts. Part C deletes them when it
  generates the file.
- **S1 compares two heads, not one.** Read on the spike, "`main`'s reader"
  for a 3.0 file would be the decoder under test, and a decoder that
  dropped `namespace` would agree with itself. S1 is therefore read the
  way S5 and S6 are, by a new `measure:comparison -- corpus` subcommand
  (R0) run on `main` and on the spike head:
  - It loads every tracked model, strictly and leniently, writes each one
    it accepts as 3.0, and prints per file and per mode either the 3.0
    bytes or "refused". The two heads' outputs must match file for file.
    Refusal wording is not compared; that is S4's to read. Every file is
    admitted by `main`'s own reader, with no path filter, so a file the
    spike wrongly refuses shows as a difference, and the S4 fixtures show
    as refused on both.
  - `--write <dir>`, run on `main`, also writes each 3.0 output to a file;
    `--read <dir>`, run on the spike, decodes those files and prints the
    same listing, which must equal `main`'s. So the 2.0 files, read by
    `readLegacy` on `main`, test the Effect decoder against the 2.0
    reader's model through the one writer.
- **S4 is re-baselined on 3.0 fixtures** (R0).
  - The 28 cases are restated at 3.0, each gaining the constraint ids 3.0
    requires so it still has exactly one problem, and each external-kind
    case sits under `model.constraints`.
  - New cases cover what 3.0 added and what R4 moves off ajv: a
    constraint with no id; an external kind under a fact type and an
    internal kind in `model.constraints`; a value type with
    `preferred_identifier`; an operand giving both `roles` and
    `subtype_facts`; a malformed `join_ring`; a header without `name`
    and one with an invalid `namespace`; and one each for
    `subtype_facts`, `objectified_fact_types`, `populations`,
    `definitions` and `diagrams`.
  - The scorer gains a case kind for each new collection. It anchors a
    positional match to the collection, so `model/constraints/0` and
    `fact_types/5/constraints/0` are different elements, and carries into
    the combined file the fact types and subtype facts a model-level case
    names. `lostKeys` walks every collection, and the combined file is
    written at 3.0. Each change is shown to catch a planted scorer defect.
  - The 2.0 fixtures stay for the 2.0 reader, which the spike does not
    change.
- **S3 is tightened first** (R0). The frozen `ConstraintRecord` still
  declares `isPreferred` on `internal_uniqueness`, which 3.0 removed, and
  `KindsMatch` treats optional keys as matching whether present or not, so
  a port that kept #672's `isPreferred`, or dropped an optional field, would
  pass. R0 drops the field and makes `KindsMatch` compare each kind's key
  set, optional keys included, with a planted extra optional key shown to
  fail it.
- **M4's wrapper follows placement.** An internal kind is checked inside an
  enclosing fact type, as WS1 says. An external kind is checked in
  `model.constraints`, beside the fact types and subtype facts its roles
  name, each built as WS1's wrapper builds a fact type.

**Work, in order.** Each item keeps the full suite green on its own head.

- **R0, on `main`: the 3.0 instruments.** The 3.0 malformed fixtures and
  the scorer as above, each new scorer path shown to catch a planted
  defect; S3's tightening; the `corpus` subcommand; and S1, S4, S5 and S6
  baselines taken on `main`. An instrument change, which the Non-goals
  allow as amended below.
- **R1: Effect, the harness and object types.**
  `effect` pinned at 4.0.5 (Open decision 14); the object type Schema with
  `preferred_identifier` and Open decision 5's config leaf link; the
  decoder in Open decision 8's shape; part A's harness and its
  planted-defect test; the drift test.
- **R2: constraints.** All 17 kinds, the operand over roles or subtype
  facts, the two lists with placement read from `PLACEMENT`, ported where
  #672's `constraintSchema.ts` and `valueRangeSchema.ts` still apply.
  S3 and M1 re-read.
- **R3: fact types and roles,** from #672's `factTypeSchema.ts`, with the
  reading rule as a harness check on the Schema.
- **R4: the rest of the document, and ajv off the 3.0 path.** The header
  (`orm_version`, `name`, `domain_context`, `namespace`, `note`) and
  `subtype_facts`, `objectified_fact_types`, `populations`, `definitions`
  and `diagrams`; the 3.0 loader then runs the Effect decoders alone, and
  the cross-element checks (repeated ids, references between elements, the
  lenient option) run after decoding as they do today, and
  `refuseMisplacedConstraints` is deleted. The 3.0 reader builds the model
  from decoded records. The `deserialize*` functions in `yaml/*.ts`, and
  `readTail`, become the 2.0 reader's alone, moved unchanged into a module
  beside it; the `serialize*` functions stay where they are for the writer.
  So the two readers share no code that only one of them is meant to
  change (Open decision 13).
- **The WS1 reading on 3.0.** S1 to S6 and M1 to M4 are read on the R4
  head, `main` back to back, and recorded here. A failed gate ends the
  spike as Open decision 4 says. A pass continues with WS1b parts B3, C,
  D and E as written, each merged to `main` in turn.

**R0, done 2026-10-29: the readings on `main`** (at `fbade557` with R0's
instruments added, which change no file under `core/src`; Node v26.7.0, an
Intel Xeon 2.10 GHz x4):

| Gate | Reading on `main`                                                                                                                                                                                                                                                                                                      |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1   | `corpus`: 158 tracked models, the 39 3.0 fixtures among them; strict 85 loaded, 73 refused (the 67 fixtures, whose one loading case at each version is `frequency-max-below-min`, and 7 deliberately broken test files); lenient 93 and 65; none write-failed. `--write` then `--read` gives the same bytes for all 85 |
| S3   | 16 type tests green; a planted `isPreferred?` and a dropped optional `roleId` each fail                                                                                                                                                                                                                                |
| S4   | 3.0, 39 cases: singly 32 reported; combined 26/37 reported, 20 named, constraints named 1/11, 0 silent losses (the two header cases are scored singly)                                                                                                                                                                 |
| S5   | `validate` 365 ms npm, 399 ms bundle, 311 modules and 1.69 MB loaded                                                                                                                                                                                                                                                   |
| S6   | 2,920 ms median (2,780-3,130), 38,363 instantiations                                                                                                                                                                                                                                                                   |

The 2.0 reading is unchanged by the scorer's extension: `malformed` on the
2.0 set prints the same lines before and after (combined 19/28).

**R0 implementation notes.**

- Changed scope: the two misplacement cases are not S4 cases. Their
  refusal names the constraint and its home, not a field, so no field
  could be declared that the message must name; `format30.test.ts` already
  pins the wording, and S1 keeps it green on the spike. R0 has 39 cases:
  the 28 restated, and 11 new.
- The constraint naming reading fell from 4/11 to 1/11 at 3.0, and that is
  the format, not a regression: 3.0 gives every constraint an id, and S4
  credits a constraint with an id only for naming it, which `main`'s schema
  paths never do.
- The conversion of the 28 was checked by comparing each fixture's schema
  error paths at 2.0 and at 3.0: they match, the join case's under
  `model.constraints`. Each new case was checked by fixing its one problem
  and loading and validating the result: no error. The `join_ring` case
  first carried a second problem (its path joined Person to Age) and now
  rings over Person.
- Planted scorer defects, each failing its test: an unanchored
  `constraints` position, an unanchored model-level position, a combined
  file carrying only object types, `lostKeys` over two collections, and
  `lostKeys` without the header. A combine that took a header case could
  not be planted: a header case has no collection, so the loop never takes
  it, and a filter written for it was dead code and was removed.
- `corpus` prints a hash of each file's 3.0 bytes, not the bytes, so two
  listings diff line by line; equal hashes are equal bytes. Its listing
  is `scripts/lib/corpus-listing.mjs`, tested with a loader that drops a
  field. The trial prompt in `effect-comparison.spec.md` names the new
  module, as its drift test requires of every module the scorer protects.
- The implementation review found, and R0 fixed before it merged: the
  combined 3.0 file held two elements under one id (two new fixtures reused
  2.0 ids, and the collision check compared supporting elements only with
  each other), so a message naming one was credited to the other; a header
  case was credited by any message mentioning the model, so its naming
  could not fail; a model-level constraint's `subtype_facts` operand
  matched the model's subtype fact at that position; a write that threw
  listed the same as a load that refused; and the 2.0 reading rested on a
  one-time comparison. Each fix has a test, and each test fails with its
  defect planted. The 2.0 combined file is now pinned by its hash, which
  `main`'s scorer gives as well.
- Two fixtures carry a problem that follows from their one defect, the
  way part A's planted-defect test declares consequences:
  `fact-type-without-roles` has a reading whose placeholders no role
  fills, and `value-with-preferred-identifier` names a constraint the
  file does not define, which is a reference between elements and so
  validation's, not decoding's (WS0's rule).
- S6 rose from 25,382 instantiations at WS0 to 38,363 on `main` today,
  with no Effect: format 3.0's placement types. The spike is read against
  today's number.

**R1, done 2026-10-29: Effect, the harness and object types**, in
`core/src/decode/`, which nothing on the load path imports and core's
barrel does not export.

- Changed scope: the Schemas are written in the file's own keys and make
  no transformation, and a plain `toRecord` maps a decoded value to
  `main`'s `ObjectType` record. #672 decoded through renamed keys
  (`encodeKeys`), which needed every reported path re-spelled into the
  file's keys (`spelledAs`) and gave the harness a decoded shape that
  differed from the raw one. Here a decoded value is the raw value, so a
  rule runs on raw input exactly, and a problem's path is the file's.
  #672's record-producing codec for configs (`createObjectType`'s input)
  is not ported: it replaces the constructor, which is WS2 to WS4's.
- Part A's two probes, on Effect 4.0.5: a failed decode reports a check
  it ran as a `Filter` issue carrying that filter, so a rule Effect
  reported is recognised by identity; and a filter's `run` takes the raw
  value. The harness is therefore the design part A described, with no
  fallback: a rule marked by `crossField` runs wherever none of the
  fields it reads failed, and a failure Effect reported at the same path
  for the same rule is not reported twice.
- Held to `main` by tests, not by being on the load path: all 1,547
  object types in the 85 corpus models decode to the record
  `createObjectType(deserializeObjectType(...))` builds, with the same
  preferred identifier; 500 derived values each pass the hand-written 3.0
  schema and the constructor, to the same record; and the 12 3.0
  malformed object type cases are refused at their field, named with the
  element.
- The planted-defect test plants six structural defects and three
  cross-field ones into every corpus and derived object type, requiring
  exactly the declared paths. Three pairs put each rule beside a field
  error in its own struct; each pair's rule goes unreported without the
  harness, and every rule the Schema marks has a pair.
- Planted against, each failing its test: the harness off, a rule that
  reads a failing field, no dedupe, a record that drops `note`, aliases
  allowed empty, a Schema missing `note`, a Schema adding a field, and a
  required `preferred_identifier`. The version-agreement test refuses a
  range, another version, and a core that does not pin exactly.
- S5 is unchanged by construction and was checked: `validate` loads 313
  modules on `main` and on R1's head alike.
- The first implementation review found four design flaws, each fixed
  with a test that fails when it is planted back:
  - a union's member was chosen by any single-literal field, so a tag
    written with `Literals`, a suspended or nested member, or an optional
    literal two members share left the rule unreported; a member is now the
    one whose required literal fields all hold;
  - the walk did not enter a record's entries, a tuple's elements, or the
    one struct of an untagged union (`NullOr`, a union with a string);
  - agreement with `main` was tested one way only, so a decoder refusing an
    empty `definition` passed: a generator over the hand-written schema
    (`tests/helpers/jsonSchemaArbitrary.ts`) now draws 3,000 values, 592
    of them valid, and the decoder must accept exactly what `main` accepts.
    Its first run found the decoder refusing integers above 2^53, which
    `main` accepts (`Schema.Int` is a safe-integer check), now fixed;
  - nothing checked that a rule's `reads` covers what its predicate reads,
    or that the walked Schemas make no transformation, and a rule that
    threw was skipped without a word: a proxy now records each rule's
    reads, an AST check refuses a transformation, and a throw surfaces.
- Detail findings from the same review, each now a test: a record is
  frozen; every problem a fixture reports is at its declared field; a
  value that is not a mapping is one problem worded as that; the lockfile
  installs one `effect`, at core's version. The harness builds its issues
  with Effect's own `Filter` constructor.
- The second implementation review found six design flaws in the first
  review's fixes, each fixed with a test that fails when it is planted
  back. The first two supersede the first review's member choice and
  record walk, which no longer exist:
  - choosing a union's member from the Schema, by its literal fields,
    still guessed: the harness now walks Effect's own issue tree, visiting
    exactly the structs and lists Effect reported as failed, and a failed
    union's issue names the member Effect tried;
  - a rule was skipped wherever a field it reads held any error: it is now
    skipped only where one is missing or of the wrong kind, and a field
    that failed a check, or holds an error deeper down, no longer silences
    it;
  - a rule's own issues are reported where they point, and several of
    them as several problems, not one problem at the rule's node;
  - a list's rules (`Array(...).check`) were never run beside an item's
    error, and now are, with `reads` taking `*.type`-style paths;
  - which element a problem belongs to was fixed at the decoder's root, so
    a problem deep in a document would be labelled by the document: an
    element's Schema now carries an `element` annotation (`elementOf`)
    the walk meets on the way down, and one generic shell
    (`decode/decoder.ts`: `decoderFor`, `DecodeProblems`,
    `DecodeError`) replaces the object-type-specific one R2 to R4 would
    have copied;
  - the hand-written-schema generator read a `oneOf` beside `properties`
    as nothing, so every constraint it drew was `{}`, and ignored
    `anyOf` presence, `minimum`, `minLength` and `minItems`. It now
    honours each, and a test holds it to drawing constraints of more than
    five kinds, at least 30% of them valid, for R2; the object type
    property now accepts 715 of its 3,000 values (floor 600, raised after the third review).
- Detail findings from the same review: the reads check follows only
  top-level keys, which is exact for R1's three rules and is required
  before R2's first list-level rule (barwise-nh5); the member-choice
  caching and recursion guard, and a record member matching any object,
  went with the member choice itself.
- The third implementation review found no flaw in the design and five
  defects in the walk, each fixed with a test that fails when it is
  planted back: a rule returning several issues was walked as a failure of
  its own node, re-running every rule there (without end, for a rule
  pointing below a field it reads); a broken parent of a dotted read did
  not stop the rule, which then threw on `null.type`; a rule Effect had
  already run and passed was run again; Effect's several-line text broke a
  problem's one line; and a struct element that is not a mapping was not
  worded as one. A problem now carries `at`, where its element sits, and
  an element with no name is named by that position. The decoder shell
  lost its test-only `harness` switch, and the generator now honours
  `if/then/else` (the side's requirements and forbidden fields), so the
  object type property accepts 1,896 of its 3,000 values (floor 1,600).
  Running a rule under the decode's parse options is barwise-yn2.

**R2, done 2026-10-30: constraints**, in `core/src/decode/constraint.ts`,
still off the load path: `validate` loads 313 modules on `main` and on
R2's head alike.

- All 17 kinds, in the file's own keys, with `constraintRecord` mapping
  each to `main`'s record with barwise-973's narrowings: the modality
  stated (alethic when the file states none) and two or more operands. The
  record's type is derived from the Schemas through that mapping, with one
  arm per kind, so it is what S3 reads.
- Two list Schemas, a fact type's and the model's, each built from one
  table of kinds and placed by `placementOf`. A kind listed in the wrong
  place fails a rule that reads no field, so the harness reports it beside
  the constraint's other problems; as a guard that never holds, it also
  removes that kind from the list's decoded type. Its sentence is the one
  `format30.test.ts` pins, fact type name included: a rule's message may
  name the element enclosing the one at fault (`messageWithin`), so R3's
  fact type supplies the name without the constraint Schema knowing it.
- Changed scope: a frequency or cardinality whose max is below its min is
  accepted, as `main` loads it and leaves it to validation; refusing it
  would make S1 differ at R4. Of the 14 3.0 malformed constraint cases, the
  13 others are refused at their declared field, and
  `frequency-max-below-min` loads, as it does on `main`.
- Agreement with `main`, both ways: 3,000 values per list from the
  hand-written schema, both lists' definitions feeding each list, and the
  decoder accepts exactly what `main` accepts (1,099 and 948 of them
  valid), to the same records; all 3,024 corpus constraints under fact
  types and 91 in `model.constraints` decode to `main`'s records.
- The leaves the object type and a role's value constraint share (ranges,
  the values and ranges lists and their one rule, integers) moved to
  `decode/leaves.ts`; the duplication audit found the copies.
- barwise-nh5 is done: the reads check follows dotted and wildcard paths,
  with a planted undeclared nested read shown to fail it.

**R2's readings.**

| Gate | Reading                                                                                                                                                                                              |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S3   | the decoder's record matches the frozen `ConstraintRecord` kind by kind; a `ring_type` widened to a string and a modality left undefaulted each fail it                                              |
| M1   | yes on Effect 4.0.5, for the union and each of the 17 kinds alone; 1,000 union values (seed 1) and 100 per kind each pass the hand-written schema in their kind's list and decode to `main`'s record |

- M1's union weights members by size: at seed 1 it draws `join_equality`
  and `join_exclusion` once or twice in 1,000, which is why each kind is
  also derived alone. A kind with two or more operands derives only below
  size 5, since Effect's cost budget grows with `size` and so does every
  list it draws; integers derive only once `intAtLeast` carries an
  `arbitraryConstraint`, which steers derivation and changes no decode.
- Planted against, each failing its test: placement off, a placement rule
  declaring a read it does not make, a rule reading an undeclared field,
  `ring_type` widened, the modality undefaulted, max below min refused, one
  operand allowed, `role` winning over `roles`, two subtype facts
  required, ranges dropped from the record, a bad tag reported at the
  element rather than at `type`, the enclosing element ignored, the
  harness inert, and the decoder shell without the harness.
- The implementation review found two design flaws, each fixed with a test
  that fails when it is planted back:
  - a list's minimum of two (roles, operands) is a check Effect runs only
    once every item decodes, so a list too short and holding a bad item
    reported the item alone; both minimums are now marked rules with pairs
    in the planted-defect test;
  - the claim that each list's decoded type holds only its own kinds was
    false: building the members by a map over the table merged their types.
    Each list's type is now stated from `InternalConstraint`, which
    `PLACEMENT` derives, `constraintRecord` keeps its input's kind, and a
    type test pins both, so the decoders narrow with no cast.
- Detail findings from the same review, each now a test or fixed: the drift
  test compares every field's numeric limits (list minimums, string
  minimums, integer minimums), with three planted limit changes shown to
  fail it; a mistyped id labels the constraint by it; the modalities are a
  total record over `ConstraintModality`. Tracked instead: a tag that
  selects no variant leaves the shared fields unchecked, as for R1's object
  types (barwise-ui1). Declined: stating placement as one list-level rule.
  The pinned sentence makes the constraint its subject, which a rule on the
  list or on the fact type could produce only through a sentence-override
  hook, the same plumbing as `messageWithin` in another place; and the
  per-member guard is what narrows each list's decoded type.

**R3, done 2026-10-30: fact types and roles**, in `core/src/decode/factType.ts`,
still off the load path.

- The fact type, its roles and its derivation in the file's own keys, with
  the fact type's `constraints` held by R2's internal list, so a fact type
  and its constraints decode in one pass. `factTypeConfig` maps a decoded
  value to the `FactTypeConfig` `deserializeFactType` builds, its
  constraints R2's records: the `FactType` class still builds the element.
- The reading rule is a harness check on the Schema, reported at each
  reading at fault beside the fact type's other problems; a blank reading
  is its own leaf's, as the constructor refuses it. Like every rule it is
  skipped where a field it reads is of the wrong kind, so a reading that is
  not a string suspends it for the other readings. That is no less than
  today's loader reports: its schema refuses the reading, and the
  constructor that checks placeholders never runs. Owner's call
  (2026-10-30): such a reading comes from an unquoted `{0}` in YAML, a
  lint and format problem the tools already handle, so the harness carries
  no mechanism for it. With no roles the rule says nothing, leaving it to
  the roles list's minimum, so `fact-type-without-roles` no longer carries
  the consequence R0's notes declared.
- The misplacement sentence now names the enclosing fact type through
  `messageWithin`, and a test compares it with today's: for every kind that
  lives in the model, with a string id, an empty one, a numeric or boolean
  one and none, the decoder's problems hold `refuseMisplacedConstraints`'s
  sentence exactly, under a fact type whose name is as the model stores it.
  The copy barwise-ehl tracks is therefore checked until R4 deletes the old
  one. Two differences are deliberate, each on input refused either way:
  a numeric or boolean id labels the constraint, where today's sentence
  leaves it out, since the label serves every problem the constraint has;
  and a blank or absent fact type name, where only today's sentence says
  "undefined". A name with surrounding space is trimmed, as the model
  stores it.
- Agreement with `main`, both ways: 2,000 fact types drawn from the
  hand-written schema, half given readings that name each role, and the
  decoder accepts exactly what today's schema and the `FactType` constructor
  accept (660 of them valid), to the same config; all 1,515 corpus fact
  types decode to today's config. The 17 3.0 fact type cases, the 11
  constraint cases among them, are refused at their declared path, with
  `fact-type-without-roles`'s declared consequence (R0's notes) and
  `frequency-max-below-min` loading as on `main`.
- Changed scope: barwise-f9t, R2's review details, landed here, since R3
  reuses those modules: the kind table is total over `Constraint["type"]`,
  `crossField` takes extra annotations and has a guard form that every
  marked rule goes through, a maximum's refusal names "unbounded", an id or
  role id that is not a string is refused as such, and the constraint's
  label matches `refuseMisplacedConstraints` for a string, empty or absent
  id.
- Found while building it: annotating a checked Schema annotates its last
  check, not the node, so the walk labelled the fact type's problems "The
  document". The annotation goes before the check, and a test refuses an
  element annotation on any check in any of the decoders' Schemas.
- The reads check fills each field with a value of the Schema's own shape
  as well as with nothing and the wrong kinds, so a rule that calls a
  list's methods (`readings.flatMap`) meets a list.
- The author-side review found no design flaw and these details, each now
  a test or fixed: a numeric id was labelled where today's sentence leaves
  it out, so the label now leaves out any id that is not a string (which
  reverses R2's review on that point, for the copy's sake); the module's
  doc claimed the reading rule ran whatever else was wrong, where it is
  skipped, as every rule is, when a reading is not a string; the reads
  check had stopped varying a list's items, and a list rule branching on
  an item's field is now shown to be followed; free text and flags have
  their own wrong-type wording; the object type and fact type share one
  name-or-id labeller, and a name and a reading one non-blank leaf.
  Declined: one guard for both list minimums, since the operands' narrows
  to a tuple and a role list's must not, or S3 fails.
- The pre-merge review's `/code-review` (its second pass) found the
  reading rule suspended by one non-string reading a second time; a
  `guards` field that let a rule pass over such an item was tried, and
  its third pass found it unenforced at run time and invisible to the reads
  check, so it was removed on the owner's call above. The same pass found
  the reading rule repeating an empty roles list for
  every reading; that dropping a numeric id from the label, done for the
  sentence's sake, cost every other problem of that constraint its name,
  so it was reverted and the sentence's difference stated instead; and the
  free-text and flag leaves adopted everywhere (object type, ranges,
  values). Each fix has a test that fails with it planted back.

**R3's readings.** M1 for fact types reads no: `Arbitrary.schema` over the
fact type Schema generates nothing (0 values, 201 discards at sizes 3 and
10), because a derived reading almost never names each role, so the
reading rule discards every value. The construct is the reading rule, a
filter over two fields that derivation can only apply by rejection; a
fact type generator needs readings built from its roles, which is WS1b
part D's question, not a gate. S1, S5 and S6 are unchanged by
construction, as for R1 and R2.

- Planted against, each failing its test: the reading rule declaring too
  little, the rule off (twice: agreement and harness), a blank reading
  accepted, blank names accepted, the default storage dropped, a note
  dropped, the constraints unchecked, the fact type labelled by id only, a
  maximum's message without "unbounded", ids with no wrong-type message,
  an empty id labelled as none, and the element annotation after the check.

**R4, built 2026-10-30: the rest of the document, and ajv off the 3.0
path**, in `core/src/decode/document.ts`, with `decode/derivation.ts` split
out of R3's fact type module so subtype facts share it.

- The header, `subtype_facts`, `objectified_fact_types`, `populations`
  and their instances, `definitions` and `diagrams`, in the file's own
  keys, and the document root. `documentConfigs` maps a decoded document
  to the configs the `deserialize*` functions built. The namespace is
  checked against the schema's own pattern (`NAMESPACE_FILE_PATTERN`);
  the model's constructor checks the IRI again after decoding, as it does
  on `main`, so nothing here reads or writes IRI identity.
- The 3.0 loader runs the decoders alone. A `DecodeError` becomes a
  `DeserializationError` whose message lists every problem, one per line,
  with a JSON Pointer per problem in `validationResult`. The model is
  built from the decoded configs (`fromDecoded`), and the cross-element
  checks run after decoding as before: repeated constraint ids, the
  stores' held ids, references between elements, and the lenient option.
  `refuseMisplacedConstraints` is deleted. The `deserialize*` functions,
  `readTail` and the 2.0 reader moved unchanged into
  `serialization/reader20.ts`; the `serialize*` functions stay in
  `yaml/*.ts` for the writer; `DeserializationError` has its own module,
  which both readers import.
- The record states the modality, alethic when the file states none
  (R2), and `main`'s model stores none for a default. The loader drops an
  alethic modality before the model (`modelConstraint`), so the loaded
  model is `main`'s and no existing test changed.
- Agreement with `main`, both ways, on whole documents: 1,000 drawn from
  the hand-written schema, and the decoder accepts exactly what `main`'s
  schema, the model's name rule and each element's constructor accept, to
  the same configs; all 85 corpus documents decode to `main`'s configs.
  All 38 refused 3.0 malformed cases are refused by the loader at their
  declared field and nowhere else; a file holding three of them reports
  all three in one pass. A drift test holds the document Schema to the
  shipped JSON Schema, field by field, with required fields, numeric
  limits, enumerations and the namespace pattern.
- Found by the WS1 reading and fixed before it was recorded: a
  constraint's problems named the constraint by id but not the fact type
  it sits in, which `main` names, so S4's naming read 26/37 combined. An
  element annotation can now say it `locates` the elements inside it, and
  fact types and populations do: a problem reads `The mandatory constraint
  "c1" in fact type "F": modality ...`. A rule whose sentence names the
  enclosing element itself, the misplacement sentence, is not prefixed
  again.
- Planted against, each failing its test: the modality kept, the lenient
  option ignored, repeated ids allowed, the preferred identifier unset,
  instances dropped, a population's description dropped, a definition
  term's minimum dropped, the namespace pattern widened, an element
  annotation placed on a check, the place never added, a fact type or a
  population that does not locate, and the misplacement sentence prefixed
  twice.
- Changed scope: `core/src/project/splitModel.ts` built a constraint's
  record through `deserializeConstraint`; it now calls `constraintRecord`,
  so the split path does not depend on the 2.0 reader. The test generator
  over the hand-written schema (`tests/helpers/jsonSchemaArbitrary.ts`)
  now reads the root's keywords and honours `pattern`.
- The pre-merge review's `/code-review` found no design flaw and these
  details, each fixed with a test that fails when it is planted back
  where it changes behaviour: the refusal had become several lines, which
  `barwise migrate` prints after a file name, and is one line again,
  problems joined by "; " as ajv's were; a problem at the document itself
  had the path "" where ajv gave "/"; a definition with no term read
  "Definition of with no term"; an id of spaces labelled its element as
  having none; `SchemaValidator` still compiled the 3.0 schema up front,
  which only tests now use; the integer leaf was a second copy beside
  `intAtLeast`; and three doc comments still said 3.0 is validated
  against the JSON Schema. Declined, with the reason: building the
  document decoder on first use, since building it costs nothing
  measurable and the time is Effect's import, which a synchronous
  `deserialize` cannot defer; and adding the modality default in one place
  only, since S3's frozen record requires it stated and `main`'s model
  stores none (`splitModel` reads only role ids from the record). S1, S4
  and S5 were re-read after these fixes and are unchanged: S5 376 ms npm
  and 339 ms bundle, `main` 285 and 335 back to back.
- Its second pass, on the fixed head, found no design flaw and these, each
  fixed with a test that fails when it is planted back: a blank definition
  term or text, or a blank diagram name, passed the decoder and the
  model's constructor then threw a plain `Error`, alone and unlabelled
  (`main` does the same; the leaves are now `notBlank`, as the model's
  name is, and the agreement test builds those constructors); joining
  sentences with "; " read ".; ", so they now follow one another; the
  orientations message restated the list, which is now a total record over
  the model's type; and two doc comments. Tracked: the same-id rules of a
  subtype fact and an objectification, the same class of constructor check,
  which need harness rules (barwise-um9); and the test generator's
  namespace-shaped strays for any pattern (barwise-vy9). Declined, with
  the reason: the namespace pattern's copy, which is drift-tested and whose
  original is IRI code this restart stays out of; the label helpers, which
  key on different fields; `Integer` beside `intAtLeast`, two refusals
  with different messages; and the place-or-sentence rule in the walk,
  which a test pins and which touches only a rule's own issues.
- barwise-ehl's duplicated misplacement sentence is gone with
  `refuseMisplacedConstraints`, and its baseline row with it.

**The WS1 reading on 3.0, taken 2026-10-30** on R4's head at `b6bdc263`,
`main` at `876fb4c6` read back to back on the same machine (Node v26.7.0,
an Intel Xeon 2.30 GHz x4):

| Gate | `main`                                                                     | R4                                                                                                                                    |
| ---- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| S1   | `corpus`: 158 models; strict 85 loaded, 73 refused; lenient 93 and 65      | the same 316-line listing, file for file; `--write` on `main` then `--read` on R4 gives the same bytes for all 85, strict and lenient |
| S2   | layout tests green                                                         | layout tests green                                                                                                                    |
| S3   | type tests green                                                           | type tests green: the decoder's record is the frozen `ConstraintRecord`, kind by kind                                                 |
| S4   | singly 32/39 reported; combined 26/37 reported, 20 named, constraints 1/11 | singly 38/39 reported, each named; combined 36/37 reported, 36 named, constraints named 10/11; 0 silent losses on either head         |
| S5   | `validate` 279 and 282 ms npm, 330 and 329 ms bundle; 313 modules, 1.70 MB | 397 and 406 ms npm, 374 and 373 ms bundle, under the 1 s limit; 441 modules and 4.34 MB loaded                                        |
| S6   | 2,890 ms median (2,830-2,900), 74,836 instantiations                       | 3,040 ms median (3,010-3,160), 80,530 instantiations (reported, no limit)                                                             |

The one S4 case R4 does not report is `frequency-max-below-min`. It loads
on both heads, and `barwise validate` refuses it on both with "Frequency
constraint in fact type "Tariff has Age" has max (2) less than min (3)".
R2 kept it loading so that S1 holds: `main` loads that file, and refusing
it at decode would make the two heads' listings differ. S1 and S4's bar
("every case reported") cannot both be met for this case. The owner
resolved Open decision 15 as (a) on 2026-10-30: S4 is read over the cases
`main`'s loader refuses, where R4 reads 38/38 singly and 36/36 combined.
**Every gate holds, and the reading passes.**

- S5 was read twice on each head, in the order `main`, R4, `main`, R4;
  the two readings agree within 10 ms. Loading core now loads Effect, so
  `barwise --version` rose with `validate` (268 to 382 ms npm); the
  bundle's rise is smaller (330 to 374 ms).
- S6's `main` figure is today's, R1 to R3 included, since they are on
  `main`; R4 adds 150 ms and 5,694 instantiations.

**M1 to M4 on R4's head**, seed 1, 1,000 values per element Schema and
100 per constraint kind:

| Schema                                                                        | M1  | M2   | M3   | M4   |
| ----------------------------------------------------------------------------- | --- | ---- | ---- | ---- |
| object type                                                                   | yes | 100% | 100% | 100% |
| the constraint union, and each of the 17 kinds alone                          | yes | 100% | 100% | 100% |
| fact type                                                                     | no  | --   | --   | --   |
| subtype fact, objectification, fact instance, population, definition, diagram | yes | 100% | 100% | 100% |
| the document                                                                  | yes | 100% | 100% | 100% |

- Fact types read no, as at R3: 0 values in 10,001 tries, since the
  reading rule discards every derived fact type. The document derives
  only by leaving fact types out: of its 1,000 values, 51 have
  `fact_types` and every one is empty. A document generator needs
  WS1b part D's fact type generator first.
- M3's first reading was 93% for every Schema, and the cause was the
  instrument: fast-check draws some objects with no prototype, and
  `isDeepStrictEqual` compares prototypes. Compared with both sides
  cloned (keys and values only, `-0` kept), every value comes back.
- M4 wraps each element in the smallest valid document, as WS1 describes:
  an internal constraint in a fact type, an external one in
  `model.constraints`, an instance in a population.

**Each step merges to `main` (owner's direction, 2026-10-29).** There
is no long-lived spike branch: R1 to R4, and WS1b's parts after them,
each land on `main` as their own PR, through the usual reviews and CI.
That reverses #672's "nothing merges", and the order above is what keeps
`main` safe while it does:

- **R1 to R3 are additive.** They add `effect` to core's dependencies,
  the Schemas, the decoders and their tests, and nothing on the load path
  calls them: `OrmYamlSerializer` reads every file as it does today. A
  user sees no change, and S1 holds by construction. `core/CLAUDE.md`'s
  dependency rule and WS2's version-agreement test land with R1, the PR
  that adds the dependency.
- **R4 is the one switch.** It puts the decoders on the 3.0 load path
  and deletes what they replace, in one PR, with S1 to S6 read on its
  head against `main` before it merges.
- **A failed reading is a removal PR.** If the WS1 reading on R4's head
  fails a gate, R4 does not merge, and one PR removes R1 to R3's Schemas,
  decoders and dependency from `main` (Open decision 4). Until R4 the
  code is unused, so removing it touches nothing else, and that is the
  reason "a mixed metamodel" ("Should the adoption start with a
  spike?") does not apply: no reader depends on it.

#672 stays open as the 2.0 evidence until the restart's WS1 reading is
recorded, and is then closed with a pointer here.

**Estimate.** R0 is one session. R1 to R4 are four to five: the port is
mostly Schemas, and the merge layer that took most of #672's 14 review
rounds is not rebuilt, but R4 brings B2's work forward. WS1b after that is
B3, C, D and E, about 4 to 7 sessions of the 8 to 12 estimated.

### 1b. The spike, continued: one harness, Effect alone on load, derived generators (added 2026-10-16)

In one sentence: on the spike, replace the four hand-made
compensations for Effect's cross-field blind spot with one harness,
then make the Effect decoders the only validator on load (barwise-4r3),
and draw the test generators from the same Schemas wherever they can
express the data. The owner asked for all three on 2026-10-16. Each
part merges to `main` in turn (1r, amended 2026-10-29); each extends what WS1 measures toward the end state
WS2 to WS4 would land, so the adoption decision is made on the whole
cost, not the first slice of it.

The estimate the owner asked for is 8 to 12 working sessions on the
spike, each with its review rounds, in the order below: 5 to 7 until
Effect is the only validator on load (A and B), 2 to 4 more for the
generated JSON Schema files and the generators (C and D), and 1 for the
editor and MCP reading the one definition (E). The harness
comes first because, once ajv leaves the load path, it is what keeps
the reports complete.

| Part | Work                                                              | Estimate        |
| ---- | ----------------------------------------------------------------- | --------------- |
| A    | The blind-spot harness and the planted-defect test                | 1 session       |
| B1   | Object types: the decoder owns its report; the double decode goes | 0.5 session     |
| B2   | The rest of the model: header, subtype facts, populations, ...    | 2 to 3 sessions |
| B3   | Project and context-mapping files                                 | 1 to 2 sessions |
| B4   | ajv and the merge layers leave the load path                      | 0.5 session     |
| C    | The shipped JSON Schema files generated by Effect, draft 2020-12  | 1 to 2 sessions |
| D    | Derived generators, alongside B as each kind gains a Schema       | 1 to 2 sessions |
| E    | The editor and the MCP server read the one format definition      | 1 session       |

The estimates extrapolate the spike's pace so far, are not a
commitment, and cover the spike only. "Only Effect" on `main` is WS2 to WS4 and
the adoption decision, which this part informs and does not make.

**A. One harness for the blind spot.** Effect runs a struct's `.check`
filters only once every field of that struct has passed, so a rule that
spans fields goes unreported beside any field error (found in review of
the spike, #672). The spike compensates in four places, each written for its
case:

- `withPresence` in `constraintDecoder.ts` re-reads the schema's anyOf
  presence rules (`role` or `roles`, `values` or `ranges`) on the raw
  input.
- `readingsOf` in `factTypeDecoder.ts` runs the reading rule on the raw
  input after every decode, because it could not live on the Schema.
- The range check carries a `missingOneOf` annotation, and
  `withPresence` adds a range's presence problem where Effect skipped
  the check.
- The loader re-checks each refused element against its JSON Schema
  branch (`elementRecheck.ts`) and keeps what the decoder did not
  report.

The harness replaces the first three with one mechanism, and B4
retires the fourth.

- A rule spanning fields is stated once, as a check on the file-side
  struct, beside the fields it reads, carrying a `crossField`
  annotation.
- One function runs a decode and, when it fails, walks the codec's
  file-side AST alongside the raw input: struct properties by key,
  arrays by index, a union by the discriminator the union itself
  declares, read from the raw value (`type` for constraints, `kind`
  for object types, whose value-range presence check sits beneath the
  entity-or-value union). It
  runs every `crossField` check at a node whose fields are the right
  shape for the check to read, and reports each failure at that node's
  path.
- A problem the harness finds is dropped when Effect already reported
  the same check at the same path, matched by path and by a stable
  identity the check carries, so a rule is reported once whether or not
  Effect ran it, and two different rules failing at one node are both
  kept. A frequency constraint with neither `role` nor `roles` and a
  `max` below its `min`, beside an invalid sibling field, is a test
  case.

When a decode fails and an element also breaks a cross-field rule, the
decoder shall report that rule's problem in the same pass, whatever
other field of the element fails. The reading rule moves back onto the
fact type's Schema, and `withPresence`, `PRESENCE_BY_TYPE`,
`TYPES_WITH_RANGES` and the range supplement are deleted.

Two points are unverified and are A's first probes. Whether a failed
decode tells the walker which checks Effect ran: if not, the walker
runs every marked check and drops duplicates by path and check
identity. And whether a check can be run on a raw
value whose sibling fields failed: the walker must pass only nodes
whose fields the check reads have the right type, or the check itself
throws.

The harness is held by a planted-defect test, which needs no second
validator: the plant knows where it put the defect. It takes every
corpus document (`tests/helpers/modelCorpus.ts`) and every derived
valid element (part D), plants one defect at a time from a fixed list
(drop a required key, add an unknown key, change a type, empty a list,
break each cross-field rule), and requires that the decoder report a
problem at the planted path. Each plant also declares the other problems
it correctly causes -- emptying a fact type's `roles` also breaks its
readings' placeholders; changing a constraint's `type` fails the element's
union -- and the decoder must report exactly the declared set, no more and no
fewer. A single cross-field
plant does not exercise the blind spot -- its fields still decode, so
Effect runs the check with or without the harness -- and those cases
are kept as controls. The cases that do are pairs: each cross-field
violation beside an unrelated field error in the same struct, with the
fields the check reads left well-typed. Removing a `crossField`
annotation from any rule must fail a pair case; the plant is part of the test,
as every check in this spike has been.

Rejected: stating each cross-field rule as a check on a loose
"any mapping" stage ahead of the strict struct. A decode chain stops
at its first failing stage (to be confirmed by A's probe), so the rule
would hide the field errors instead of joining them.

**B. Effect alone on load (barwise-4r3).** The end state: when a model,
project or context-mapping file is loaded, the system shall validate it
with the Effect decoders alone, and ajv shall not run. Every part keeps
S1 and S4 green on its own head and re-reads S5 and S6.

- **B1, object types.** `mergeObjectTypeProblems`, which reconciles
  the two validators by ajv keyword, is deleted. Loading inserts the
  decoded record instead of decoding each object type a second time in
  `OrmModel.addObjectType`, with an S5 reading before and after, as
  barwise-4r3 asks.
- **B2, the rest of the model.** Schemas and decoders for the document
  header (`orm_version`, `name`, `domain_context`, `note`) and for
  `subtype_facts`, `objectified_fact_types`, `populations`,
  `definitions` and `diagrams`, which are every key under `model` in
  `orm-model.schema.json` not yet decoded. WS3's provisional entry
  covers three of these for `main`; on the spike they are needed for
  the load path to drop ajv at all.
- **B3, the other two file formats.** `ProjectSerializer` and
  `MappingSerializer` validate against `orm-project.schema.json` (143 lines)
  and `context-mapping.schema.json` (95 lines) with Ajv instances of their
  own (`ProjectSerializer.ts` line 48, `MappingSerializer.ts` line 42), not
  through `SchemaValidator`. Each gets a decoder, and B4 removes both Ajv
  imports.
- **B4, removal.** `mergeConstraintProblems`, `mergeFactTypeProblems`,
  `elementRecheck.ts`, `branchValidator`, `factTypeValidator`,
  `schemaErrorOf`, and the Ajv instances in `ProjectSerializer` and
  `MappingSerializer` leave the load path; the header "YAML holds
  malformed model elements" becomes the only error shape. Where ajv
  goes afterwards is Open decision 10: a dev dependency of core, used
  only by P3. `SchemaValidator` is exported
  from core's root, and no other package imports it today (checked
  2026-10-16), so its removal from the load path changes no consumer.

**C. The shipped JSON Schema files, generated by Effect in draft
2020-12 (Open decision 9, resolved by the owner 2026-10-16).** The three
files under `core/schemas/` stop being written by hand. A script
generates each from the Effect Schemas with
`Schema.toJsonSchemaDocument`, writes it with `$schema` set to draft
2020-12, and a test fails when the checked-in file differs from what
the script generates, so the file is derived from its authority as the
repository's parity rule asks. When a Schema changes, the system shall
fail the build until the regenerated file is committed beside it.

What the probes of 2026-10-16 found, on the spike's
`FactTypeYamlCodec`, `ConstraintYamlCodec` and `ObjectTypeYamlCodec`
with `onExcessProperty: "error"`, and what C does about each:

- Field rules come out exactly: types, `minLength`, `minItems`, enums,
  `required` and `additionalProperties: false`. Nothing to do.
- Descriptions are supported. Draft 2020-12 keeps `title`,
  `description` and `examples` as annotation keywords, and Effect emits
  each from the Schema annotation of the same name (probed: a field's
  `description` and `examples` and a struct's `title` all came out in
  place). The hand-written model schema's 149 descriptions move into
  annotations on the Schemas, where a reader of the code sees them too.
- A cross-field check is dropped without a trace unless it carries a
  `toJsonSchema` annotation. With one it is emitted (probed: a range's
  min-or-max check came out as `anyOf` of two `required` lists). Every
  `crossField` check from part A carries one, or states that it has no
  JSON Schema form; the reading rule is the one such case today, as it
  is in the hand-written file. A test fails on a `crossField` check
  with neither.
- A constraint's `id` comes out required, because the codec decodes the
  file after the loader fills missing ids (Open decision 8). The
  generated file must accept what the format accepts. Under format 2.0,
  where `examples/getting-started/shop.orm.yaml` omits constraint ids, the
  file side states `id` optional and the fill sits in a stage in front of
  the decode. Under format 3.0 (`orm-format-3.spec.md`), ids are required,
  the file side states them required, and there is no fill stage. The owner chose
  3.0 first (that spec's Open decision 6, resolved 2026-10-17), so this part
  is built against 3.0 and the optional-id stage is never written.
- The 16-kind union comes out as `anyOf`, not `oneOf`, because Effect
  marks one branch as an approximation. The branches are disjoint by
  their `type` constant, so both accept the same files; C finds the
  approximating branch and removes the approximation if it can, and
  otherwise ships `anyOf`.

Draft 2020-12 is mostly a renaming of what draft-07 already had
(`definitions` becomes `$defs`; draft-07's `dependencies` splits into
`dependentRequired` and `dependentSchemas`), plus two real additions:
`prefixItems` and `unevaluatedProperties`, the latter able to close an
object across `allOf` branches, which draft-07's `additionalProperties`
cannot. Which of these Effect emits is its own
choice; a `toJsonSchema` annotation can state any of them where a
check needs one.

Who reads the files, checked 2026-10-16: core's loader (until part B
removes it), the MCP server's `orm-schema://json-schema` resource, which
an LLM client reads as a description of the format, and any user who
points an editor at the schema's `$id`. The VS Code extension registers
no schema with the editor, and no LLM provider in `@barwise/llm` sends
the schema as an output constraint. The draft change therefore reaches
users through the MCP resource and through hand-configured editors
only; the release notes say so.

Four more readers depend on the hand-written file's draft-07 layout and
definition names, and C rewrites each against the generated file or core's
plain-data lists (part E): `scripts/lib/schema-cases.mjs` (lines 161 and
209 index `schema.definitions` by name), and through it
`scripts/measure-comparison.mjs`'s malformed-input scorer;
`core/tests/serialization/schemaDataTypes.test.ts`; and
`core/tests/model/valueOnlyFields.test.ts`, which reads an `if`/`then`
branch. The scorer is a measuring instrument for the Effect comparison's two
arms, and its answer key must not be generated from one of them. It scores
the comparison's and the spike's 2.0 fixtures, so it keeps the last
hand-written 2.0 schema as a fixture of its own, scoped to those 2.0 inputs.
That is not Open decision 9's rejected option (c), which would have kept a
frozen copy as the oracle for the shipped, growing format: this copy is
never compared with the current format, and when S4 is next read on a 3.0
head the scorer is re-baselined against that head's fixtures.

What replaces the independence the hand-written file gave. P3 checked
derived values against a file the Schemas did not write; with the file
generated, that check would test Effect against itself. The tests that
stay independent are the ones whose expected answer a person wrote, or
the plant fixes: the S4 fixtures, the frozen corpus (every model that
loads today must still load), the planted-defect test from part A, and
the byte-layout tests. P3 is kept in a narrower role, below.

**D. Derived generators (M5), as far as the Schemas reach.** M1 reads
yes for all 16 constraint kinds and both object type codecs, and
`Arbitrary.schema` already drives the codec and decoder tests. What
remains is the whole-model generator, `core/tests/arbitraries/model.ts`
(1,010 lines, used by five law tests in core). Diagram's layout
generator, `diagram/tests/arbitraries/layout.ts`, deliberately does not
reuse it: it varies name widths, which core's uniform `T0`/`F0` names
cannot, so it is out of D's scope and any conversion of it is separate
work that keeps its layout-specific inputs. The core generator does two
jobs, and only one
is a Schema's:

- Element fields -- names, ranges, derivations, constraint fields,
  population values -- are what a Schema describes. When an element
  kind has an Effect Schema on the spike, the model generator shall draw
  that kind's fields from `Arbitrary.schema`, and M5 counts the lines
  replaced.
- Consistency across elements -- a role names a player that exists, the
  identification graph has no cycle, ids derive from positions so a
  failure shrinks cleanly -- is a property of the whole model that no
  element Schema states. It stays hand-written, as a wiring layer that
  combines derived elements.

Three facts from grounding shape D, and each is a probe before it is a
plan:

- Effect 4's `Arbitrary` is its own library, with its own combinators
  (`array`, `map`, `flatMap`, `all`, `filter`), runner
  (`sampleEffect`, `checkEffect`) and shrinker; it does not produce
  fast-check arbitraries, and passing one to fast-check fails (WS1
  grounding). A derived element cannot be dropped into the fast-check
  model generator. Either the generator, wiring included, moves to
  Effect's combinators, or a bridge samples Effect values inside
  fast-check and gives up shrinking them. Open decision 11.
- The hand-written generator is tuned on purpose: entities weighted
  2 to 1 so composite keys appear (barwise-968), a range's lower bound
  defaulted so the shrinker never makes an unbounded range, `isFormal`
  never false so the round-trip law sees no conflation. A derived
  generator must reproduce each tuning (through `Arbitrary.schema`'s
  options or a check's `arbitraryConstraint` annotation) or M5 does not
  count it, since a lost tuning silently weakens a law.
- Derived valid elements, with one planted defect each, are the
  planted-defect test's inputs in part A. A and D share that generator.

**E. One format definition, read by every component that needs it
(added 2026-10-16 at the owner's request).** The `.orm.yaml` format is
described in four places today, and only one of them is checked
against the loader:

1. `core/schemas/orm-model.schema.json`, read by the loader and by the
   MCP server's `orm-schema://json-schema` resource. The MCP server
   imports it by a relative path into core's directory
   (`mcp/src/resources/ormSchema.ts`, `../../../core/schemas/...`), not
   through core's package exports, which couples it to core's file
   layout.
2. The Effect Schemas on the spike.
3. The editor's completion provider
   (`vscode/src/server/CompletionProvider.ts`), which keeps its own
   lists: 4 of the 16 constraint kinds, and its own copy of `entity` and
   `value` for `kind`. It is already out of date, and nothing checks it.
4. The LLM extraction format (`llm/src/prompt/responseSchema.ts`), a
   separate, deliberately different format: object types named rather
   than referenced by id, with room for alternatives. It already draws
   its data type names and ring types from core.

Under the composability principle the Effect Schemas are the one
definition, and the JSON Schema is one rendering of it (part C). Part E
makes the first three read from that definition:

- **E1, core exports the definition.** Core exports the file-side
  Schemas, the generated JSON Schema documents, and plain-data lists
  derived from the Schemas (kinds, fields, descriptions, enumerated values)
  through a subpath export, so no package reaches into core's directories. The subpath's
  name is settled in E's grounding; `@barwise/core/format` is the
  working name.
- **E2, MCP.** The `orm-schema://json-schema` resource serves core's
  exported document, imported through the package. When the resource
  is read, the system shall return exactly the document core exports;
  a test holds the two equal.
- **E3, the editor.** Completion and hover come from the Schemas:
  - the constraint kinds offered on a `type:` line are the union's
    discriminator values, all 16;
  - the keys offered inside an element are the fields its Schema
    declares for that kind;
  - enumerated values (`kind`, `modality`, `ring_type`, data type names)
    come from the Schema's literals;
  - each field's `description` annotation (part C) is the completion
    item's documentation and the hover text.

  When the user requests completion on a constraint's `type:` line, the
  editor shall offer every constraint kind the Schema defines. A test
  derives the expected list from the Schema, so a new kind appears in
  the editor without an edit to it. The hand-written lists are deleted.
- **Out of scope: the LLM extraction format.** It should not read the
  file Schemas, because it is a different format. It could follow the
  same pattern inside `@barwise/llm` -- its own Effect Schema, with the
  tool's input schema generated from it and the model's response
  decoded by it -- which is separate work with its own spec.
- **Not done (Open decision 12, resolved: no): registering the generated
  file with Red Hat's YAML extension** (`contributes.yamlValidation`). It would give as-you-type
  JSON Schema errors to users who have that extension, but the language
  server already reports every problem in the decoder's words, and a
  second source would report the same problem twice in different
  words. Open decision 12.

E changes `@barwise/mcp` and `barwise-vscode`,
neither of which depends on `effect` itself. Reading discriminator values,
per-kind fields, literals and `description` annotations needs Effect's AST
API, so E1's export is plain data computed in core from the Schemas -- the
constraint kinds, each kind's fields with their descriptions, each
enumerated field's values -- beside the JSON Schema document. The editor
and the MCP server read those lists and never import `effect`; the bundles
carry Effect through core already. The capability matrix in the root `CLAUDE.md` does not change;
no surface gains or loses a capability.

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
  returning `Effect<Record, Problems>` and requiring every id in their
  input, and the problem classes, beside a synchronous boundary for
  each. No service is exported.
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
2. **`IdSource` -- the API shape is resolved 2026-10-15; its purity claim is withdrawn 2026-10-16.** The decoder takes `newId` as a plain parameter, not an Effect service, and `IdSource` is removed from the exported surface. The owner asked what the service buys when ids are UUIDv7. The format does not matter. What matters is whether the decoder can reach a process-wide generator, which would make its output depend on state outside its inputs. Core's `generateId()` does reach one, so a decoder that called it directly would not be pure. Passing `newId` in avoids that, but it does not make decoding pure: a `newId` that mints random ids is an injected source of randomness. The earlier reasoning that a plain parameter "performs no effect" and so "adds no port" was wrong, and barwise-e8m names that kind of port. What the parameter does buy is repeatable tests. A counter-based `newId` gives the same output for the same input, provided each decode is given a fresh counter. Whether the parameter is allowed at all is open: see item 8. Superseded 2026-10-16 by item 8, option (d): the decoder takes no `newId`.
3. **JSON Schema: hand-written or generated -- resolved 2026-10-15: hand
   written, with a drift test per kind.** The Effect arm's generated
   object type definition differed from the hand-written one in three
   places, and the schema is read by the editor and the LLM, where a change
   is user-visible. The property P3 depends on this: the schema must stay
   separate from the Schema under test, or P3 checks the Schema against
   itself. Revisit when the drift tests show the two agreeing for every kind.
   Superseded 2026-10-16 by item 9: the files are generated.
4. **What a failed spike leaves behind.** Recommend: the WS0
   and R0 instruments stay on `main`; one PR removes the Schemas,
   decoders and `effect` dependency R1 to R3 merged (unused until R4,
   so nothing else changes); and barwise-973 resumes from the plain arm
   (`8398a193`), the comparison's fallback. (Amended 2026-10-29: the
   steps merge to `main`, so there is no branch to keep.)

5. **The lenient config leaf, so that derivation works -- resolved
   2026-10-15: option (a), verified.** The model codec reads a data type
   name through `Schema.declare`, which accepts any string at runtime while
   its TypeScript type is the strict list. Option (a), annotating the
   declaration with a derivable link, works on the pinned Effect (see the
   grounding). It changes neither the runtime check nor the TypeScript type.
   Option (b), a plain string leaf with the strict list moved to the
   boundary, is kept only as a fallback if (a) breaks under an Effect
   upgrade.
6. **"Names the field" -- accepted for now (2026-10-15).** The definition
   under S4 stands until experiments say otherwise. The experiments are
   tracked as barwise-elq.
7. **`fast-check` as a dev dependency -- approved 2026-10-15.** It is
   already a core dependency at `^4.10.1`. The root adds the same range and
   lands with its first import, the property tests for the scorer. A
   dependency with no import would be an unused dependency, which the
   dependency checker reports.

8. **Where ids come from -- resolved 2026-10-16 by the owner: option (d), the decoder requires ids and only the boundary mints them.** Copilot's review showed that item 2's `newId` parameter is an injected source of randomness, which barwise-e8m forbids in core. Four options were weighed:
   - **(a)** Keep `newId` as a parameter, as a named exception to barwise-e8m. Rejected by the owner: it writes an exception into the commitment.
   - **(b)** Derive ids from position in the document. Rejected: ids for id-less elements stop being UUIDv7, reordering changes them, and two id-less inputs collide at the same positions when models merge.
   - **(c)** An Effect service (`IdSource`, what the Effect arm built). Rejected: still a port, now in core's public types.
   - **(d)** Chosen. The decoder requires every id and refuses an element without one. The synchronous boundaries fill missing ids from the installed generator, then decode, and they differ by source:
     - **Config construction** (`createObjectType`, `addObjectType`, importers, the LLM) fills a missing id for any kind.
     - **File loading** fills a missing id only where the file format lets one be omitted. (Amended 2026-10-29: under format 3.0 the schema requires every constraint id, so the 3.0 loader fills none, and the 2.0 reader derives the ids a 2.0 file omits, `derivedId.ts`. The rest of this bullet describes format 2.0 as it stood when decided.) Today that is every constraint kind: `orm-model.schema.json` requires no constraint id, the shipped `examples/getting-started/shop.orm.yaml` omits them, and `FactType` mints them. Filling these keeps gate S1. Where the file format requires an id (object types, roles, fact types, subtype facts, objectifications, populations, instances), a missing one is refused as it is today. Construction-time minting cannot repair it, because the schema and the decoder refuse the file before any object is constructed.

   Consequences. The decoder is a pure function of its input, with no parameter or service for ids. The one place that mints ids is the global generator core already has (`setIdGenerator`, 2026-07-25), now confined to the boundary; barwise-e8m gets a note saying so. The serializer no longer needs to recognise ajv's missing-`id` message, because the decoder reports a missing id itself (barwise-k8y). The spike converts the brought-forward ObjectType slice from `IdSource` to this shape before it builds the constraint decoder. If core should later hold no generator at all, minting moves out to the callers in the outer packages; the decoder does not change for that.

9. **The shipped JSON Schema: generated from Effect, or hand-written
   and drift-tested (revisits item 3; added 2026-10-16) -- resolved
   2026-10-16 by the owner: generated, in draft 2020-12.** The owner's
   reasoning: the hand-written file is not a better answer key than a
   test that states its expected answer directly, and a newer draft is
   worth having. The options weighed were (a) keep it hand-written with
   a drift test per kind, which the draft recommended to keep an
   independent oracle for P3 and the harness test; (b) ship the
   generated file; and (c) ship the generated file and freeze the
   hand-written one as a test-only oracle, rejected because a frozen
   file goes stale as the format grows. Two things changed between the
   draft and the decision. Part A's harness test was redesigned to need
   no oracle: a planted defect knows its own path. And the draft's claim
   that the editor and the LLM read the file was checked and is too
   broad: the MCP resource and hand-configured editors read it, the
   VS Code extension and the LLM providers do not (WS1b, part C).

   Consequence for P3: it no longer tests independence. It is kept as a
   check that Effect's two outputs agree, as three properties:
   - Every file-side input the loader accepts at the current format version
     passes the generated JSON Schema as written, before ids or defaults are
     filled. A re-encoded value alone would hide a schema that wrongly
     requires a field the format lets a file omit. A file at an older
     version is accepted only through its migration, so P3 checks the
     migrated document: under format 3.0 (`orm-format-3.spec.md`), every
     2.0 corpus file, `examples/getting-started/shop.orm.yaml` included.
   - Every value the decoder accepts, encoded, passes the generated schema.
   - Every planted defect the decoder refuses, the generated schema refuses
     too, except rules marked as having no JSON Schema form.

   Together they are the property a user of the MCP resource depends on:
   the schema they read accepts what the loader accepts.

10. **Where ajv goes when it leaves the load path (added 2026-10-16) --
    resolved 2026-10-16 by the owner: option (a), test-only, for now.**
    "For now" leaves (c) open if P3 stops earning its dependency.
    - **(a)** A dev dependency of core, through its draft 2020-12 entry
      point (`ajv/dist/2020`), used only by P3 as restated under item 9.
      Recommended: the generated file is a published artifact, read by
      LLM clients through the MCP server, and P3 is the one test that
      says it agrees with the loader. The runtime list loses one entry.
    - **(b)** Kept as a runtime dependency for a `validate`-style JSON
      Schema check a consumer could call. No caller needs one today
      (no package outside core imports `SchemaValidator`).
    - **(c)** Removed outright, with P3 dropped. The generated file would
      then be shipped with nothing checking that it accepts what the
      loader accepts.

11. **The whole-model generator: Effect's `Arbitrary`, or fast-check
    with a bridge (added 2026-10-16) -- resolved 2026-10-16 by the owner:
    option (a).** Effect's derived generators are not fast-check
    arbitraries (WS1b, part D). The move counts only once part D has read
    shrinking and run time on Effect's runner, as (a) says.
    - **(a)** Move `core/tests/arbitraries/model.ts`, wiring included,
      to Effect's combinators and runner, and move the five core law
      tests that use it from `fc.assert` to `Arbitrary.checkEffect`. Recommended on
      the spike, because it is the only option that keeps shrinking on
      derived values, and the owner asked for derived generators as far
      as they reach. fast-check stays for properties that do not draw a
      model (the scorer's). Cost: two property libraries in the test
      suite, and the shrink quality and run time of Effect's runner are
      unmeasured at this size; part D reads both before the move counts.
    - **(b)** Keep fast-check and bridge by sampling Effect values
      inside a fast-check generator. Smaller change; a failing model no
      longer shrinks below the sampled elements, which is the property
      the generator's design exists for.
    - **(c)** Derive element generators only in the element-level tests,
      as today, and leave the model generator hand-written. M5 then
      reads close to zero, which is a result, not a failure.

12. **Register the generated schema with Red Hat's YAML extension
    (added 2026-10-16) -- resolved 2026-10-17 by the owner: option (a), no.**
    - **(a)** No. Recommended: the language server already reports
      every problem in the decoder's words, and a second source reports
      the same problem twice, worded differently.
    - **(b)** Yes, through `contributes.yamlValidation`. Users with that
      extension get as-you-type errors and key completion from the
      schema, at the cost of duplicate reports.

13. **Files below 3.0 on the spike (added 2026-10-29) -- resolved
    2026-10-29 by the owner: option (a), with decision 10 amended as
    stated there.**
    - **(a)** The 2.0 reader stays as it is: ajv against the frozen
      `orm-model-2.0.schema.json`, reading straight into the model, with
      the element deserializers it shares with today's 3.0 reader moved
      beside it unchanged (R4). Recommended: the 2.0 format is frozen, so
      its reader has no reason to change, and the spike measures the
      format that grows. The two readers then decode the same element
      shapes in two ways, and S1's second pass is what holds them to one
      model: each 2.0 file read by `readLegacy`, written at 3.0 and
      decoded by Effect must give `main`'s bytes. Cost: ajv stays a
      runtime dependency for as long as core reads 2.0. That amends Open
      decision 10, which the owner resolved as test-only: under (a), ajv
      moves to a dev dependency only when 2.0 reading is retired, which is
      its own decision. The owner accepted the amendment on 2026-10-29.
    - **(b)** Write a 2.0-to-3.0 document migration and decode every file
      with Effect. ajv leaves core's runtime entirely. Cost: a migration
      `main` does not have and does not need, written for the spike, and
      a second reading of the 2.0 rules that would have to agree with
      `readLegacy`'s.
14. **The Effect version (added 2026-10-29) -- resolved 2026-10-29 by
    the owner: 4.0.5, exact.** The reasons:
    two weeks old at the restart, and the version WS2 named. #672 used
    4.0.4. 4.0.6 and 4.0.7 are under two weeks old. M1 is re-read on the
    pinned version, since derivation is marked unstable.
15. **A case S1 requires to load (added 2026-10-30) -- resolved
    2026-10-30 by the owner: option (a).** The 3.0
    case `frequency-max-below-min` is a file `main` loads, leaving the
    max below min to validation, which refuses it. S1 requires the spike
    to load what `main` loads; S4's bar requires every case reported by the
    loader. R4 loads it, so S1 holds and S4 reads 38/39 singly and 36/37
    combined, with no silent loss. The case was written in WS0, before
    this conflict was visible, and R0's notes already list it as the one
    loading case.
    - **(a)** S4 is read over the cases `main`'s loader refuses: a case
      `main` loads and validation refuses is validation's, as R2 decided
      for this one, and S4 holds at 38/38 and 36/36. Recommended: the
      gate stands for "no bad model passes unnoticed", and validation
      notices this one on both heads with the same message; the format
      leaves the relation between two fields to validation elsewhere too.
    - **(b)** S4 holds as written, so the decoder must refuse the case,
      and S1 then differs from `main` on one fixture file. That is a
      change in what loads, which S1 exists to prevent, and it reverses
      R2's scope change for every constraint whose max may be below its min.
    - **(c)** The gate fails as written, and the restart ends as Open
      decision 4 says.

## Risks and testing

- Derivation is unstable in the pinned Effect version. The spike records
  the version with each reading, and an Effect upgrade re-reads M1 to M4
  before it lands.
- Derivation generates values the Schema's own checks may refuse. M2
  measures that rate for each kind. A kind with a low rate needs its
  generator constrained through the options `Arbitrary.schema` accepts,
  not filtered in each test. The spike checks which constraints it accepts.

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

- No change to `main`'s load path before the WS1 reading on 3.0 passes:
  R1 to R3 merge, and nothing reads files through them until R4 (amended
  2026-10-29; it read "no change to `main` beyond the instruments").
- No Effect in `llm`, `cli`, `mcp` or `vscode` beyond declaring the
  dependency where a package imports a core decoder.
- No new capability: this restyles how core holds and decodes a model,
  not what it accepts or serializes.
- The spike deletes no hand-written generator. Its only properties whose
  expected answer comes from the Schema alone are the self-consistency
  checks P1 and P2, and no refusal expectation is generated from the Schema.
