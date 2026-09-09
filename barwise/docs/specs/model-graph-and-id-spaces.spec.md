# Resolve references once: `ModelGraph`, and which id spaces earn a brand

Status: Workstream 1 (`NormaId`) shipped 2026-09-09; Workstreams 2-5 not
implemented
Created: 2026-09-09
Last-updated: 2026-09-09
Tracking: barwise-974 (this spec), barwise-973 (WS1, partly shipped),
barwise-924 (the parent review, closed since PR #423), barwise-945 (the
population tuple, out of scope here and named in Non-goals)

This respecifies WS3 of `core-branching-load.spec.md` as a standalone
spec, because the branded-id question belongs in the same design and
the parent's one-paragraph sketch cannot carry it. The parent spec
stays the authority on WS1, WS2 and WS4-WS8; on WS3 it defers here.

## Principle

**Explicit over implicit says a reference should be declared, not
that every consumer should re-derive it.** A bare-string reference is
the implicit form wearing the explicit form's clothes: `Role.playerId`
is a `string`, so the player must be looked up, the lookup can fail,
and the result is the widest possible type. Every consumer then writes
the same prologue -- resolve, guard against a failure validation
already refuses, discriminate on kind -- before doing any work of its
own.

That is change amplification with an unknown unknown underneath, in
Ousterhout's terms. The amplification is visible: 131 `getObjectType`
call sites, 13 lookup prologues in the validation rules alone. The
unknown unknown is the dead half. `structural.ts` refuses a model whose
role points at a non-existent object type, so in any model that
validates, the `undefined` arm cannot be taken -- and nothing tells a
reader that. It is the same defect WS1 step 1 removed from
`RelationalMapper`, where a reference-mode fallback sat inside a branch
that made it unreachable, replicated across core at a scale no reader
can hold.

The resolution is the house rule already stated for duplication,
applied to references: derive it from the authority, once. A graph
derived from a built model has total accessors, because the model it
was built from proved the references. A capability then reads
resolved values instead of resolving them.

## Should we brand all ids? (resolved: no -- brand one id space, and resolve the rest)

**Branding catches the confusion this codebase is least likely to
suffer, and misses the one it is most likely to suffer.** A
`unique symbol` brand distinguishes `RoleId` from `ObjectTypeId`, which
are already separated by parameter names and function signatures. It
cannot distinguish `supertypeId` from `subtypeId`, or `supersetRoleIds`
from `subsetRoleIds`, because each pair carries the same brand -- and
those are the swaps with real consequences: an inverted subtype
relation, an inverted subset constraint.

Measured rather than assumed. The probe, so the table below can be
re-derived rather than trusted:

```ts
declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B; };
type ObjectTypeId = Brand<string, "ObjectTypeId">;
type RoleId = Brand<string, "RoleId">;

declare function getObjectType(id: ObjectTypeId): string;
declare const someRoleId: RoleId;
declare const someOtId: ObjectTypeId;

getObjectType("ot-1"); // TS2345: string is not assignable to ObjectTypeId
getObjectType(someRoleId); // TS2345: RoleId is not assignable to ObjectTypeId
getObjectType(someOtId); // ok
const m = new Map<ObjectTypeId, number>();
m.set(someOtId, 1); // ok
const s: string = someOtId; // ok
const t = `${someOtId}`; // ok
```

Run it with the repo's own compiler --
`node node_modules/typescript/bin/tsc --noEmit --strict --target es2022 probe.ts`
-- which reports exactly the two errors annotated above and nothing
else from this file:

| Property                                             | Branded id   |
| ---------------------------------------------------- | ------------ |
| bare string literal accepted                         | no (TS2345)  |
| wrong-kind id caught (`RoleId` where `ObjectTypeId`) | yes (TS2345) |
| same-kind swap caught (`subtypeId` / `supertypeId`)  | no           |
| usable as `string`, `Map` key, in template literals  | yes          |
| runtime cost                                         | none         |

