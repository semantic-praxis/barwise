# Settle every primary key before anything reads one

Status: WS1 implemented (the identification-cycle rule, the shared
identification graph, the arbitrary's cycle discipline, and the two
spurious objectifications deleted from the taxonomy example). WS2 not
implemented.
Created: 2026-09-08
Last-updated: 2026-09-08
Tracking: barwise-966 (this spec); barwise-963 (a foreign key keeps a
key a later step replaced); barwise-965 (a subtype fact truncates a
composite subtype key); barwise-962 (an entity may objectify a fact type
it plays in); the clause `core-model-laws.spec.md` WS5 deferred;
barwise-931, the same defect class already fixed once

In one sentence: a table's primary key must be final before anything
reads it, so the mapper settles every key first and builds columns and
foreign keys second.

## Principle

This is **define errors out of existence**, applied to a module that has
now produced the same defect four times.

`RelationalMapper` mutates primary keys as it goes. Step 1 sets a key
from the reference mode, step 2b replaces it for an objectified entity,
step 3 replaces it again for an identified subtype -- and step 2 has
already built foreign keys against whatever it happened to see. Every
site that reads a key must therefore know whether that key is final, and
four sites have got it wrong:

| Defect           | Key set by | Read too early by                             |
| ---------------- | ---------- | --------------------------------------------- |
| barwise-931      | step 2b    | five sites truncating a composite to `[0]`    |
| barwise-963      | step 2b    | step 2, foreign key built before              |
| barwise-965      | step 2b    | step 3, truncates the key and mis-aims its FK |
| the cycles below | step 2b    | step 2b itself, on another entity             |

barwise-931 was fixed by making each reader handle a composite key. That
is the shallow fix: it made the readers more careful and left the state
in which carelessness is possible. Two more defects followed in the same
module, and one of them -- barwise-965 -- passes every clause the WS5
mapper law ships.

The deep fix removes the state. After it, no site can read a non-final
key, because non-final keys do not exist by the time anything reads one.
That is the same move the resolved WS4 decision makes with the object
universe: stop asking callers to be careful, and delete the condition
under which care is needed.

`REPO_REVIEW-2026-06-23.md` already flagged this file, at 691 lines, as
"cohesive algorithm; watch". That was a size observation and not a
finding; the defect record since is what turns it into one.

Determinism is not at stake -- the mapper is already pure -- but
**explicit over implicit** is. The order the steps must run in is today
a fact about the source's line numbers, recoverable only by reading all
four steps. This makes it a declared dependency the compiler enforces.

## Should the mapper report an identification cycle, or should the validator reject one? (resolved: the validator)

Settling keys requires an order, and an order requires the dependency
graph to be acyclic. It is not, today, and nothing says so.

An entity type's key depends on another's along two edges. **Objectification**:
the objectifying entity's key is the composite of the columns absorbed
from its fact type's entity players, so it depends on each player's key.
**Identifying subtype**: an identified subtype's key extends its
supertype's, so it depends on the supertype's. Both are cycle-capable,
and `structural/subtype-cycle` covers only one edge kind and only for
subtypes.

Three cycles are constructible today and all three carry no structural
diagnostic. What the mapper does with them, measured on `main`, is the
argument for putting the guard in the validator:

```
Self-objectification (barwise-962). E objectifies a fact type E plays in.
  TABLE e cols=[e_id] pk=[e_id] fks=[]
    -- coherent, but only because PR #456 added a defensive skip to
       mapObjectifiedFactType. Without it the table carried a foreign key
       to a column that was no longer a key of anything.

Mutual objectification. E objectifies a fact type F plays in, and F one E plays in.
  TABLE e cols=[e_id, f_id]            pk=[f_id]           fks=[f_id->f(f_id)]
  TABLE f cols=[f_id, is_noted_f_id]   pk=[is_noted_f_id]  fks=[is_noted_f_id->e(f_id)]
    -- e's foreign key names f(f_id); f's key is by then is_noted_f_id.

Mixed. Sub is an identified subtype of Super; Super objectifies a fact type Sub plays in.
  TABLE super cols=[super_id, sub_id]  pk=[sub_id]  fks=[sub_id->sub(sub_id)]
  TABLE sub   cols=[sub_id]            pk=[sub_id]  fks=[sub_id->super(sub_id)]
    -- each row identified by the other; neither can be inserted first.
```

The first case is the one already patched and the last two are what the
patch cannot see. #456's skip tests `player.id === oft.objectTypeId`,
which is the cycle of length one; a cycle of length two goes straight
through it. A guard written per shape will keep missing the next shape,
which is the general argument for stating the property once over the
whole graph.

