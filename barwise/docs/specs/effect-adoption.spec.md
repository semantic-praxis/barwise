# Adopting Effect Schema for the rest of the sealed-record metamodel

Status: WS0 implemented 2026-10-15 (the instruments and their baselines;
see WS0); the spike (WS1) amended 2026-10-15 to measure derived test
generators and property tests (see WS1 and Reported measures); the spike
in progress on `experiment/effect-adoption-facttype` (#672, never merges);
WS1b added 2026-10-16 for review, not started; WS2 onward not started
Created: 2026-10-15
Last-updated: 2026-10-16
Tracking: barwise-jo5 (this spec); barwise-4r3 (Effect alone on load,
WS1b part B); barwise-r27 (the blind-spot harness, part A); barwise-wia (generated JSON
Schema, part C); barwise-s6q
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

| Area                                                  | Today on `main`                                    | Verdict                                                        |
| ----------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------- |
| `core/src/model/ObjectType.ts`, `objectType.ts`       | hand-written sealed union (barwise-973 step 1)     | WS2: replaced by the Effect arm's schema                       |
| `core/src/model/SubtypeFact.ts`, `yaml/subtype.ts`    | class                                              | WS3: from the `trial/effect-t2-m2` run                         |
| `core/src/model/Population.ts`, `ObjectifiedFactType` | classes                                            | WS3                                                            |
| `core/src/model/FactType.ts`, `Role.ts`               | classes, 206 + 28 lines                            | WS1 spike, landed in WS4                                       |
| `core/src/model/Constraint.ts`, `yaml/constraint.ts`  | 16-kind union, 704 + 227 lines, plus `rolePath.ts` | WS1 spike, landed in WS4                                       |
| `core/src/model/id.ts`                                | `setIdGenerator`, installed by each surface        | stays; read only at the synchronous boundary (Open decision 8) |
| `core/schemas/orm-model.schema.json`                  | hand-written                                       | generated from Effect, draft 2020-12 (Open decision 9)         |
| `core/CLAUDE.md` dependency rule                      | `yaml`, `ajv`                                      | WS2: adds `effect`, exact                                      |
| `core/tests/fixtures/malformed/`                      | 11 object type cases                               | WS0 (done): 17 fact type and constraint cases                  |
| `core/tests/serialization/`                           | `objectTypeLayout.test.ts` only pins key order     | WS0 (done): `factTypeLayout.test.ts`                           |
| `scripts/measure-comparison.mjs`                      | `startup`, `bundles`, `malformed`, `diff`, `trial` | WS0 (done): a `typecheck` subcommand for S6                    |
| `scripts/lib/malformed-score.mjs`                     | reads `object_types` only                          | WS0 (done): fact types, constraints, nesting (S4)              |
| `core/tests/types/`, `vitest.shared.ts`               | core type-checks no test file                      | WS0 (done): the S3 harness and its own tsconfig                |
| Downstream packages                                   | no `effect` dependency                             | WS2: version-agreement test; declare on first use              |

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

P3 is the only independent check. P1 and P2 are self-consistency checks:
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

### 1b. The spike, continued: one harness, Effect alone on load, derived generators (added 2026-10-16)

In one sentence: on the spike branch, replace the four hand-made
compensations for Effect's cross-field blind spot with one harness,
then make the Effect decoders the only validator on load (barwise-4r3),
and draw the test generators from the same Schemas wherever they can
express the data. The owner asked for all three on 2026-10-16. Nothing
here merges; each part extends what WS1 measures toward the end state
WS2 to WS4 would land, so the adoption decision is made on the whole
cost, not the first slice of it.

The estimate the owner asked for is 7 to 11 working sessions on the
spike, each with its review rounds, in the order below: 5 to 7 until
Effect is the only validator on load (A and B), and 2 to 4 more for the
generated JSON Schema files and the generators (C and D). The harness
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
  arrays by index, a union by the literal `type` in the raw value. It
  runs every `crossField` check at a node whose fields are the right
  shape for the check to read, and reports each failure at that node's
  path.
- A problem the harness finds at a path where Effect already reported
  the same check is dropped, so a rule is reported once whether or not
  Effect ran it.

When a decode fails and an element also breaks a cross-field rule, the
decoder shall report that rule's problem in the same pass, whatever
other field of the element fails. The reading rule moves back onto the
fact type's Schema, and `withPresence`, `PRESENCE_BY_TYPE`,
`TYPES_WITH_RANGES` and the range supplement are deleted.

Two points are unverified and are A's first probes. Whether a failed
decode tells the walker which checks Effect ran: if not, the walker
runs every marked check and drops duplicates by path, which is what
`withPresence` does today. And whether a check can be run on a raw
value whose sibling fields failed: the walker must pass only nodes
whose fields the check reads have the right type, or the check itself
throws.

The harness is held by a planted-defect test, which needs no second
validator: the plant knows where it put the defect. It takes every
corpus document (`tests/helpers/modelCorpus.ts`) and every derived
valid element (part D), plants one defect at a time from a fixed list
(drop a required key, add an unknown key, change a type, empty a list,
break each cross-field rule), and requires that the decoder report a
problem at the planted path and at no other. A single cross-field
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
  `MappingSerializer` validate through `SchemaValidator` today, against
  `orm-project.schema.json` (143 lines) and
  `context-mapping.schema.json` (95 lines). Each gets a decoder.
- **B4, removal.** `mergeConstraintProblems`, `mergeFactTypeProblems`,
  `elementRecheck.ts`, `branchValidator`, `factTypeValidator` and
  `schemaErrorOf` leave the load path; the header "YAML holds
  malformed model elements" becomes the only error shape. Where ajv
  goes afterwards is Open decision 10. `SchemaValidator` is exported
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
  generated file must accept what the format accepts, such as
  `examples/getting-started/shop.orm.yaml`, so the file side states
  `id` optional and the fill sits in a stage in front of the decode.
- The 16-kind union comes out as `anyOf`, not `oneOf`, because Effect
  marks one branch as an approximation. The branches are disjoint by
  their `type` constant, so both accept the same files; C finds the
  approximating branch and removes the approximation if it can, and
  otherwise ships `anyOf`.

Draft 2020-12 also gives the format keywords the draft-07 file had to
spell around: `$defs`, `dependentRequired` (a key that is only allowed
beside another, such as `min_inclusive` beside `min`), `prefixItems`,
and `unevaluatedProperties`. Which of these Effect emits is its own
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
work that keeps its layout-specific inputs. It does two jobs, and only one
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
   instruments stay on `main`, the branch is kept as evidence, and
   barwise-973 resumes from the plain arm (`8398a193`), the comparison's
   fallback.

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
     - **File loading** fills a missing id only where the file format lets one be omitted. Today that is every constraint kind: `orm-model.schema.json` requires no constraint id, the shipped `examples/getting-started/shop.orm.yaml` omits them, and `FactType` mints them. Filling these keeps gate S1. Where the file format requires an id (object types, roles, fact types, subtype facts, objectifications, populations, instances), a missing one is refused as it is today. Construction-time minting cannot repair it, because the schema and the decoder refuse the file before any object is constructed.

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
   check that Effect's two outputs agree -- every value the decoder
   accepts, encoded, passes the generated JSON Schema, and every
   planted defect the decoder refuses, the generated JSON Schema refuses
   too, except the rules marked as having no JSON Schema form. That is
   the property a user of the MCP resource depends on: the schema they
   read accepts what the loader accepts.

10. **Where ajv goes when it leaves the load path (added 2026-10-16).**
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

- No change to `main` beyond WS0's instruments before the spike passes.
- No Effect in `llm`, `cli`, `mcp` or `vscode` beyond declaring the
  dependency where a package imports a core decoder.
- No new capability: this restyles how core holds and decodes a model,
  not what it accepts or serializes.
- The spike deletes no hand-written generator. Its only properties whose
  expected answer comes from the Schema alone are the self-consistency
  checks P1 and P2, and no refusal expectation is generated from the Schema.