The cost follows from row one. Branding model ids means 18 cast sites
in `packages/core/src` and 136 id string literals in `packages/core`
tests that stop compiling:

```sh
# 13 deserializer id assignments
grep -rn 'id: .*Doc\.\|id: otDoc\|playerId: \|roleId: \|factTypeId: ' \
  packages/core/src/serialization/yaml/*.ts | wc -l
# 5 generateId() call sites (excluding its own module)
grep -rn 'generateId()' packages/core/src --include=*.ts \
  | grep -v 'src/model/id.ts' | wc -l
# 136 id string literals in tests
grep -rnE '(playerId|roleId|factTypeId|objectTypeId): "' \
  packages/core/tests --include=*.ts | wc -l
```

The decisive argument is not cost, though. **WS3 deletes most model-id
passing, so branding model ids invests in the code this same spec
removes.** After the graph lands, a capability holds a `ResolvedRole`
carrying its player; it does not hold a `playerId` it passes to a
lookup. Typing an argument that is about to stop being passed is
motion, not progress.

One id space does earn a brand, and resolution cannot help it:
`@barwise/formats` ran model ids and NORMA ids through the same
`string`. `normaId` was defined twice -- `NormaXmlWriter.ts:64` and
`populationGraph.ts:29` -- and the second carried the comment "Mirrors
the writer's id convention". That copy was registered in neither
`parity.manifest.json` nor `audit-baseline.json`, so its agreement was
guarded by a comment, which the root `CLAUDE.md` convention forbids
outright. Workstream 1 shipped `normaId.ts` as the one owner, so the
copy is gone rather than registered. The brand runs one way: a bare
`string` cannot reach NORMA output, while a `NormaId` still flows into
a model-id position, which is what the import path has always done.

## Scope

In scope:

- When a caller requests the graph for a model whose references all
  resolve, the system shall return a `ModelGraph` whose accessors are
  total -- no accessor returns `undefined` for a reference the model
  declares.
- When a caller requests the graph for a model holding a reference that
  does not resolve, the system shall return a failure carrying a
  diagnostic per unresolvable reference, and shall not return a graph.
- When a validation rule needs a role's player, the system shall
  provide it through the graph, and the rule shall not perform its own
  lookup or guard.
- When a constraint verbalizer renders a role reference, the system
  shall render the resolved player's name, and shall not fall back to
  an id.
- When `graphOf` is called twice with the same model value, the system
  shall return a graph reflecting that model; memoization is deferred
  (see Workstream 2).
- When code in `@barwise/formats` converts a model id to a NORMA id,
  the system shall do so through one exported function returning
  `NormaId`, and shall not accept a `NormaId` where a model id is
  required.

Out of scope, each named so the boundary is explicit:

- **Branding model ids.** Deferred to an Open decision, to be re-taken
  after Workstream 5 when the remaining id-passing can be counted.
- **The population tuple's domains** (barwise-945). `roleValues` stays
  `Record<string, string>`; the graph makes the fix cheaper by giving a
  rule the fact type's roles and each role's player, but constraining
  the tuple is its own change.
- **The rest of WS1.** `Role`, `FactType`, `SubtypeFact`,
  `ObjectifiedFactType` and `Population` stay classes; see the
  dependency correction in Workstream 2.
- **The 54 lookups outside `@barwise/core`.** The Principle section
  opens with 131 `getObjectType` call sites, and this spec reaches 77
  of them. The rest are `formats` 19, `diagram` 12, `learn` 12, `llm` 6
  and `vscode` 5, each resolving references against a model it holds.
  They are out of scope because `graphOf` is core's to build and its
  consumers migrate one package at a time; they are named here because
  a spec that opens with 131 and silently delivers 77 is the same
  unchecked claim this respec exists to correct. Migrating them is a
  follow-on, and cheap once the graph exists.
- **WS2, WS4-WS8** of the parent spec.

## Inventory