The mapper is the wrong place to report this. Its `map` has no error
path, eleven call sites across six packages take its return value, and
the WS5 totality law asserts it does not throw -- so reporting a cycle
from there means either breaking that law or widening a signature six
packages consume, to carry a diagnostic about a model that was already
invalid before mapping began.

An object type identified, transitively, by itself is not a mapping
problem. It is a malformed model, in the same way a subtype cycle is,
and `structural/subtype-cycle` is the precedent for where that is said.
So the validator rejects it, the mapper's phase 1 may assume a DAG, and
the self-objectification case (barwise-962) falls out as the length-one
cycle of the same rule -- closing an open issue as a side effect rather
than as extra scope.

The mapper still must not throw on a cycle, because a model can be
mapped without being validated. It degrades deterministically instead:
see the last Scope requirement.

## Scope

In scope, stated as requirements:

- When a model contains a cycle in its identification graph -- the
  directed graph whose edges run from an objectifying entity type to
  each entity player of its objectified fact type, and from an
  identified subtype to its supertype -- the system shall report a
  `structural/identification-cycle` diagnostic naming one object type on
  the cycle.
- When an object type objectifies a fact type in which it plays a role,
  the system shall report that same diagnostic, this being the
  length-one cycle (barwise-962).
- When the mapper maps a model, the system shall settle every entity
  table's primary key before building any column or foreign key that
  reads one.
- When an entity table's primary key is settled, the system shall not
  permit any later step to change it.
- When a foreign key is emitted, its `referencedColumns` shall equal the
  referenced table's `primaryKey.columnNames` in order, and its
  `columnNames` shall have the same length.
- When an identified subtype's own key is composite, the shared key
  shall extend every column of it, not the first (barwise-965).
- When a model reaching the mapper still contains an identification
  cycle, the system shall map it without throwing, leaving the
  reference-mode key in place for the entity type that closes the cycle,
  chosen deterministically.

Out of scope: the mapper's column _naming_ scheme, settled in PR #456
and revisited under Decision 3 separately; any change to what tables a
model maps to; the `@barwise/formats` renderers, which consume the
schema and are unchanged.

## Inventory

| Module                                                     | Current state                                                            | Verdict                                           |
| ---------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------- |
| `core/src/model/identification.ts`                         | does not exist                                                           | new: the one identification-graph builder (WS1)   |
| `core/src/validation/ruleId.ts`                            | 76 rule ids, `subtypeCycle` among them                                   | adds `identificationCycle` (WS1)                  |
| `core/src/validation/rules/structural.ts`                  | `checkSubtypeCycles` walks subtype edges only                            | adds the identification-cycle rule (WS1)          |
| `core/tests/arbitraries/model.ts`                          | builds a cycle in 57 of 250 sampled models, 55 of them self-objectifying | stops generating cycles (WS1)                     |
| `examples/transcripts/rb-global-account-taxonomy.orm.yaml` | two objectifications naming a type that plays a role in the fact type    | the two entries deleted (WS1)                     |
| `core/src/mapping/RelationalMapper.ts` (`map`)             | four ordered steps, keys mutated in 2b and 3                             | two phases; keys settled first (WS2)              |
| `core/src/mapping/RelationalMapper.ts` (barwise-962 skip)  | defensive `continue` added in PR #456                                    | removed; the rule replaces it (WS1)               |
| `core/src/mapping/RelationalSchema.ts` (`MutableTable`)    | `primaryKey` assignable throughout mapping                               | assignable only in phase 1 (WS2)                  |
| `core/src/mapping/RelationalMapper.ts` (`mapSubtypeFact`)  | shared key is `[ownPk[0], ...restSupertypePk]`                           | extends the whole own key (WS2, barwise-965)      |
| `core/tests/laws/mapper.law.test.ts`                       | four structural clauses; the key-equality clause deferred                | the deferred clause returns (WS2)                 |
| `core/tests/mapping/RelationalMapper.test.ts`              | fixtures for barwise-961, -962, and the -963 ratchet                     | -962 and the ratchet go; -965 becomes positive    |
| `cli/tests/characterization/golden/*`                      | eighteen goldens: three models, six formats                              | unchanged; none of the three carries either shape |
| `core/src/mapping/renderers/*`, `formats/*`                | consume `RelationalSchema`                                               | untouched; the schema type does not change        |

`RelationalMapper.map`'s signature does not change, so the eleven call
sites across `cli`, `mcp`, `vscode`, `dbt`, `formats` and `core`'s own
`exportAnnotationMap` are untouched.

## Target architecture

