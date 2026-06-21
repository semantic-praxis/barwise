# Role-path / join-rule model

Status: Approved 2026-06-20 (sign-off to proceed); WS1 (the
`model/roleGraph.ts` traversal seam) landed 2026-06-18 (barwise-sf1).
Metamodel-thread implementation underway, decomposed so each PR keeps the
suite green: (PR 1) representation + serde + schema + verbalization + diff +
structural well-formedness validation; (PR 2) population-satisfaction
evaluation; (PR 3/4) NORMA import, then export + RT-A + merge id-remap.
Created: 2026-06-18
Last-updated: 2026-06-20
Tracking: barwise-0s8 (this design), barwise-5t9.10 (role-path substrate),
barwise-5t9.6 (join set-comparison/ring),
docs/adr/0001-metamodel-evolution-policy.md (tier 3),
docs/specs/refactor-metamodel-consolidation.spec.md (ownership)

## Principle

This is the one tier-3 construct in ADR-0001: the single addition that
breaks the "inline and local" filter, because a role path is a small graph
that spans fact types rather than a flat field on one fact type. The whole
job of this spec is to add that expressiveness with the _least_ damage to
the legibility that is barwise's edge over NORMA XML, and to fix the
representation _once_ because three gaps consume it (join set-comparison
5t9.6, derivation rules 5t9.2, queries 5t9.11).

The other three filters are non-negotiable and shape the design: the path
is stored _data_ evaluated purely in core (deterministic); it must
verbalize, diff, and round-trip (bounded cost, lossless); and it reuses the
existing traversal rather than forking it. The design below localizes the
unavoidable non-locality to a single inline constraint object, keeps the
common no-join case exactly as cheap as it is today, and shares one
traversal substrate with the query path so there is one graph-walk in core,
not two.

## Should declared role-paths reuse the query `path` type? (resolved: no -- separate data, shared traversal)

No -- and the distinction is the heart of the reuse question. `@barwise/
core/query` already walks the same model graph, but its `path` is the wrong
_shape_ for a constraint operand on every axis:

| Axis        | query `path` (exists)                 | constraint role-path (needed)          |
| ----------- | ------------------------------------- | -------------------------------------- |
| Direction   | _discovered_ at read time (BFS)       | _declared_ and serialized              |
| Keyed by    | object-type names (`from`/`to`)       | role ids (stable, round-trippable)     |
| Granularity | fact-type level (`PathStep.factType`) | role level (entry + exit role per hop) |
| Lifetime    | ephemeral `QueryResult`               | persisted model value (diff, RT-A)     |
| Precision   | "some fact type connects A and B"     | exact roles + the join variable        |

The canonical case proves the granularity gap: `Person --bornIn--> Country`
and `Person --citizenOf--> Country` share endpoints (Person, Country) and
differ only in _which role/fact type_ is traversed -- a discovered
name-keyed `PathStep` cannot pin that down unambiguously for storage, and a
declared operand must.

So the _data types_ are separate (one discovered-and-name-keyed, one
declared-and-id-keyed), but per ADR-0001 the _traversal_ is shared: factor
the role-graph adjacency that query BFS uses into a pure
`model/roleGraph.ts` primitive, and have both query discovery and join-
constraint evaluation walk it. One graph-walk, two callers, two result
shapes. This honours "reuse, don't fork" without contorting a result type
into a stored operand.

## Should the path live inline on the constraint, or as a referenced entity? (resolved: inline)

Inline. A role path spanning fact types is non-local no matter what, so the
only question is _where the author and the LLM read it_. Two options:

- _Referenced entity_ -- a top-level `rolePaths:` collection the constraint
  points at by id. This is exactly NORMA's design and exactly the failure
  mode ADR-0001 names: a separate referenced graph the author (human or
  LLM) must keep consistent across distant elements. It maximizes id-graph
  fragility -- the thing `.orm.yaml` exists to avoid.
- _Inline nested_ -- the constraint carries its operand path(s) as nested
  plain objects, so the entire rule (both paths + the join) reads and edits
  in one self-contained place.