Every row re-measured on `main` `7600a7b`, 2026-09-09. The parent
spec's WS3 figures were taken at `664b9fe`; three of eight are wrong
rather than stale, and are corrected here.

| Area                                                    | Current state                                                                                                                                                             | Verdict                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `model/Role.ts`                                         | `playerId: string`; a bare reference                                                                                                                                      | unchanged; the graph resolves it                                  |
| `model/OrmModel.ts`                                     | `getObjectType(id): ObjectType \| undefined`, 131 call sites repo-wide                                                                                                    | unchanged; stays the raw store                                    |
| `model/roleGraph.ts`                                    | `hopsFrom(model, objectTypeId: string)`, one caller (`query/evaluate.ts:357`); `RoleHop` referenced nowhere else                                                          | moves into `ModelGraph` (WS4)                                     |
| `validation/rules/*.ts`                                 | 13 reference lookups (`structural` 6, `joinConstraintRules` 4, `constraintConsistency` 2, `derivationRules` 1); some are prologues, some ARE the dangling-reference check | split: prologues take the graph, checks move into `graphOf` (WS3) |
| `verbalization/`, `counterexample/`                     | 28 lines ending in a `?? roleId` / `?? roleIds[i]` fallback, 27 of them in `constraints/phase1.ts` and `phase2.ts`                                                        | takes resolved roles; fallbacks go (WS5)                          |
| `query/evaluate.ts`                                     | 3 `?? playerId` fallbacks; imports `hopsFrom`                                                                                                                             | takes the graph (WS4)                                             |
| `describe/summaries.ts`                                 | 2 `?? playerId` fallbacks (lines 47, 189), the same shape as query's                                                                                                      | takes the graph (WS4)                                             |
| `counterexample/CounterexampleGenerator.ts`             | `findRoleById` at :537, a linear scan                                                                                                                                     | replaced by a graph accessor (WS5)                                |
| `formats/norma/NormaXmlWriter.ts`, `populationGraph.ts` | two `normaId` definitions, agreement guarded by a comment, unregistered                                                                                                   | one owner, branded `NormaId` (WS1)                                |
| `packages/core/src/mapping/`                            | **no** `?? id` player fallbacks                                                                                                                                           | untouched -- see below                                            |
| `validation/constraintEnforcement.ts`                   | no graph today                                                                                                                                                            | builds the graph internally, so `learn` is untouched (WS3)        |

The lookup count has a command, because two readers counting different
things is how the parent spec's figures went wrong in the first place:

```sh
grep -rn 'getObjectType(\|getRoleById(\|getFactType(' \
  packages/core/src/validation/rules/*.ts | wc -l    # 13
```

That is the pattern this spec means by "reference lookup". A narrower
one counting only `model.get*` gives 10, and the parent spec's "13
prologues and ~20 undefined guards" is a fourth figure it got wrong --
the guard count is 12 by
`grep -rn -A2 ... | grep -cE 'if \(!|\?\?|continue|\?\.'`. Whichever
pattern a later reader prefers, the point is that it is written down.

Four corrections a reviewer should not have to find:

- The parent spec says "query and the mapper lose their `?? id` player
  fallbacks". There are three such sites and **all three are in
  `query/evaluate.ts`**; `packages/core/src/mapping` has none. The
  mapper row above says `untouched` for that reason, and WS1 step 1
  already removed the one mapper fallback that did exist.
- The parent spec names a `joinSegments` helper with "six copies of one
  punctuation ladder". **`joinSegments` does not exist anywhere in the
  repository.** The underlying pattern is real -- 11 `.join()` ladders
  in `verbalization` -- 7 by
  `grep -rn '\.join(' packages/core/src/verbalization`, not the 11 an
  earlier draft of this spec reported from a pattern that also matched
  non-`join` lines -- but the named helper was invented in the sketch
  and never built. It is not carried forward here; consolidating those
  ladders is a separate, smaller change with no dependency on the
  graph.