```ts
// core/src/model/identification.ts -- one owner, read by both callers
/** Which entity types an entity type's identification depends on. */
export function identificationGraph(model: OrmModel): Map<string, readonly string[]>;

/** Settlement order, or the cycle that makes one impossible. */
export function identificationOrder(
  model: OrmModel,
): { readonly order: readonly string[] } | { readonly cycle: readonly string[] };

// core/src/mapping/RelationalMapper.ts
map(model, options) {
  const tables = this.createEntityTables(model, options);   // phase 0: one table, ref-mode key
  const keys = this.settleKeys(model, tables);              // phase 1: keys, in identification order
  this.mapFactTypes(model, tables, keys);                   // phase 2: columns and foreign keys
  this.mapNonIdentifyingSubtypes(model, tables, keys);      // phase 2
  return freeze(tables);
}
```

`settleKeys` returns `ReadonlyMap<entityId, SettledKey>` and phase 2
takes it as a parameter. `MutableTable.primaryKey` becomes readonly
outside phase 1, so a future step that wants to rewrite a key fails to
compile rather than silently invalidating what came before. **The type
is what enforces the phase order** -- an ordering convention in a
comment is precisely what failed four times.

One copy is created and it is named here: the identification graph is
needed by the structural rule (to find a cycle) and by the mapper (to
order settlement). It is not copied. `identificationGraph` in
`core/src/model/` is the single owner both import, placed there because
"what identifies what" is a metamodel question and neither caller owns
the answer -- the same argument that put `valueDomain.ts` in `model/`.

## Alternatives considered

- **Reorder the steps: 2b before 2.** Measured, and insufficient. It
  fixes barwise-963's shape and exposes barwise-965's -- a foreign key
  with two columns against a one-column key -- because step 3 still
  runs last and still truncates. Recorded on barwise-963.
- **Resolve `referencedColumns` in a final pass**, leaving keys mutable
  and rewriting references at the end. Shallower, and it closes only
  barwise-963: barwise-965's key is wrong, not just its references, and
  a final pass cannot add the local columns a key that gained arity
  needs. It patches the symptom and leaves the cause.
- **Make each reader handle a mutable key.** This is what barwise-931
  did. Two further defects in the same module are the evidence against
  repeating it.
- **Report the cycle from the mapper.** Rejected above: no error path,
  eleven call sites, and a totality law that says it does not throw.

## Workstreams (each independently shippable)

### 1. The identification-cycle rule

Add `identificationGraph` and `identificationOrder` to
`core/src/model/identification.ts`, and a structural rule that reports
`structural/identification-cycle` when the graph has one. Teach
`arbOrmModel` not to generate cycles, since the WS1 serialization law
asserts every generated model carries no `structural/*` diagnostic.
Remove the mapper's defensive barwise-962 skip and its fixture; the
rule replaces both, and the three cycle shapes above become validation
fixtures.

First because it has the smaller blast radius and because WS2 depends on
it: phase 1 may assume a DAG only once something rejects the models that
are not.

**One shipped example is malformed, and the rule is what finds it.**
`examples/transcripts/rb-global-account-taxonomy.orm.yaml` declares
`UserAccountMembership` as the objectification of
`UserAccountMembership involves User`, a binary it plays the first role
of -- and does the same for `AccountOrganizationLink`. Both types are
already independently identified, by reference modes `MembershipId` and
`LinkId`, so the objectifications contradict the model's own
identification and are an extraction artifact rather than a modelling
choice. WS1 deletes the two entries: both types keep their reference
modes, both fact types stay, and nothing else moves. Re-extracting the
example from its transcript was the alternative and is not worth the
churn for a two-line deletion.

This matters beyond the example. `structural/*` rules are `error`
severity and `scripts/validate-examples.sh` fails on errors, so WS1
breaks that gate until the deletion lands in the same PR. It is also
the rule paying for itself before it ships: the one hand-shipped model
carrying this shape carries it twice, and nothing has ever reported it.

Acceptance, in EARS form: when the validator runs on each of the three
cycle models recorded under the resolved design question, the system
shall report `structural/identification-cycle`; and when
`npm run validate:examples` runs after the deletion, it shall exit
zero. Mutation check, run once by hand and recorded in the PR body:
with the cycle detection reverted to `return []`, the three fixtures
shall fail.

### 2. Two phases, and the deferred law clause

Split `map` as sketched above, fix `mapSubtypeFact` to extend the whole
own key (barwise-965), and restore the clause WS5 deferred:
`referencedColumns` equals the referenced table's key, in order. Delete
the `known defect barwise-963` ratchet fixture in the same commit --
that is what it was written for -- and turn the barwise-965 fixture from
a reproduction into an assertion.

The fix and the clause land together, for the reason
`core-model-laws.spec.md` gives twice: main never carries a red law.

Acceptance: when the mapper maps any model `arbOrmModel` produces, every
foreign key's `referencedColumns` shall equal the referenced table's
`primaryKey.columnNames` in order. Mutation check: with
`mapSubtypeFact`'s shared key reverted to `[ownPk[0], ...rest]`, the law
shall go red.

