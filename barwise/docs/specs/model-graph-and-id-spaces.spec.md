# Resolve references once: `ModelGraph`, and which id spaces earn a brand

Status: Draft -- no workstream implemented
Created: 2026-09-09
Last-updated: 2026-09-09
Tracking: barwise-974 (this spec), barwise-973 (WS1, partly shipped),
barwise-924 (the parent review), barwise-945 (the population tuple, out
of scope here and named in Non-goals)

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

Measured rather than assumed, with a `tsc --strict` probe:

| Property                                             | Branded id   |
| ---------------------------------------------------- | ------------ |
| bare string literal accepted                         | no (TS2345)  |
| wrong-kind id caught (`RoleId` where `ObjectTypeId`) | yes (TS2345) |
| same-kind swap caught (`subtypeId` / `supertypeId`)  | no           |
| usable as `string`, `Map` key, in template literals  | yes          |
| runtime cost                                         | none         |

The cost follows from row one. Branding model ids means 20 cast sites
in `packages/core/src` (13 deserializer assignments plus 7
`generateId()` calls) and **136 id string literals in `packages/core`
tests** that stop compiling.

The decisive argument is not cost, though. **WS3 deletes most model-id
passing, so branding model ids invests in the code this same spec
removes.** After the graph lands, a capability holds a `ResolvedRole`
carrying its player; it does not hold a `playerId` it passes to a
lookup. Typing an argument that is about to stop being passed is
motion, not progress.

One id space does earn a brand, and resolution cannot help it:
`@barwise/formats` runs model ids and NORMA ids through the same
`string`. `normaId` is defined twice -- `NormaXmlWriter.ts:64` and
`populationGraph.ts:29` -- and the second carries the comment "Mirrors
the writer's id convention". That copy is registered in neither
`parity.manifest.json` nor `audit-baseline.json`, so its agreement is
guarded by a comment, which the root `CLAUDE.md` convention forbids
outright. Branding `NormaId` gives the conversion one owner and makes
the two spaces non-interchangeable at compile time.

## Scope

In scope:

- When a caller requests the graph for a model, the system shall return
  a `ModelGraph` whose accessors are total -- no accessor returns
  `undefined` for a reference the model declares.
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
- **WS2, WS4-WS8** of the parent spec.

## Inventory

Every row re-measured on `main` `7600a7b`, 2026-09-09. The parent
spec's WS3 figures were taken at `664b9fe`; three of eight are wrong
rather than stale, and are corrected here.

| Area                                                    | Current state                                                           | Verdict                                                    |
| ------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------- |
| `model/Role.ts`                                         | `playerId: string`; a bare reference                                    | unchanged; the graph resolves it                           |
| `model/OrmModel.ts`                                     | `getObjectType(id): ObjectType \| undefined`, 131 call sites repo-wide  | unchanged; stays the raw store                             |
| `model/roleGraph.ts`                                    | `hopsFrom(model, objectTypeId: string)`, two callers                    | moves into `ModelGraph` (WS4)                              |
| `validation/rules/*.ts`                                 | 13 lookup prologues, 12 with an `undefined` guard                       | takes the graph; prologues go (WS3)                        |
| `verbalization/constraints/phase1.ts`, `phase2.ts`      | 28 lines ending in a `?? roleId` / `?? roleIds[i]` fallback             | takes resolved roles; fallbacks go (WS5)                   |
| `query/evaluate.ts`                                     | 3 `?? playerId` fallbacks; imports `hopsFrom`                           | takes the graph (WS4)                                      |
| `counterexample/CounterexampleGenerator.ts`             | `findRoleById` at :537, a linear scan                                   | replaced by a graph accessor (WS5)                         |
| `formats/norma/NormaXmlWriter.ts`, `populationGraph.ts` | two `normaId` definitions, agreement guarded by a comment, unregistered | one owner, branded `NormaId` (WS1)                         |
| `packages/core/src/mapping/`                            | **no** `?? id` player fallbacks                                         | untouched -- see below                                     |
| `validation/constraintEnforcement.ts`                   | no graph today                                                          | builds the graph internally, so `learn` is untouched (WS3) |

Three corrections a reviewer should not have to find:

- The parent spec says "query and the mapper lose their `?? id` player
  fallbacks". There are three such sites and **all three are in
  `query/evaluate.ts`**; `packages/core/src/mapping` has none. The
  mapper row above says `untouched` for that reason, and WS1 step 1
  already removed the one mapper fallback that did exist.
