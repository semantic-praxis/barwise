# Ring constraints over a join path

Status: Implemented (WS1 the kind in core and every reader; WS2 NORMA import and export)

Created: 2026-10-24
Last-updated: 2026-10-24
Tracking: barwise-5t9.6
Touches: barwise/packages/core/src/model/Constraint.ts,
barwise/packages/core/src/index.ts,
barwise/packages/core/src/serialization/yaml/constraint.ts,
barwise/packages/core/schemas/orm-model.schema.json,
barwise/packages/core/src/validation/rules/joinConstraintRules.ts,
barwise/packages/core/src/validation/referenceDiagnostics.ts,
barwise/packages/core/src/validation/ruleId.ts,
barwise/packages/core/src/validation/rules/population/ring.ts,
barwise/packages/core/src/validation/rules/population/joinPath.ts,
barwise/packages/core/src/verbalization/constraints/phase2.ts,
barwise/packages/core/src/verbalization/ConstraintVerbalizer.ts,
barwise/packages/core/src/diff/elementDiff.ts,
barwise/packages/core/src/diff/ModelMerge.ts,
barwise/packages/core/src/counterexample/CounterexampleGenerator.ts,
barwise/packages/core/src/lineage/generate.ts,
barwise/packages/core/tests/,
barwise/packages/diagram/src/graph/ModelToGraph.ts,
barwise/packages/formats/src/ddl/constraintRouting.ts,
barwise/packages/formats/src/norma/NormaXmlParser.ts,
barwise/packages/formats/src/norma/NormaXmlTypes.ts,
barwise/packages/formats/src/norma/mapping/factConstraints.ts,
barwise/packages/formats/src/norma/mapping/constraintPasses.ts,
barwise/packages/formats/src/norma/NormaXmlWriter.ts,
barwise/packages/formats/src/norma/NormaXmlSerializer.ts,
barwise/packages/formats/tests/

A ring constraint can only say how a fact type relates an object type to
itself. ORM 2 also lets it say that of a relation reached along a join
path -- "no Person is their own grandparent", over `Person is child of
Person` joined to itself -- and NORMA stores that as a
ring whose role sequence carries a `JoinRule`. Barwise has no place to
put one, and its NORMA importer drops such a ring without a word or, worse,
keeps two of its roles as a flat ring that says something else: the
grandparent ring's two projected roles both belong to the one parenthood
fact type, so it imports as "no Person is their own parent". This spec
adds `join_ring`: the `JoinOperand` the set-comparison join kinds already
use, projected to two columns, plus a `RingType`. It is the follow-on the
role-path spec named and left with "the identical shape"
(`docs/specs/archive/role-path-model.spec.md`, decisions on variants and
the minimal grammar).

## Principle

**Explicit over implicit**, and the determinism rule's quieter half: a
loader must not change what a file means. Today a NORMA ring over a join
is either dropped (`addRingConstraints` skips it when no fact type holds
both roles) or, when both projected roles happen to lie in one fact type,
imported as a flat `ring` over that fact type -- a different constraint,
stated with confidence. Both are silent. The fix is a construct that can
hold what NORMA stated, not a better guess.

**Composability.** Everything a join ring needs already exists in pieces:
the path type and its structural rules (`RolePath`, `JoinOperand`,
`joinConstraintRules.ts`), the binding expansion and projection
(`projectedTuples` in `population/joinPath.ts`), the ring property algebra
(`RING_PROPERTIES`, `PROPERTY_CHECKS` in `population/ring.ts`), and the
NORMA join decoder (`createJoinDecoder`). `join_ring` is the composition;
the only new logic is the two checks that make a projected pair a ring
(two columns, one object type) and the sentence that reads it.

## Should a join ring be a new kind, or `ring` with an optional path? (resolved: a new kind)