- The parent spec says `hopsFrom` has **two callers**. It has one
  (`query/evaluate.ts:357`), and `RoleHop` is referenced in no file
  outside `roleGraph.ts`. The "two" comes from `roleGraph.ts`'s own
  header naming "the forthcoming role-path constraint operands" as the
  second; those landed in `joinConstraintRules.ts` walking
  `getRoleById` directly. The header is stale, and an earlier draft of
  this spec repeated it rather than measuring -- the same mistake, one
  document further on.
- The parent spec's "six `?? roleId` fallback ladders" is 28 lines, and
  its "~12 tests that pin `bogus` prose" is 46 occurrences across five
  files. Both are understated, which makes WS5 the largest workstream
  here rather than the smallest.

## Target architecture

```ts
// packages/core/src/model/graph.ts -- derived, never stored
//
// Fallible ONCE, at build. Building is where a dangling reference is
// found, so that is where it is reported; every accessor on a graph
// that was built is total. This is the whole trade: one failure point
// instead of the 131 the lookups have today.
// The failure arm carries plain records, NOT Diagnostic. Nothing under
// model/ imports from validation/ today (grep), and minting a
// Diagnostic<RuleId> here would invert that layering for a type the
// graph does not otherwise need. validation/ maps these to diagnostics
// under the ids it already owns; every other consumer reads them
// directly. This is how constraintEnforcement keeps @barwise/learn out
// of validation's types.
export interface UnresolvedReference {
  readonly from: {
    readonly kind: "role" | "constraint" | "population";
    readonly id: string;
  };
  readonly missing: string; // the id that does not resolve
  readonly field: string; // "playerId", "roleId", "factTypeId", ...
}

export type GraphResult =
  | { readonly ok: true; readonly graph: ModelGraph; }
  | {
    readonly ok: false;
    readonly unresolved: readonly UnresolvedReference[];
  };

export function graphOf(model: OrmModel): GraphResult;

export interface ModelGraph {
  // Total: building proved these references, so none can fail.
  player(role: Role): ObjectType;
  factTypeOf(role: Role): FactType;
  rolesOf(c: Constraint): readonly Role[];
  constraintsOn(role: Role): readonly Constraint[];
  rolesPlayedBy(ot: ObjectType): readonly Role[];
  populationsOf(ft: FactType): readonly Population[];
  supertypesOf(ot: ObjectType): readonly ObjectType[];
  subtypesOf(ot: ObjectType): readonly ObjectType[];
  hopsFrom(ot: ObjectType): readonly RoleHop[];
  resolve(c: Constraint): ResolvedConstraint;
}

export interface ResolvedRole {
  readonly role: Role;
  readonly player: ObjectType; // resolved; the caller never looks it up
  readonly factType: FactType;
}

export interface ResolvedConstraint {
  readonly constraint: Constraint;
  readonly roles: readonly ResolvedRole[];
  readonly spansFactTypes: boolean;
  readonly commonPlayer?: ObjectType;
}

// packages/formats/src/norma/normaId.ts -- the one id-space boundary
declare const brand: unique symbol;
export type NormaId = string & { readonly [brand]: "NormaId"; };
export function toNormaId(modelId: string): NormaId;
```

Two rules the sketch encodes, so no workstream can drift from them:

- **Totality is a property of a built graph, not of `graphOf`.** An
  accessor returning `ObjectType | undefined` puts the prologue back,
  so accessors are total -- but that is only honest if something
  established the references resolve, and today nothing does. An
  `OrmModel` can hold a constraint naming a role that does not exist:
  `constraintConsistency` reports it, and reporting is a separate pass
  no caller is required to run. The 46 `bogus` tests construct exactly
  that and verbalize it without validating. So `graphOf` is fallible
  and a `ModelGraph` is not. If a reference can genuinely be absent,
  that absence belongs in the model's own types (an optional field),
  never in an accessor's return type.
- **The graph is derived, never stored.** Two live representations
  would have to be kept in sync; one value and one view rebuilt from it
  cannot disagree. Models are hundreds of elements, so the rebuild is
  not a cost worth trading correctness for.