Inline wins decisively: it localizes the non-locality to a single
constraint object, which is the most local a cross-fact-type construct can
be, and it is the robust shape under LLM generation (the spine of the
NORMA-vs-yaml argument). The cost is DRY-secondary: a path reused by two
constraints is duplicated. ADR-0001 explicitly accepts that -- "a little
duplication beats an abstraction that couples." Paths are also short (root +
a few hops), so the duplication is cheap.

## Should we extend the flat set-comparison constraints, or add join variants? (resolved: add variants)

Add new variants; leave the flat constraints untouched. Today `subset`,
`equality`, and `exclusion` carry flat role-id arrays -- the no-join case,
which is the common case. Two ways to add joins:

- _Generalize_ the existing constraints so an operand is either a flat role
  sequence or a path. This mutates the shape of every existing flat
  constraint, forces a schemaVersion migration of existing files, and
  couples the cheap common case to the expensive rare one.
- _Add variants_ -- new union members (`join_subset`, `join_equality`,
  `join_exclusion`) carrying inline paths, with the flat ones unchanged.

Add variants. It is additive (existing files round-trip untouched, zero
migration risk to current constraints), it keeps the discriminated-union +
type-guard pattern the metamodel already uses, and it keeps "explicit over
implicit": a flat subset stays a cheap flat subset; you reach for a join
variant only when you actually need a join. The NORMA importer routes a
no-join role sequence to the flat constraint and a join path to the variant;
the exporter inverts. (`ring` over a join path is the same move -- a
`join_ring` variant -- but it is rarer; this spec specs the set-comparison
trio and leaves `join_ring` as a follow-on with the identical shape.)

## Scope

In scope: the `RolePath` value, the three join set-comparison constraint
variants that consume it (the minimal grammar for barwise-5t9.6), the
shared `roleGraph` traversal seam, and how all of it verbalizes, diffs,
serializes, and round-trips through NORMA.

Out of scope (each consumes `RolePath` later, unchanged): derivation rule
_bodies_ (5t9.2) and query/subquery _bodies_ (5t9.11) -- this spec makes
`RolePath` sufficient as their operand but builds neither; branching/tree
paths, sub-paths, and multiple join variables; negation, optional roles,
outer joins; value-comparison along a path (5t9.9); `join_ring` (same shape,
follow-on).

## The representation

A `RolePath` is a plain serializable value: a root object type (the join
variable) and an ordered list of hops, each traversing one fact type from
an entry role to an exit role.

```
RolePath = {
  root: ObjectTypeId          // the correlation / join variable's type
  steps: { entry: RoleId; exit: RoleId }[]   // entry+exit are roles of one
                                             // fact type; fact type is
                                             // derivable from the role id
}
// endpoint type = player(last step.exit); empty steps => endpoint = root
```

The new constraint variants (discriminated union members, with
`isJoinSubset` / `isJoinEquality` / `isJoinExclusion` type guards):

```
JoinSubsetConstraint    { type: "join_subset";    id?; subset: RolePath; superset: RolePath }
JoinEqualityConstraint  { type: "join_equality";  id?; paths: RolePath[] }   // 2+, unordered
JoinExclusionConstraint { type: "join_exclusion"; id?; paths: RolePath[] }   // 2+, unordered
```