- The parent spec names a `joinSegments` helper with "six copies of one
  punctuation ladder". **`joinSegments` does not exist anywhere in the
  repository.** The underlying pattern is real -- 11 `.join()` ladders
  in `verbalization` -- but the named helper was invented in the sketch
  and never built. It is not carried forward here; consolidating those
  ladders is a separate, smaller change with no dependency on the
  graph.
- The parent spec's "six `?? roleId` fallback ladders" is 28 lines, and
  its "~12 tests that pin `bogus` prose" is 46 occurrences across five
  files. Both are understated, which makes WS5 the largest workstream
  here rather than the smallest.

## Target architecture

```ts
// packages/core/src/model/graph.ts -- derived, never stored
export function graphOf(model: OrmModel): ModelGraph;

export interface ModelGraph {
  // Total: the model proved these references, so none can fail.
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

- **Totality is the point, not convenience.** An accessor that returns
  `ObjectType | undefined` puts the prologue back. If a reference can
  genuinely be absent, that absence belongs in the model's own types
  (an optional field), not in the graph's return type.
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
- **Leave it; the branches are the domain.** The parent spec's own
  finding is that about half the branching is domain and half is
  representation. The 13 prologues and 28 fallbacks are squarely the
  representation half: none of them encodes an ORM 2 rule, and each
  defends against a state validation refuses.

## Workstreams (each independently shippable)

Ordered smallest-blast-radius first. Each is its own PR and keeps the
full suite green.

### 1. `NormaId`, and one owner for the conversion

The only workstream with no dependency on the graph, and the one that
closes a live convention violation. Introduce
`packages/formats/src/norma/normaId.ts` exporting the `NormaId` brand
and `toNormaId`; delete both `normaId` definitions in favour of it.
Blast radius is one package and roughly a dozen call sites.

Acceptance: when code converts a model id for NORMA output, it shall do
so through `toNormaId`, and passing a `NormaId` where a model id is
required shall fail to compile. The two-definition copy is gone rather
than registered, so no `parity.manifest.json` entry is needed -- and if
the implementation finds a reason to keep two, the entry is required in
the same commit.

### 2. `graphOf` and `ModelGraph`, with no consumer migrated

Build the graph and its tests; change no caller. This is the step that
proves the accessors can be total before anything depends on them.

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
corpus, it shall build without error and every accessor shall return a
defined value for every reference the model declares.

### 3. Validation rules take the graph

The 13 prologues and 12 `undefined` guards in
`validation/rules/*.ts` go. `constraintEnforcement.ts` builds the graph
internally so `@barwise/learn` is untouched.

Acceptance: when a validation rule needs a role's player, it shall read
it from the graph; no rule in `validation/rules/` shall call
`getObjectType`.

### 4. Query takes the graph; `hopsFrom` moves

The 3 `?? playerId` fallbacks in `query/evaluate.ts` go, and
`model/roleGraph.ts`'s `hopsFrom` becomes a graph accessor. Two
callers, so the move is contained.

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
  re-measurement being a count of surviving `[a-zA-Z]*Id: string`
  parameters in `packages/core/src` -- 177 today.
- **What happens to the 46 `bogus` assertions.** Options: (a) convert
  them to builder-rejection tests, so the suite pins that an
  unresolvable reference is _refused_ rather than prosed --
  recommended, since that is the behaviour that will actually exist;
  (b) delete them as testing an impossible state; (c) keep a
  deserializer-level subset if lenient loading survives. This is a
  reviewer's call because it decides whether "a model with a dangling
  reference" remains a representable value anywhere in core.
- **Whether `graphOf` belongs in `core`'s root barrel or a subpath.**
  The package convention puts capability modules on subpaths
  (`@barwise/core/mapping`, `/diff`) and the metamodel on the root. The
  graph is derived from the metamodel and used by capabilities, so it
  argues both ways. Recommended: the root barrel, because
  `validation/` already ships from the root and is its first consumer.

## Risks and testing

- **The totality claim is the whole design, so it is tested first.**
  Workstream 2 ships with a test that builds the graph over every
  `.orm.yaml` in the corpus and asserts every accessor returns a
  defined value. If a real model can break totality, the design is
  wrong and it should surface before any consumer depends on it.
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