## Alternatives considered

- **Brand every id, and keep the lookups.** This was the shape the
  question arrived in. It fails on its own terms: it does not remove a
  single lookup or `undefined` guard, it cannot catch the same-kind
  swaps that are the real risk here, and it costs 136 test-literal
  sites plus 20 source casts. Worse, it makes the lookups _look_
  principled, which is the failure mode where a brand is worse than no
  brand.
- **Resolve into the elements themselves** -- give `Role` a `player:
  ObjectType` instead of a `playerId`. This kills the lookups most
  directly, and loses on serialization and cycles: the YAML is a flat
  document of ids, so the deserializer would need a two-pass build, and
  an element holding another element makes structural equality and
  `Object.freeze` recursive. The graph gets the same resolution with
  the value staying flat.
- **A resolver function rather than a graph** -- `resolvePlayer(model,
  role)` used at each site. Removes the `undefined` but keeps the
  per-call scan and gives no place for the adjacency accessors
  (`rolesPlayedBy`, `hopsFrom`) that today recompute. It is the shallow
  version of the same idea.
- **Require a pre-validated model** -- `graphOf(m: ValidatedModel)`,
  with the type carrying the proof so `graphOf` cannot fail. This is
  the better end state and it is not reachable yet: the only thing that
  could mint a `ValidatedModel` is WS1's `ModelBuilder`, which does not
  exist (`packages/core/src/model/ModelBuilder.ts` is absent; the
  `ModelBuilder` under `tests/helpers/` is a fixture builder). Adopting
  it would make this spec depend on WS1 after establishing that it does
  not. A fallible `graphOf` reaches the same totality for consumers,
  needs nothing that does not exist, and can be tightened to the
  validated-model form later without touching a single accessor.
- **Leave it; the branches are the domain.** The parent spec's own
  finding is that about half the branching is domain and half is
  representation. The 13 prologues and 28 fallbacks are squarely the
  representation half: none of them encodes an ORM 2 rule, and each
  defends against a state validation refuses.

## Workstreams (each independently shippable)

Ordered smallest-blast-radius first. Each is its own PR and keeps the
full suite green.

### 1. `NormaId`, and one owner for the conversion (SHIPPED)

The only workstream with no dependency on the graph, and the one that
closes a live convention violation.
`packages/formats/src/norma/normaId.ts` owns the `NormaId` brand,
`toNormaId` (convert a model id, idempotently), `asNormaId` (assert
provenance for a token read from a NORMA document) and
`derivedNormaId` (extend a NORMA id, because template concatenation
erases the brand). Both duplicate `normaId` definitions are gone.

**Two corrections this workstream forced.**

The blast radius was stated as "roughly a dozen call sites". It is one
package, as claimed, and about 110 touch points: 59 id and `*Ref`
fields in `NormaXmlTypes.ts`, ~50 conversion sites in the writer and
population graph, and 28 provenance assertions at the parser's XML
boundary. The estimate was an order of magnitude low.

The acceptance criterion named an unachievable direction. "Passing a
`NormaId` where a model id is required shall fail to compile" cannot
hold while model ids are plain `string`: a branded string IS assignable
to `string`, verified with a `tsc --strict` probe. That direction is
also the one the import path needs, because `mapping/objectTypes.ts`
assigns `id: et.id` verbatim and a NORMA id legitimately becomes a
model id. The criterion below states the direction that is both
achievable and valuable.

Acceptance: when code sends a value to NORMA output, a bare `string`
shall not be accepted where a `NormaId` is required, so every value
passes through `toNormaId`, `asNormaId` or `derivedNormaId`. Watched
going red on three planted defects: a forgotten conversion on an id
field, one on a `*Ref` field, and a derived id built by template
instead of the helper.