## API and migration impact

- No public API change. `RelationalMapper.map` keeps its signature, so
  the eleven call sites across six packages are untouched.
- One new rule id, `structural/identification-cycle`. Adding it without
  a `RULE_DESCRIPTORS` entry is a compile error -- verified by adding one:
  `ruleDescriptor` can no longer index the descriptor table (`TS7053` at
  `ruleId.ts:868`) -- so its severity and message cannot be forgotten.
- Generated DDL, Avro and OpenAPI change for models with an objectified
  entity or an identified subtype. Every affected shape produces invalid
  or incoherent output today, so nothing correct changes -- but the
  change is release-note material. No shipped golden moves: see Risks.
- Models that were valid become invalid: any carrying an identification
  cycle. All three shapes are unmappable in a database, so this converts
  a silent bad mapping into a reported error.

## Open decisions (resolved 2026-09-08)

- **The orphaned reference-mode column: do not create it.** An
  objectified entity used to get a reference-mode column in phase 0 and a
  different key in phase 1, leaving the first neither key nor reference
  (`assignment_id` in barwise-965's reproduction). It is no longer
  created: ORM says an objectified type's identity comes from the
  objectification, and a column that is neither key nor reference is the
  "unknown unknown" the principles warn about -- a reader cannot tell
  from the schema whether it means anything. Keeping it as a surrogate
  was the alternative and was rejected: no consumer is known to join on
  it.
- **The cycle rule is `structural/*`.** A type identified by itself is
  malformed, not merely unsatisfiable, and `structural/subtype-cycle`
  already sits at that severity for the narrower case. The cost is
  accepted and is most of WS1: `structural/*` is `error` severity, so
  the arbitrary must stop generating cycles (57 of 250 sampled models)
  and `rb-global-account-taxonomy` must be fixed in the same PR or
  `validate:examples` goes red. `constraint/*` would have been cheaper
  and would have left the mapper facing cycles forever, with phase 1
  unable to assume a DAG.

A third decision, taken at the same time, belongs to a later spec and is
recorded here because it touches the same column. When an entity's
reference mode and its preferred identifier disagree, **the preferred
identifier wins** -- one rule, no special case, and the reading
`completenessWarnings.ts` already documents: the preferred identifier is
the authority and the reference mode is the guess it exists to prevent.
That change is barwise-967 and is out of scope here.

## Risks and testing

- **Column order changes for objectified entities.** Key columns now
  materialise in phase 1, before the fact-type columns phase 2 adds, so
  `CREATE TABLE` lists them in a different order. Accepted: there is no
  production use, and the alternative (materialise keys logically, then
  append in the old positions) buys byte-identical output at the cost of
  the clarity this spec exists to gain.
- **The shipped models barely reach this change, and that is the risk.**
  Of the seventeen `.orm.yaml` models under `examples/` and `test-plan/`,
  eight carry an objectification or a subtype fact -- and none of the
  three the CLI golden test covers (`clinic-appointments`,
  `constraints-showcase`, `external-uniqueness`) carries either. So the
  goldens are expected not to move at all, and a golden diff in WS2 is a
  signal to stop and explain rather than to regenerate.
  `npm run validate:examples` does reach the eight, so it is the
  end-to-end guard for WS1's new diagnostic -- and one of the eight,
  `rb-global-account-taxonomy`, currently carries a cycle, so WS1 turns
  that gate red until it also lands the deletion. Neither gate is real
  cover for WS2, which is why the law over generated models is its
  acceptance test.
- **Teaching the arbitrary is the bulk of WS1, and it is measured.**
  Of 250 models `arbOrmModel` samples at the fixed seed, 109 carry an
  identification edge and 57 carry a cycle -- 55 of those the
  self-objectifying length-one case. Every one of the 57 would start
  reporting a `structural/*` diagnostic, which WS1's serialization law
  forbids outright, so the generator change is mandatory rather than
  tidy-up. If it turns out hard, that is a signal the rule is wrong
  rather than the generator: the shapes it can no longer build should
  be exactly the shapes the rule rejects.
- **`identificationOrder` must be total.** It returns a cycle rather
  than throwing, and the mapper's fallback keeps `map` total, so the WS5
  totality law stays green through both workstreams.
- Each workstream is one PR, followed by `npm run build` and
  `npm run ci:local` from `barwise/`.

## Non-goals

- No change to which tables a model maps to, or to the column-naming
  scheme settled in PR #456.
- No new mapper capability, no options, no configuration.
- No change to `RelationalSchema`'s shape, so no renderer changes.
- No attempt to fix barwise-964 (goldens are diffed but never parsed),
  which would have caught these and is its own change.