A new kind. `ring` is internal (`PLACEMENT.ring = "internal"`): it lives
in its fact type, and the loader refuses it under `model.constraints`.
A ring over a path spans fact types, so it is external by the one
placement table, and a kind cannot be both. The role-path spec made the
same call for subset, equality and exclusion ("add variants, never
generalize the flat kinds"), and every reader that switches on `ring`
(verbalization, the population checker, the counterexample generator, the
diff key) keeps its one-fact-type assumption intact.

## Scope

In scope:

- When a model holds a constraint
  `{ type: "join_ring", operand: JoinOperand, ringType: RingType }`, the
  system shall store it in the model (external placement), round-trip it
  through `.orm.yaml` 3.0 as
  `{ type: join_ring, id, operand: { path, projection }, ring_type }`, and
  validate it against the schema.
- When a `join_ring`'s operand fails a path rule the join kinds already
  enforce (unknown root, a step that is not a real hop, discontiguity, a
  projection out of range), the system shall report the same rule id it
  reports for the other join kinds.
- When a `join_ring`'s projection does not have exactly two columns, the
  system shall report `constraint/join-ring-arity`.
- When the two projected nodes are played by different object types, the
  system shall report `constraint/join-ring-different-players`.
- When the operand's path is one hop whose two projected roles lie in one
  fact type, the system shall warn `constraint/join-ring-single-fact-type`,
  naming `ring` as the plain spelling of the same constraint (Open
  decision 3). A path of two or more hops is never this case, even when
  both projected roles belong to one fact type, as in a self-join; and
  the NORMA importer tells a join ring from a flat one by the presence of
  a `JoinRule`, never by where the roles lie.
- When a significant population yields projected pairs that break the
  ring type's properties, the system shall report
  `population/join-ring-violation`, through the same `PROPERTY_CHECKS`
  the flat ring uses, fed from `projectedTuples`.
- When a `join_ring` is verbalized, the system shall read the relation as
  the path chain the join kinds already produce (`pathChain`) in the
  sentence shape of its ring type.
- When two models are diffed, the system shall key a `join_ring` by
  `JRING:<operandKey>:<ringType>`; when merged, it shall remap the
  operand's root and role ids as the other join kinds are remapped.
- When a NORMA ring constraint's role sequence carries a `JoinRule` the
  join decoder accepts, the importer shall produce a `join_ring`, and
  never a flat `ring` over a subset of its roles; the NORMA exporter
  shall write it back as a ring whose role sequence carries that
  `JoinRule`.

Out of scope:

- **Ring types beyond the eight single ones** (barwise-vc3). `join_ring`
  carries one `RingType`, exactly as `ring` does, so whatever vc3 decides
  for combined types applies to both kinds unchanged.
- **An import-warning channel.** `NormaImportFormat.parse` returns
  `warnings: []` always, so a ring this spec still cannot read (one whose
  path is outside the grammar) is still dropped quietly. WS2 files the
  channel as its own issue rather than widening this spec.
- **Counterexample generation.** The join kinds are listed as unsupported
  because they span fact types; `join_ring` joins that list.
- **A diagram glyph.** `join_ring` joins `NOT_DRAWN` beside the other join
  kinds; verbalization carries it.
- **Paths outside the role-path grammar** (branching, several join
  variables, value comparison along a path). Unchanged from the
  role-path spec.

## Inventory

| Area                                                                  | Current state                                                        | Verdict                                                                     |
| --------------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `model/Constraint.ts`                                                 | `ring` internal, two role ids; `join_*` trio external over operands  | add `JoinRingConstraint`, guard, member, `PLACEMENT.join_ring = "external"` |
| `model/Constraint.ts` helpers                                         | `roleIdsOf`, `objectTypeIdsOf`, `joinOperandsOf` switch exhaustively | one case each, through `operandRoleIds` and the operand's root              |
| `serialization/yaml/constraint.ts`, `yaml/rolePath.ts`                | operand serde exists                                                 | one write case, one read case; `serializeJoinOperand` reused as is          |
| `schemas/orm-model.schema.json`                                       | `join_operand_def` and `join_*` branches under `external_constraint` | one branch; 3.0 is unreleased, so no version bump (metamodel policy)        |
| `validation/rules/joinConstraintRules.ts`                             | path rules per operand for the trio                                  | runs them on the one operand; adds the arity and players checks             |
| `validation/referenceDiagnostics.ts`                                  | own `JoinConstraintType` union                                       | add the member, so a bad root or step reports here too                      |
| `validation/rules/population/ring.ts`                                 | `PROPERTY_CHECKS` over a `RingRelation` built from one population    | export a relation-taking entry, so a pair set from a path can be checked    |
| `validation/rules/population/joinPath.ts`                             | `projectedTuples` gives tuples per operand                           | builds the pair set for `join_ring` and calls the ring checks               |
| `verbalization/constraints/phase2.ts`                                 | `verbalizeRing` needs a `FactType`; `pathChain` reads a path         | ring sentence shapes take a predicate phrase; `join_ring` passes the chain  |
| `diff/elementDiff.ts`, `diff/ModelMerge.ts`                           | `JSUB`/`JEQ`/`JEXC` keys; root remap by kind                         | a `JRING` key; one case in `remapConstraintIds`                             |
| `counterexample/`, `lineage/`, `diagram/`, `formats/src/ddl/`         | each lists the join kinds                                            | one entry each: unsupported, label, not drawn, pseudocode                   |
| `formats/src/norma/NormaXmlParser.ts`, `NormaXmlTypes.ts`             | rings read the first role sequence's refs; `JoinRule` never read     | read the ring's `JoinRule` with `parseJoinRule`                             |
| `formats/src/norma/mapping/factConstraints.ts`, `constraintPasses.ts` | flat ring or silent drop                                             | a decoded path makes a `join_ring`; a flat ring is only a flat sequence     |
| `formats/src/norma/NormaXmlWriter.ts`, `NormaXmlSerializer.ts`        | `buildRing` writes a plain role sequence                             | `join_ring` writes its sequence with `writeJoinPath`                        |

The flat `ring` is not touched anywhere: its type, placement, rules,
messages and sentences stay as they are, and every existing ring test
keeps passing unmodified. The one exception is the verbalizer's ring
sentence builder, which is refactored to take its predicate as an
argument so both kinds share it (WS1); the flat ring's goldens pin that
the refactor changed no output.

## Target architecture

```ts
// model/Constraint.ts
export interface JoinRingConstraint extends ConstraintBase {
  readonly type: "join_ring";
  /** A path projected to exactly two nodes played by one object type. */
  readonly operand: JoinOperand;
  readonly ringType: RingType;
}
// PLACEMENT.join_ring = "external"

// validation/rules/population/ring.ts -- the seam
export function ringFindings(
  ringType: RingType,
  pairs: readonly (readonly [string, string])[],
): RingFinding[];

// validation/rules/population/joinPath.ts
// projectedTuples(model, universe, c.operand) -> pairs -> ringFindings(c.ringType, pairs)
```

```yaml
# .orm.yaml 3.0, under model.constraints
- type: join_ring
  id: no-own-grandparent
  ring_type: irreflexive
  operand:
    path:
      root: person
      steps:
        - { entry: r-child, exit: r-parent }
        - { entry: r-child, exit: r-parent }
    projection: [0, 2]
```

## Alternatives considered

- **Two operands, one per end of the relation, sharing a root.** Mirrors
  the trio's operand lists, but a ring is one relation, not a comparison
  of two; two operands would need a rule that they share a root, and a
  projection per end of one column each. One operand projected to two
  columns is the relation itself, and it is what NORMA's single
  role-sequence-with-join states.
- **An optional `path` on `ring`.** Lost to placement (above): a kind is
  internal or external by one table, and making `ring` conditional
  would put an `if` in every reader the table exists to remove.
- **Normalizing a one-hop `join_ring` to `ring` on load.** Rejected for
  the loader: it changes what the file says. The NORMA importer may emit
  the plain kind when that is all a path is (Open decision 3), because
  there the input is NORMA's and the choice of spelling is barwise's.

## Workstreams (each independently shippable)

### 1. The kind in core, and every reader that switches on kinds

Adds `JoinRingConstraint` and handles it in every exhaustive switch the
type checker surfaces: helpers, serde, schema, reference diagnostics,
structural rules, population, verbalization, diff, merge, counterexample
(unsupported), lineage, diagram (not drawn) and DDL routing. These land
together because adding a union member breaks every exhaustive switch at
once, and a placeholder in any of them (a verbalization that says
nothing, a population check that passes everything) is a gate that cannot
fail. Test bar per the role-path spec's per-variant list: a round trip, a
verbalization golden per ring type, one satisfied and one violated
population per property, the two new structural rules seen failing, the
single-fact-type warning, and a diff and merge case. The flat ring's
goldens and population tests pass unmodified.

### 2. NORMA import and export

Precondition, verified first: no fixture in the repository holds a ring
whose role sequence carries a `JoinRule`, so this workstream starts from
a NORMA-authored file that does (the grandparent ring is enough) and
checks that `parseJoinRule`, which today reads the set-comparison
sequences, reads the ring's unchanged. If NORMA writes the ring's path
some other way, this section is revised before code.

The parser reads a ring's `JoinRule`; the mapper decodes it with the
existing join decoder and produces `join_ring`; the writer and serializer
write it back. `mapRingConstraint` stops taking "the first two roles in
this fact type" from a sequence that carries a join. The existing test
"drops a ring constraint that resolves to fewer than two roles in the
fact type" is re-read: a ring with a decodable `JoinRule` now imports;
one without stays dropped, and the test names which. Adds a NORMA
round-trip fixture with a join ring (model to NORMA to model, the
role-path spec's RT-A), and files the import-warning channel as an issue.
Depends on WS1.

## API and migration impact

- New exports from `@barwise/core`: `JoinRingConstraint`, `isJoinRing`.
- `ConstraintType` gains a member; downstream exhaustive switches
  (`formats`, `diagram`) update in WS1, and the build names every site.
- `.orm.yaml` 3.0 gains one optional construct. No migration: no older
  file can contain it.
- NORMA import produces constraints it used to drop or misread; a model
  re-imported after WS2 can differ from one imported before it, by
  exactly the join rings the old import lost or mangled.

## Open decisions (for review)

1. **Rule ids: new, or the flat ring's?** Options: reuse
   `constraint/ring-different-players` and `population/ring-violation`
   for `join_ring`, or add `constraint/join-ring-*` and
   `population/join-ring-violation`. Reuse means one rule per idea; new
   ids follow the trio, which has its own population ids
   (`population/join-subset-violation` and siblings), and lets a reader
   filter the path-derived findings, which are the ones that need the
   path chain to explain. **Recommend new ids**, matching the trio.
2. **Operand shape: one operand projected to two columns, or two
   operands?** Argued under Alternatives. **Recommend one operand.**
3. **A one-hop `join_ring` inside one fact type.** Options: refuse it
   (error), warn and keep it, or accept it silently. It is the flat ring
   spelled the long way, so two files can state one constraint two ways
   and diff will not pair them. **Recommend a warning** naming `ring`,
   and have the NORMA importer emit `ring` when a decoded path is one hop
   in one fact type, so an import never produces the long spelling.

## Implementation notes

What WS1 found that the draft did not say.

- **Verbalization does not share the flat ring's sentence builder.** The
  draft planned to refactor `verbalizeRing` to take its predicate as an
  argument. That builder forms negatives as `"does not " + predicate`,
  and a reading's predicate already starts with its verb, so the flat
  ring reads "Person1 does not is parent of Person3", pinned as correct
  by `Phase2ConstraintVerbalizer.test.ts` (barwise-gzk). Sharing it would
  have spread the defect; `verbalizeJoinRing` words its eight sentences
  around "relates" instead, and the flat ring is untouched.
- **The one-hop warning needs no fact-type test.** A step that passes the
  structural rules already lies within one fact type, so the warning is
  "one hop"; the draft's "within one fact type" is always true by then.
  A projection naming one node twice ([2, 2]) relates each object only to
  itself, so `constraint/join-ring-arity` refuses it as not two distinct
  nodes, and an operand whose ends differ in type stops at
  `-different-players` rather than also being advised to become a ring.
- **Population reads samples.** The draft fed `projectedTuples` the object
  universe, as the other join kinds do, and the universe leaves samples
  out. A ring rejects data present, as the flat ring's direct population
  read does, so a join ring's roots are every value its first hop's entry
  role plays, samples included. It reports the first finding per property,
  as the other join kinds report their first offending tuple.
- **The population entry is a sibling, not a replacement.** The flat
  ring's messages name a population and an instance; a projected pair has
  neither. `joinRingViolationTexts` in `population/ring.ts` runs the same
  `PROPERTY_CHECKS` and words each finding by the constraint's span.
- **Adding a kind reshuffles every seeded law sample.** The arbitrary
  draws kinds from `CONSTRAINT_TYPES`, so one more kind moves every draw.
  The new sample reached three counterexample generators that minted from
  a domain naming one value and so built "counterexamples" that satisfy
  their own constraint (mandatory and disjunctive mandatory through the
  anchor's filler, ring through non-distinct witnesses, external
  uniqueness through equal keys); each now emits none there. It stopped
  reaching external uniqueness at all, which a blind fact-type pick had
  only reached by luck, so the arbitrary now looks for a keyed pair. The
  stray baseline (141 to 110) and the renamed-pair preferred-identifier
  floor (15 to 11, measured 14) carry notes saying why they moved.
- **The schema's ring type list is one definition.** `ring_type_def` is
  referenced by both `ring` and `join_ring`, rather than a second inline
  copy of the enum.
- **NORMA export dropped a `join_ring` between WS1 and WS2.** The writer's
  `default` arm returned nothing for a kind it did not know; WS2 writes it.

What WS2 found.

- **The precondition was settled from NORMA's schema, not an authored
  file.** No file NORMA wrote with a join ring was at hand. NORMA's
  `ORM2Core.xsd` defines `RingConstraintType` as an extension of
  `SetConstraintWithJoinType`: one `RoleSequence` of
  `ConstraintRoleSequenceWithJoinType`, projected roles then an optional
  `JoinRule` -- the same `JoinRule` the set-comparison sequences carry, so
  `parseJoinRule` reads it unchanged. A file NORMA writes is still the
  stronger check, and the first one met should become a fixture.
- **NORMA lists a ring under its fact type, so the misread lived in phase
  1.** `collectProcessedRefs` marks every ref a fact's InternalConstraints
  lists, so the ring pass the draft named never saw a listed ring;
  `mapRingConstraint` read it per fact type. A ring carrying a `JoinRule`
  is now mapped by the ring pass alone, listed or not: mapping it in both
  places imported a ring two fact types list twice, and lost a one-hop ring
  listed under a fact type other than its hop's (both found in review).
- **An unreadable `JoinRule` is not "no join".** `parseJoinRule` returns
  nothing for a path it cannot read, which made the ring look flat and
  imported the flat ring again. The parser now records that a rule was
  present (`unreadableJoin`), and such a ring imports as nothing. Saying
  so is the import-warning channel, filed as barwise-bqy.

## Risks and testing

- **The flat ring must not move.** Its goldens, population tests and
  NORMA tests pass unmodified in both workstreams; the verbalizer
  refactor in WS1 is the one change near it, and the goldens are its
  check.
- **A population check that cannot fail.** The violated case for each
  ring property is seen failing under a mutant that drops the
  `join_ring` branch, per the assertion-audit skill.
- **The NORMA importer changing what it imports.** WS2's re-read of the
  drop test, and a fixture whose join ring would previously have imported
  as a wrong flat ring, show both halves: what is now read, and what is
  no longer misread.
- Run the full monorepo build and tests after WS1; it changes core's
  public union.

## Non-goals

- No change to the flat `ring` kind or to the role-path grammar.
- No import-warning channel, counterexample support or diagram glyph for
  any join kind.