**The `*Ref` fields are in scope, and finding that out is why the
mutation check matters.** An earlier cut of this workstream typed only
the 33 `id` fields, reasoning that `*Ref` fields are consumption sites
rather than mint sites. The first mutation -- dropping `toNormaId` from
`subjectRef` in the writer -- compiled clean, because `subjectRef` is a
conversion site wearing a Ref name. All 28 are typed.

### 2. `graphOf` and `ModelGraph`, with no consumer migrated

Build the graph and its tests; change no caller. This is the step that
proves the accessors can be total before anything depends on them.

`graphOf` mints no diagnostic at all; it returns `UnresolvedReference`
records and `validation/` maps them to the ids it already owns. `RULE_ID`
is flat, so those are `RULE_ID.mandatoryInvalidRole`,
`ringInvalidRole`, `frequencyInvalidRole`, `cardinalityInvalidRole`,
`internalUniquenessInvalidRole`, `valueConstraintInvalidRole` and
`valueComparisonInvalidRole` (`ruleId.ts:48-75`) -- `constraint/` is the
prefix of the id STRING, not a nesting level -- plus
`RULE_ID.danglingRoleReference` (`structural/dangling-role-reference`,
`ruleId.ts:100`) for the player case, which is not a `constraint/` id.
No diagnostic is minted outside the registry: `Diagnostic<string>` is
the widening `closed-sets-as-unions.spec.md` WS2 exists to prevent.

**Dependency correction.** The parent spec says WS3 depends on WS1. It
does not, for this step: a graph is derived by reading a model, and
does not care whether `Role` and `FactType` are records or classes --
only `ObjectType` is a record today, and the graph builds fine over the
rest. The real coupling is narrower and worth stating precisely:
`WeakMap` memoization of `graphOf` is unsound while a model is mutable,
because a cached graph would outlive an `addObjectType` call. So
**memoization waits for the rest of WS1; the graph does not.** Until
then `graphOf` is called once per operation and the cost is measured
rather than assumed.

Acceptance: when `graphOf` is given any model in the `.orm.yaml`
corpus, it shall return `ok` and every accessor shall return a defined
value for every reference the model declares; and when it is given a
model holding a constraint that names a role the fact type does not
have, it shall return a failure naming that reference. Both halves are
required -- the failure case is what makes the success case mean
something, and it is the reading that must be established first.

### 3. Validation rules split: prologues take the graph, checks move into it

**Not every lookup in `validation/rules/` is a prologue, and this is
the workstream where that distinction decides the design.** Three of
the 13 are the dangling-reference check itself: `structural.ts:43`
(`if (!model.getObjectType(role.playerId))`, which emits
`RULE_ID.danglingRoleReference`), `constraintConsistency.ts`'s
`ft.hasRole(...)` guards, and `joinConstraintRules.ts:148-151`
resolving `step.entry` / `step.exit`. Those cannot "take the graph": a
model with a dangling reference has no graph to take.

So `graphOf` becomes the single owner of reference resolution. The
three checks are deleted here and their tests move to `graphOf`'s;
every remaining lookup is a prologue and reads the graph.
`ValidationEngine.validate` gains sequencing it does not have today:
build the graph first, and when it fails, return the reference
diagnostics mapped from `UnresolvedReference` plus the rules that need
no references (completeness warnings, population checks), skipping the
graph-taking rules. A caller still sees everything knowable about a
model that cannot build.

That ordering also prevents a duplicate: with the graph reporting
`constraint/mandatory-invalid-role` and `constraintConsistency` still
checking `hasRole`, one defect would produce two diagnostics, and
`Phase2ConstraintConsistency.test.ts`'s `diags.some(...)` assertions
would not notice.

`constraintEnforcement.ts` builds the graph internally, so
`@barwise/learn`'s calls into core do not change. That is the only
sense in which learn is untouched: it holds 12 `getObjectType` lookups
of its own in `evaluate/populationMapping.ts`, among the 54 named out
of scope above.

Acceptance: when a validation rule needs a role's player, it shall read
it from the graph; no rule in `validation/rules/` shall resolve a
reference itself; and when `graphOf` fails, `validate` shall return one
diagnostic per unresolvable reference and no duplicates.