`personCountryDemo` ("Each Person was born in the same Country of which that
Person is a citizen") serializes as:

```yaml
constraints:
  - type: join_equality
    paths:
      - root: ot-person
        steps:
          - { entry: r-person-bornIn,    exit: r-country-bornIn }
      - root: ot-person
        steps:
          - { entry: r-person-citizenOf, exit: r-country-citizenOf }
```

Hops store role ids -- consistent with every existing constraint, stable
for round-trip, and the same opacity the flat `subset`/`equality` already
accept. Legibility is delivered where it already is for those constraints:
by _verbalization_, which walks the path composing each hop's fact-type
reading into "... the same Country of which that Person is a citizen." A
path that cannot verbalize is not done (ADR-0001); the verbaliser is a new
function in the now-decomposed `verbalization/constraints/phase2.ts`, a
module addition, not a god-switch edit.

## The subset cut line (barwise-5t9.6 minimal grammar)

In -- the smallest grammar that covers the join set-comparison case and the
`personCountryDemo` fixture:

- _Linear_ paths only: a path is a sequence of single-fact-type hops, no
  branching or sub-paths.
- A _single_ join variable: the shared `root` correlates the operand paths.
  All operands of a constraint share the same root object type.
- _Endpoint_ comparison: the constraint compares the projected endpoint
  (player of the last hop) of each operand path; all operands must share the
  same endpoint object type.
- _Contiguity_: step `k`'s exit player equals step `k+1`'s entry player; n-
  ary fact types are fine because entry and exit roles are explicit.

Out -- deferred so we do not build the full ORM 2 path engine prematurely:
branching/tree paths and `RoleSubPathType`; multiple/independent join
variables (`ObjectUnifierType` unifying non-root nodes); multi-column
endpoint projection; negation, optional, outer joins. The
`{ root, steps }` shape extends to these later (more steps, a richer hop, a
list of join variables) without invalidating files written against the
minimal grammar.

## Identity and equality (diff / merge / RT-A)

A join constraint is compared _structurally_, normalized: by `type`, `root`
type, and the ordered `(entry, exit)` role-id sequence of each operand path
-- with operands ordered for `join_subset` (subset vs superset) and compared
as an unordered set for `join_equality` / `join_exclusion`. Because hops are
role ids and the NORMA exporter already preserves ids (deterministic
passthrough), the path round-trips to an equal role-id sequence, so RT-A
(`model == mapper(parser(serializer(writer(model)))))`) holds.

Two existing gaps must close for this to be real, both already known:

- The diff engine does not deeply compare set-comparison constraints today
  (the NORMA exporter's RT-A test added explicit subtype/objectification
  backstops for exactly this reason). Join constraints need real diff
  coverage, or the same backstop, before RT-A can rely on it.
- `ModelMerge.remapConstraintIds` (ModelMerge.ts:267-283) already flags that
  cross-fact-type constraints need full id remapping "when implemented" --
  join constraints are that case. Merge must remap the role ids inside every
  `RolePath`, not pass constraints through unchanged.

## Refactor interaction (architecture-thread lane)

- _Flat role references are unchanged._ The new variants add a path operand
  beside the flat constraints; nothing rewrites how existing constraints
  reference roles. No churn to the common case.
- _F2 already landed._ `@barwise/core/query` is a subpath export today, so
  the shared `model/roleGraph.ts` primitive and the join-constraint
  validation slot into the existing structure with no new boundary. The
  traversal extraction (pulling query BFS's adjacency into `roleGraph`) is
  architecture-thread work -- it touches `query/`, not the metamodel
  conflict surface.
- _WS7 anticipation._ The NORMA importer decomposition (WS7,
  `god-file-decomposition.spec.md`) should leave a clean seam for a join-
  path mapping concern, since join set-comparison is a new mapping branch in
  `NormaToOrmMapper`.
- _Ownership per the consolidation spec._ `Constraint.ts`, the serializer,
  the JSON Schema, verbalization, validation, and the NORMA connector are
  the metamodel thread's lane (Lane B, held). The architecture thread owns
  the `roleGraph` traversal extraction (query-side, pure, landed) and this
  design. The two meet only at `roleGraph`'s signature.
- _WS5 (diff + merge) is the metamodel thread's_ (decided 2026-06-18).
  `diff/` and `ModelMerge` are core internals off the conflict surface, but
  WS5 needs the WS2 variant shapes and is coupled to WS6/WS7's NORMA RT-A,
  so keeping the whole constraint pipeline in one thread avoids a
  mid-feature handoff. The architecture thread's shared contribution is the
  `roleGraph` seam (WS1), not the diff extension.

## Workstreams (for the metamodel thread)

Ordered, each its own PR keeping the full suite green, smallest blast
radius first. WS1 (architecture thread, the shared seam) has _landed_, so
the `hopsFrom` contract below is live, not proposed. WS2-7 are the
metamodel thread's, on the Lane-B conflict surface, so they start once the
Tier-1 hold lifts or by explicit coordination
(refactor-metamodel-consolidation.spec.md). Do not start WS2 until the
representation and cut line are signed off.

Three load-bearing points to get right first -- each easy to get subtly
wrong, each detailed in its own section above:

- _WS1 has landed; build WS2 on the live `hopsFrom`._ The seam is shipped
  in `model/roleGraph.ts` and query discovery already consumes it; WS3
  evaluates a declared path by matching each step to a `RoleHop` (entry +
  exit role) rather than re-walking the graph (see "Should declared
  role-paths reuse the query path type?").
- _WS5 is not optional and not last._ Diff does not deeply compare set-
  comparison constraints today and `ModelMerge` only passes constraints
  through, so RT-A looks green while silently not guarding joins until both
  close. Land WS5 with or before WS6/WS7 (see "Identity and equality").
- _Add variants, never mutate the flat constraints._ Zero migration, the
  common case stays cheap, and the exhaustive-switch compile errors across
  verbalization/validation/diff/NORMA enumerate WS3-WS7 for you -- the
  nudge, not a regression (see "Should we extend ... or add variants?").

### 1. Extract `model/roleGraph.ts` (architecture thread) -- LANDED

Done (barwise-sf1). The role-adjacency that `query/evaluate.ts`'s path BFS
open-coded is factored into a pure, model-only primitive in
`packages/core/src/model/roleGraph.ts`, and `path()` now expands it.
Behaviour-preserving -- the full core suite (1310) stays green; depcruise
and purity clean. The _shipped_ contract both threads build on:

```
// model/roleGraph.ts  (pure; depends only on the model)
interface RoleHop { factType: FactType; entryRole: Role; exitRole: Role; }
// every one-fact-type hop leaving an object type, deterministic order:
//   fact types in factTypesForObjectType order, then for each role the
//   object plays (entry) each other role of that fact type (exit). Ring
//   hops (exit player == the object) are included.
function hopsFrom(model: OrmModel, objectTypeId: string): RoleHop[];
```

Query discovery (BFS) expands `hopsFrom`; WS3's join-constraint evaluation
matches each declared `{ entry, exit }` step to a real `RoleHop` and checks
contiguity (step k's exit player == step k+1's entry player). One walk, two
callers. `hopsFrom` is internal to core (imported by `query/` and, at WS3,
`validation/`) -- it is deliberately not on the public root barrel, so it
stays off the metamodel conflict surface.

### 2. Model + serialization (the foundation)

Add `RolePath` (`model/RolePath.ts` or beside the join constraints) and
the three variants to the `Constraint` union in `model/Constraint.ts`,
with `isJoinSubset` / `isJoinEquality` / `isJoinExclusion` guards. Add
serializer read/write in `OrmYamlSerializer.ts`, and add the variants +
`RolePath` `$defs` to `schemas/orm-model.schema.json` (the new `oneOf`
branches). No `orm_version` bump -- the additions are additive and follow
the project's version policy (see "Version policy" below), exactly as
value ranges (5t9.1) landed at `1.0`. A round-trip test per variant is
mandatory. Nothing here evaluates a path -- it only persists it.

### 3. Validation (roleGraph consumer)

A validation rule (in `validation/rules/`) that, given a join constraint:
checks well-formedness (all operand paths share `root` type and endpoint
type; each step is a real `RoleHop`; steps are contiguous), then evaluates
satisfaction over the population (subset/equality/exclusion of the
projected endpoints, correlated by `root`). Pure -- `check-core-purity`
guards it. Cases: well-formed satisfied, well-formed violated, malformed
(bad role ref / broken contiguity).

### 4. Verbalization

A `verbalizeJoinSubset/Equality/Exclusion` in the now-decomposed
`verbalization/constraints/phase2.ts`: walk the path, compose each hop's
fact-type reading into FORML ("... the same Country of which that Person
is a citizen"). Module addition, not a god-switch edit. Verbalization
golden per variant -- a path that cannot verbalize is not done.

### 5. Diff + merge (metamodel thread; RT-A prerequisite)

Extend `diff/` constraint comparison to compare the join variants
structurally (type + `root` + ordered `(entry, exit)` sequences; subset
ordered, equality/exclusion as a set), and extend
`ModelMerge.remapConstraintIds` (the TODO at ModelMerge.ts:267-283) to
remap the role ids _inside_ every `RolePath`. Until this lands, RT-A does
not actually guard joins -- so land it with, or before, WS6/WS7.

### 6. NORMA importer

Route a NORMA join role sequence to the matching join variant (and keep a
no-join sequence -> flat constraint). This un-drops the `personCountryDemo`
constraint that is silently discarded today. Importer tests over the
fixture.

### 7. NORMA exporter (RT-B follow-on)

Emit the join variants to NORMA (the `norma-export.spec.md` WS3 slot), and
add a join-path RT-A fixture (`personCountryDemo`) to
`NormaExportFormat.test.ts`. With WS5 done, RT-A
(`M == mapper(parser(serializer(writer(M)))))`) now covers joins
end-to-end.

## API and migration impact

- New public model types from `@barwise/core`: `RolePath` and the three
  join constraint interfaces + their type guards, added to the `Constraint`
  union. Additive -- no existing export changes signature.
- No `orm_version` bump (see "Version policy"): the new variants + `RolePath`
  are added to `schemas/orm-model.schema.json` as additive `oneOf` branches
  / `$defs`, kept in sync with the serializer (`schemas/**` is
  dprint-excluded). `CURRENT_ORM_VERSION` stays `1.0`; the migration list
  stays empty.
- The serializer gains read/write for the variants; a round-trip test per
  variant is mandatory (lossless rule).
- Consumers that switch exhaustively over `Constraint` (verbalization,
  validation, diff, the NORMA mapper, the counterexample generator) get a
  compile error until they handle the new members -- the intended
  discriminated-union nudge, not a regression.

## Version policy

The standing rule for the whole metamodel queue (decided 2026-06-18, both
threads), recorded here because it is in force from this construct on:

- _Additive constructs do not bump `orm_version`._ A new optional field on
  an existing element (value ranges, defaults, notes) or a new
  discriminated-union member (the join constraint variants) is added to the
  serializer and to `schemas/orm-model.schema.json` (a new optional
  property or `oneOf` branch) without touching `CURRENT_ORM_VERSION`. This
  is the practice value ranges (5t9.1) already set -- it landed at `1.0`.
- _The `schemaVersion` migration seam is reserved for breaking changes._ A
  bump (and a migration step) is required only when an existing file would
  read _differently_ or fail under the new metamodel: a renamed, removed,
  or retyped field, or changed semantics. Additive growth is not that.
- _Cost still applies._ Every construct is still model + serializer +
  JSON Schema + validation + verbalization + round-trip test (ADR-0001's
  bounded-cost filter); "a schemaVersion migration" in that filter means
  the seam must _accommodate_ the construct, not that every construct
  bumps.
- _Forward-incompatibility is accepted._ The schema is strict
  (`additionalProperties: false`), so an old barwise rejects a file using a
  newer additive construct. That is tolerated: barwise is the sole reader
  and moves forward; we do not bump to advertise additive growth.

## Alternatives considered

- _Reuse the query `PathStep` as the operand._ Rejected: it is name-keyed,
  fact-type-granular, and result-shaped -- it cannot store the exact
  role/join a constraint needs, and coupling a stored operand to a query
  result type would distort both. (Shared _traversal_ is kept; shared _type_
  is not.)
- _Top-level referenced `rolePaths:` collection._ Rejected: reproduces
  NORMA's distant-reference fragility, the exact anti-pattern ADR-0001
  cites; worst case for LLM consistency.
- _Generalize the flat set-comparison constraints to take paths._ Rejected:
  mutates the common case, forces migration of existing files, and couples
  cheap to expensive. Adding variants keeps the cheap case cheap.

## Risks and testing

- _The "inline and local" break is real._ The mitigation is that it is
  contained to one constraint object and recovered by verbalization; the
  acceptance bar is that `personCountryDemo` round-trips through NORMA _and_
  verbalizes to a sentence a reviewer recognizes.
- _Determinism._ Path evaluation is pure over the population; `roleGraph`
  takes the model only -- guarded by `check-core-purity`.
- _RT-A depends on diff coverage._ Land join-constraint diff equality (or
  the explicit backstop) in the same change as the variants, or RT-A is not
  actually guarding them.
- Each variant ships with: a round-trip test, a verbalization golden, a
  validation case (satisfied + violated population), a diff/merge case, and
  a NORMA RT-A fixture exercising a join path.

## Non-goals

- No derivation-rule or query construct -- only the shared `RolePath`
  operand they will later consume.
- No branching paths, multiple join variables, or full ORM 2 path grammar.
- No change to the flat `subset`/`equality`/`exclusion` constraints, the
  query `path` result type, or the one-way dependency graph.