### 4. Query and describe take the graph; `hopsFrom` moves

The 3 `?? playerId` fallbacks in `query/evaluate.ts` and the 2 in
`describe/summaries.ts` go, and `model/roleGraph.ts`'s `hopsFrom`
becomes a graph accessor. `hopsFrom` has one caller
(`query/evaluate.ts:357`) plus its own test, so the move is contained --
`roleGraph.ts`'s header claims two, naming "the forthcoming role-path
constraint operands" as the second; those landed in
`joinConstraintRules.ts` walking `getRoleById` directly, so the header
is stale and an earlier draft of this spec repeated it instead of
measuring. `describe/` rides along rather than getting its own
workstream because its two fallbacks are the same shape as query's,
resolved the same way, in the same package.

### 5. Verbalization and counterexample take resolved roles (largest)

The 28 fallback lines across `phase1.ts` and `phase2.ts` go, and
`findRoleById`'s scan is replaced.

**This workstream carries a test question that is a reviewer's call,
not an implementer's.** 46 assertions across five files pin the prose
produced for an unresolvable reference -- the `bogus` fixtures. Once the
graph is total, that prose becomes unreachable, so those assertions
pin behaviour that cannot occur. Under the `assertion-audit` skill that
is a test asserting a limitation rather than a capability. See Open
decisions.

## API and migration impact

- `@barwise/core` gains `graphOf`, `ModelGraph`, `ResolvedRole` and
  `ResolvedConstraint` from the root barrel; `model/roleGraph.ts`'s
  `hopsFrom` export is removed in Workstream 4 and its two callers move
  to the graph.
- `@barwise/formats` gains `NormaId` and `toNormaId`; nothing outside
  the package imports them.
- No public type on `OrmModel`, `Role`, `FactType` or any element
  changes, so `@barwise/mcp`, `barwise-vscode`, `@barwise/dbt`,
  `@barwise/code-analysis` and `@barwise/diagram-ui` are untouched.
  That claim is checked by the build, not by inspection.
- The `.orm.yaml` serialized form does not change. The corpus must
  serialize byte-identically, verified the way WS1 step 1 verified it:
  build `packages/core` from `main` in a worktree, dump
  `serialize(deserialize(f))` from both builds over all 63 corpus
  files, normalize generated constraint UUIDs, and `diff -rq` the
  trees.

## Open decisions (for review)

- **Brand model ids after Workstream 5?** Options: (a) defer and
  re-measure once the graph has removed the id-passing it can --
  recommended, because the cost is 136 test literals and the benefit
  shrinks with every workstream here; (b) brand now, accepting that
  some of the typing lands on code Workstreams 3-5 delete; (c) never,
  and rely on resolved pairs alone. The recommendation is (a), with the
  re-measurement being
  `grep -rnE '\b[a-zA-Z]*[Ii]d: string\b' packages/core/src --include=*.ts | wc -l`,
  which is 177 today. Note what it counts: interface fields as well as
  parameters, and the lowercase-`id` spelling. The narrower
  `[a-zA-Z]*Id: string` gives 127. The number is only a trigger for
  re-taking the decision, so either is usable -- but it has to be the
  same one both times, which is why the command is here rather than
  the description.
- **What happens to the 15 `bogus` prose assertions.** The 46 is
  occurrences of the string, not assertions, and it mixes two
  populations. `Phase2ConstraintConsistency.test.ts` holds 11 and
  `structural.test.ts` 1: those already assert the reference is
  REPORTED, never prose, so they are settled by Workstream 3 rather
  than by this decision. The three verbalization test files hold 34,
  of which 19 are fixture lines and **15 are `expect` calls on prose**.
  Those 15 are what this decides. They do not pin a
  dangling _player_ -- `structural.ts` refuses those. They pin a
  dangling constraint-to-role reference
  (`{ type: "mandatory", roleId: "bogus" }`), constructed directly and
  verbalized **without validating**, which is why the fallbacks exist
  at all. Options: (a) convert them to assert that `graphOf` reports
  the unresolvable reference -- recommended, because that is the
  behaviour that will exist and it needs nothing that does not;
  (b) delete them as testing a state no supported caller reaches;
  (c) keep a subset if `skipPlayerValidation` and `lenient` survive
  (14 references today). This is a reviewer's call because it decides
  whether verbalizing an unvalidated model stays supported. An earlier
  draft of this spec recommended converting them to _builder-rejection_
  tests; that was withdrawn on grounding, because the builder it named
  does not exist.
- **Whether `graphOf` belongs in `core`'s root barrel or a subpath.**
  The package convention puts capability modules on subpaths
  (`@barwise/core/mapping`, `/diff`) and the metamodel on the root. The
  graph is derived from the metamodel and used by capabilities, so it
  argues both ways. Recommended: the root barrel, because
  `validation/` already ships from the root and is its first consumer.

## Risks and testing

- **The totality claim is the whole design, so it is tested first, in
  both directions.** Workstream 2 ships with a test that builds the
  graph over every `.orm.yaml` in the corpus and asserts every accessor
  returns a defined value, AND a test that a model with an unresolvable
  constraint-to-role reference makes `graphOf` fail. The failing
  reading is established before the passing one; a totality test that
  has never been seen reject anything is the untracked-probe reading
  this repo has a ledger entry for (barwise-906).
- **No surface validates before verbalizing, and one shipped path
  crashes today.** An earlier draft of this bullet claimed the
  opposite, in the reassuring direction, and it was wrong twice.
  `loadModel` in `packages/cli/src/workspace/io.ts` only deserializes
  (with `lenient`); `packages/mcp/src/workspace/resolve.ts` is the
  same; `HoverProvider.ts:71` verbalizes the parsed model directly.
  None calls `ValidationEngine`. And `verbalizeAll` does not uniformly
  prose `"bogus"` -- the binary mandatory path in `phase1.ts` (:106,
  :118) has no guard on `role` at all. Reproduced on `a16a489` by
  pointing `simple.orm.yaml`'s mandatory constraint at a missing role:

  ```
  $ barwise validate dangling.orm.yaml
  ERROR  Mandatory constraint ... references role id "bogus" which does not belong ...
  $ barwise verbalize dangling.orm.yaml
  Error: Cannot read properties of undefined (reading 'playerId')   # exit 1
  ```

  So WS5 **is** a shipped-path behaviour change, and an improvement: an
  uncaught `TypeError` becomes a reported failure. What the spec still
  owes is the plumbing -- what each surface does when `graphOf` fails on
  a loaded-but-unvalidated model. The answer is the one `validate`
  already gives: surface the diagnostics and exit non-zero. WS5 owns it
  for `cli`, `mcp` and `vscode`, and that is why WS5 is last.
- **Verbalization output is the behaviour most at risk**, because
  Workstream 5 removes fallbacks that currently produce prose. The
  golden verbalization tests guard it; any golden that changes is a
  defect until proven otherwise, not a golden to regenerate.
- **Performance is a claim, not an assumption.** "Models are hundreds
  of elements, so the rebuild is not a cost" must be measured in
  Workstream 3 against the largest corpus model before Workstreams 4
  and 5 build on it.
- Each workstream is a separate PR, and each runs `npm run ci:local`
  (28 gates) plus the corpus byte-identity check described above.

## Non-goals

- No new capability. Nothing this spec adds is reachable from the CLI,
  MCP or VS Code surfaces, so the capability matrix in the root
  `CLAUDE.md` does not change.
- No change to the `.orm.yaml` format, the JSON schemas, or
  `schemaVersion`.
- No constraint on the population tuple (barwise-945). The graph makes
  that fix cheaper; it does not make it.
- No mutation-path change. `ModelBuilder` and the `OrmModel` edit
  methods are WS1's subject, not this spec's.
