# Model merge: decide once, translate ids once, then build

Status: Draft -- no workstream implemented

Created: 2026-11-11
Last-updated: 2026-11-11
Tracking: barwise-sic
Touches: barwise/packages/core/src/diff/ModelMerge.ts,
+barwise/packages/core/src/diff/mergeDecisions.ts,
+barwise/packages/core/src/diff/mergeIdSpace.ts,
+barwise/packages/core/src/diff/mergeRefusals.ts,
barwise/packages/core/tests/laws/merge.law.test.ts,
barwise/packages/core/tests/arbitraries/model.ts,
barwise/packages/core/tests/diff/ModelMerge.test.ts,
+barwise/packages/core/tests/diff/mergeDecisions.test.ts,
+barwise/packages/core/tests/diff/mergeIdSpace.test.ts,
+barwise/packages/core/tests/laws/mergeOracle.law.test.ts,
+barwise/packages/core/tests/diff/oracle/ModelMergeOracle.ts,
barwise/packages/core/CLAUDE.md

In one sentence: restructure `mergeModels` so that which side of every
delta is kept, and every id translation, are values computed before any
element is built, without changing what a merge returns -- after first
giving the laws model pairs whose ids differ, because today they cannot
see a fault in the translation at all.

## Principle

**Orthogonality**, inside one function. `mergeModels`
(`ModelMerge.ts:110-738`) does four jobs: decide which side of a delta
is kept, record how ids on the incoming side translate, rewrite the
references a kept element carries, and add it to the merged model. The
jobs are separable and the code interleaves them in every phase, so a
change to one is made inside the other three.

The cost is what a reader pays, and it is measured:

- **The keep decision is written seven ways.** Three if-chains
  (`:194-238`, `:258-303`, `:434-442`), `candidatesOf` (`:322-329`), an
  inline ternary (`:573-577`), `takeIncoming` (`:699-700`), and
  `keptSide` (`:1247-1258`), which arrived on 2026-10-23 and is used by
  the two newest phases and one refusal. The older phases were not
  moved onto it because each branch of their chains also records a
  translation.
- **The translation is four maps mutated across two phases**
  (`:153-174`, written at `:180-302`) and read by the phases after them. Each
  map is complete before its first reader only because of where the
  phases sit in the file; nothing states it.
- **Seven blocks slice the deltas by element kind and cast** (`:187`,
  `:242`, `:312`, `:427`, `:447`, `:563`, `:612`).
- **A constraint's references are rewritten by two traversals.**
  `mapRoleIds` goes through `mapConstraintReferences`, which refuses a
  field nobody classified. `remapConstraintIds` and `remapJoinOperand`
  (`:1418-1490`) switch over the four join kinds by hand and return any
  other kind unchanged, although the shared walker already visits a
  join path's root (`model/mint.ts:258-290`).
- **Comments describe behaviour that is not there.** The header says
  UUID (`:6`); ids are local names. `carryUnmodelledElements`' doc says
  it carries populations (`:802`, `:820`); it carries layouts.
  `resolvePlayerId` documents a by-name fallback and takes a parameter
  it never reads (`:1353-1367`). `packages/core/CLAUDE.md:43` calls the
  merge three-way; it has no common ancestor.

"Define errors out of existence" names the fix for the second bullet:
when the translation is a value built first, a stage that reads it
before it is filled cannot be written.

The file reached this shape without anyone choosing it: 357 lines on
2026-09-06, 1,594 on 2026-11-05, 57 commits, none of which restructured
it. Each added a phase or a case, which is the cheaper move for any one
change.

## Can the suite protect a restructure? (resolved: not yet, measured)

**No, and the gap is in the laws.** Six faults were planted in the
id-translation code with `scripts/mutate.mjs` on 2026-11-11 at
`3de1d063`:

| Probe | Line  | Planted fault                                              | Laws     | `tests/diff` | Whole core suite |
| ----- | ----- | ---------------------------------------------------------- | -------- | ------------ | ---------------- |
| M1    | :229  | accepted object-type change maps the incoming id to itself | UNCAUGHT | UNCAUGHT     | UNCAUGHT         |
| M2    | :302  | modified fact type maps the incoming id to itself          | UNCAUGHT | CAUGHT       |                  |
| M3    | :880  | existing-side role remap records only unchanged roles      | UNCAUGHT | CAUGHT       |                  |
| M4    | :905  | incoming-side role remap records only unchanged roles      | UNCAUGHT | CAUGHT       |                  |
| M5    | :1487 | a join path's root is not translated                       | UNCAUGHT | CAUGHT       |                  |
| M6    | :1390 | a translated object-type id is found and not returned      | UNCAUGHT | CAUGHT       |                  |

Laws: `npx vitest run tests/laws/merge.law.test.ts
tests/laws/renamedPair.law.test.ts`. The whole-suite column was run for
M1 only, the one `tests/diff` missed.

The laws catch nothing because the arbitrary gives ids by position
(`tests/arbitraries/model.ts:466`, `:516`, `:528`, `:837`), so two drawn
models share ids, every element pairs by id, and every translation is
the identity. `ModelMerge.test.ts:1128-1133` says so about roles. The
hand-written fixtures carry the whole load, and M1 shows a line they do
not reach.

So the first workstream is the instrument, and it is worth landing
whether or not the rest follows.

## What does IRI identity change here? (open: it shrinks what the translation is for)

**Since format 4.0 the two id spaces mostly coincide, which is why M1
is reached by no test.** `iri-identity.spec.md` (WS6, implemented
2026-11-04) makes an object type's or fact type's id the local name its
name gives, and replays an older file into those ids on load. Two models
that both name `Customer` therefore hold one id for it, pair by id, and
need no translation. The first draft of this spec called "two id spaces"
essential without asking how often they still differ; the owner's
question prompted the check.

They differ in four cases:

- **A pair the diff found through the ids two older files stated**
  (`priorIds`). A rename between two revisions of a 3.x file pairs by
  the old id and leaves the two sides with different 4.0 ids. M1 is this
  case. `refuseCoincidentIds` (`:1179-1240`) guards it with two
  heuristics its own comment says misread some inputs
  (barwise-wcg.3qv).
- **A replayed fragment's reference to a base element it does not
  restate**, which it names by the base's older id. `fromBasePrior`
  seeds the translation with these (`:180-184`, barwise-957). This is
  reference resolution, not pairing, and it stays whatever is decided
  about the first case.
- **An id a person stated that its name does not give**
  (`structural/id-not-from-name`, a warning).
- **A suffixed id**, where two names give one local name.

Role ids are a different matter and stay essential: a role's id is its
fact type's id and the role's name, so an accepted fact-type change can
move or drop one, and populations and constraints must follow.

Two consequences for this plan. Workstream 1's re-id'd models are the
third case, which is legitimate input, and it should also draw the
first two: a pair of models carrying prior ids, since those are the
paths the translation now mostly exists for. And the size of `idSpace` depends on
a question this spec does not own, listed under Open decisions: whether
a merge should pair through prior ids at all.

Not verified here: that an LLM draft's ids are name-given under 4.0, so
that a transcript import pairs by id. `identity.ts:16-18` still says a
draft's ids are fresh, which was true before 4.0.

## Should this be one rewrite? (resolved: no -- steps against a frozen oracle)

**Each step keeps behaviour, and the current implementation is the
judge of that.** Workstream 2 copies today's `ModelMerge.ts` into the
test tree, frozen, and adds a law: on every generated input the live
merge and the frozen one return the same serialized document, or throw
the same message. Every later step is then a small change the law
either passes or names a counterexample for, and the last workstream
deletes the copy.

A rewrite judged by the fixtures alone would rest on the suite the
table above shows has a hole. A rewrite judged by a new specification
of merge would need that specification written first, and the merge's
corner cases (repeated subtype pairs, a fragment's dangling references,
which side a preferred identifier follows) are recorded only in this
file's code and comments.

The oracle's reach is the generator's. `arbOrmModel` draws valid models
only, so the branches a lenient load reaches -- a dangling player or
fact type carried for the validator to report (`:507-513`, `:586-598`,
`:650-664`), a repeated subtype pair (`:521-524`) -- are judged by the
fixtures as they are today. It also draws no prior ids, no imports and
no namespace (`tests/arbitraries/model.ts` names none of them), so the
prior-id seeding, `refuseCoincidentIds`, `refuseImportClashes`, the
header's import branches and the alias carry of phase 9 are judged by
fixtures alone -- the kind of protection M1 slipped through. Workstream
2 measures which lines of the frozen copy the oracle law executes and
records the rest, so the boundary is a list and not a belief, and
workstream 3 does not start until each of those lines is shown red by a
planted fault against the fixtures that are supposed to cover it.

**The oracle is frozen against restructuring, not against fixes.** The
copy is taken when workstream 2 lands, and "today's behaviour" in this
spec means that copy's. `ModelMerge.ts` changes most days and three
behaviour issues are open against it, so a fix that lands while the
oracle exists changes the live file and the copy in one commit, and says
so. Workstreams 2 to 5 run back to back to keep that window short.

## Scope

In scope:

- When a merge law draws a model pair, the suite shall run it a second
  time with every id the incoming model holds replaced by one the base
  does not hold, each keeping the shape a file gives it (a role under
  its fact type, a population under its fact type, an instance under
  its population).
- When `mergeModels` is called, it shall return a model whose
  serialized document is byte-identical to the one the frozen copy of
  workstream 2 returns for the same arguments, and when that copy
  throws, it shall throw an error with the same message.
- When `mergeModels` runs, it shall compute which side of each delta is
  kept, and the translation of every object-type, fact-type and role
  id, before it adds any element to the merged model.
- When a constraint's references are rewritten, the merge shall go
  through `mapConstraintReferences` for every kind of reference, and
  when a constraint needs no rewriting it shall be passed through
  untouched, as it is today.
- When each of workstreams 3 to 5 lands, its pull request shall report
  the code lines of `src/diff/` as a whole, before and after (comments
  and blanks excluded; `ModelMerge.ts` alone holds 946 at `3de1d063`).
  The whole directory, so that moving code to a neighbour does not read
  as removing it. This is a reading for a person, not a gate: see Open
  decisions.

Out of scope, each with where it goes:

- **Any change to what a merge returns.** Three known oddities stay as
  they are: a fact type whose player the merge left out throws and
  loses the whole merge (`:1298`), where every other dependent is
  dropped or carried; an id is suffixed in placement order
  (barwise-7ny); and a failed merge does not say which structural rule
  fired (barwise-nqd). Each is a behaviour question for its own issue,
  and each is easier to answer once placement is a stage of its own.
- **Deltas typed by kind**, so `existing` and `incoming` are
  non-optional where present. That is `core-branching-load.spec.md`
  WS7, provisional there. This spec leaves the 36 `!` assertions to it.
- **One rebuild walker shared with `rename/remapIds.ts` and
  `serialization/replay.ts`.** See Alternatives.
- **The diff, the callers and the public exports.** `mergeModels`,
  `mergeAndValidate`, `getStructuralErrors`, `MERGE_DIFF_OPTIONS` and
  `MergeInput` keep their names, signatures and module.

## Inventory

| Module                                  | Current state                                            | Verdict                                             |
| --------------------------------------- | -------------------------------------------------------- | --------------------------------------------------- |
| `ModelMerge.ts:110-738` `mergeModels`   | 629 lines, 395 of code; ten maps and sets in one closure | becomes a sequence of named stages                  |
| `ModelMerge.ts:981-1240` refusals       | five checks that throw before anything is built          | moves to `mergeRefusals.ts`, rules unchanged        |
| `ModelMerge.ts:1247-1258` `keptSide`    | one of seven forms of the keep decision                  | moves to `mergeDecisions.ts`, becomes the only form |
| `ModelMerge.ts:1360-1407` id resolution | three functions reading maps and the merged model        | becomes `mergeIdSpace.ts`                           |
| `ModelMerge.ts:1418-1490` join remap    | a second traversal of a constraint's references          | deleted; `mapConstraintReferences` covers it        |
| `ModelMerge.ts:1540-1594` validation    | `getStructuralErrors`, `mergeAndValidate`                | stays                                               |
| `tests/laws/merge.law.test.ts`          | three laws in six tests, three of them two-draw          | each two-draw test runs both id forms               |
| `tests/arbitraries/model.ts`            | ids by position                                          | gains a re-id helper; the arbitrary itself is kept  |
| `tests/diff/*.test.ts`                  | 14 of 19 files call the merge, 4,466 lines               | untouched; one case added for M1                    |
| `rename/remapIds.ts`                    | rebuilds a model with ids changed                        | untouched; workstream 1 uses it to re-id a model    |
| `elementDiff.ts`, `identity.ts`         | pairing and prior-id maps the merge reads                | untouched                                           |
| `packages/core/CLAUDE.md:43`            | "three-way merge"                                        | corrected to what the code does                     |

The four call sites (`cli` merge and transcript import, `mcp`
merge tool, `vscode` import command) read `mergeAndValidate` only and
do not change.

## Target architecture

```ts
// mergeDecisions.ts -- reads the deltas and the accepted set, nothing else.
type Side = "existing" | "incoming";

interface Decided<D extends ModelDelta> {
  readonly delta: D;
  readonly index: number;
  readonly accepted: boolean;
  /** Sides to try, in order. Empty: the merge leaves the element out. */
  readonly candidates: readonly Side[];
}

interface Decisions {
  readonly header: AcceptedHeader;
  readonly objectTypes: readonly Decided<ObjectTypeDelta>[];
  readonly factTypes: readonly Decided<FactTypeDelta>[];
  readonly constraints: readonly Decided<ConstraintDelta>[];
  readonly definitions: readonly Decided<DefinitionDelta>[];
  readonly subtypeFacts: readonly Decided<SubtypeFactDelta>[];
  readonly objectifications: readonly Decided<ObjectifiedFactTypeDelta>[];
  readonly populations: readonly Decided<PopulationDelta>[];
}

declare function decide(
  deltas: readonly ModelDelta[],
  accepted: ReadonlySet<number>,
): Decisions;

// mergeIdSpace.ts -- complete before any element is built.
interface IdSpace {
  objectType(id: string, from: Side): string;
  factType(id: string, from: Side): string;
  /**
   * null: the merged model holds no role for it. On the existing side,
   * an accepted change dropped it; on the incoming side, a rejected
   * change kept a fact type with fewer roles.
   */
  role(id: string, from: Side): string | null;
}

declare function idSpace(
  existing: OrmModel,
  incoming: OrmModel,
  decisions: Decisions,
): IdSpace;

// ModelMerge.ts -- the order is today's, and is part of the behaviour.
export function mergeModels(
  existing: OrmModel,
  incoming: OrmModel,
  diff: MergeInput,
  accepted: ReadonlySet<number>,
): OrmModel {
  refuseUnmergeable(existing, incoming, diff, accepted);
  const decisions = decide(diff.deltas, accepted);
  const ids = idSpace(existing, incoming, decisions);
  const merged = emptyMerged(existing, incoming, decisions.header);
  const sides = { existing, incoming };

  placeObjectTypes(merged, decisions.objectTypes);
  placeFactTypes(merged, decisions.factTypes, ids, sides, diff.matching);
  placeConstraints(merged, overRoles(decisions.constraints), ids, sides);
  placeDefinitions(merged, decisions.definitions);
  const facts = placeSubtypeFacts(merged, decisions.subtypeFacts, ids, sides);
  placeConstraints(
    merged,
    overSubtypeFacts(decisions.constraints),
    ids,
    sides,
    facts,
  );
  placeObjectifications(merged, decisions.objectifications, ids, sides);
  placePopulations(merged, decisions.populations, ids, sides);
  carryModelState(merged, decisions, ids, sides);
  return merged;
}
```

Three things the sketch fixes in place:

- **`candidates` is a list because one kind needs two.** An accepted
  constraint modification tries the incoming side and falls back to the
  existing one (`:319-329`). Every other kind has zero or one.
- **The stage order does not change.** Subtype facts, objectifications
  and populations take their ids at placement, suffixed where the
  merged model already holds one (`mergedId`, `:975-979`), so moving a
  stage would change ids. Constraints stay split around the subtype
  facts for the same reason. The split becomes two calls of one
  function with a filter, where today it is a deferred queue filled in
  one phase and drained in another (`:414-424`, `:558`).
- **`placeSubtypeFacts` returns what the constraint stage reads.**
  `mergedIdOf` and `decidedOut` are closure state today, declared 80
  lines before the phase that fills them (`:370-371`).

`carryModelState` holds what a fresh model does not have: preferred
identifiers, diagram layouts, minted keys and import aliases (phases
6b, 7, 8 and 9). It is still a list someone must extend for a new
model-level field; this spec does not fix that. Alternative B does.

## Alternatives considered

- **B: copy the base and edit the copy.** The merge builds from an
  empty model, so it must carry everything it keeps and re-derive what
  a removal takes with it; two of its comments say as much ("as
  `removeSubtypeFact` does", `:365`; "as `OrmModel.removeObjectType`
  would", `:842`). Starting from a copy, an unchanged or rejected delta
  costs nothing, "accept nothing returns the base" and "a field nobody
  listed is kept" hold by construction, and phases 7, 8 and half of 9
  go. This is the design that could make the merge materially smaller,
  and it is not grounded. What the code shows today: `OrmModel` has a
  `remove*` for every kind, but `removeObjectType` and `removeFactType`
  refuse while anything refers to the element, so the merge would still
  order and own the removal of dependents; there is no replace-in-place,
  which an accepted modification needs to keep its id and position; and
  there is no copy except `remapIds` with an empty map, untested on a
  leniently loaded model. Each is new public surface on core's root
  aggregate, and `core-branching-load.spec.md` WS7 sketches a builder
  seeded from the base that would supply it. B is judged by the same
  oracle, so workstreams 1 and 2 serve it unchanged; Open decisions puts
  the choice to the owner.
- **A generic applier over `{kind, key, place}` rows.** Rejected once
  already, for the reason that still holds: "a generic applier for the
  merge would need the ordering expressed as data anyway"
  (`typed-diff-all-element-kinds.spec.md:175-183`). The stages above
  keep the ordering as code and take out only what repeats.
- **Tidy without restructuring.** Delete the dead parameter, fix the
  five stale comments, move phases 1 to 3 onto `keptSide`. Cheap and
  safe, and it leaves the four maps mutated in place, which is the part
  a reader cannot see. Workstream 3 does these tidies on the way.
- **No oracle; trust the laws once workstream 1 lands.** Half the
  cost. It lost because the laws assert properties (identity,
  accept-all, determinism), and a restructure can change a partial
  acceptance in a way no property names. The oracle compares documents.

## Workstreams (each independently shippable)

### 1. Model pairs whose ids differ

Tests only. A helper beside the arbitrary re-ids a model through
`remapIds`, moving every id the model holds under a fixed prefix and
keeping each id's shape: a role stays under its fact type's new id, a
population under its fact type's, an instance under its population's.
A re-id'd model then pairs with its partner by name and no longer by
id, and looks like a file a person could have written. Each two-draw
test in `merge.law.test.ts` runs both forms. One law is added: merging
any incoming model while accepting nothing returns the base, by hash.

- When the re-id'd pairs are drawn, the file's `coverage:` block shall
  assert that some pair holds an object type, a fact type and a
  population named for its fact type that pair
  by name under different ids, so the laws cannot go vacuous the way
  they are now (`tests/laws/lawPremises.test.ts` already requires the
  block).
- When workstream 1 lands, its pull request shall report the six
  probes again, laws alone. M1 shall be CAUGHT by the core suite, by a
  law or by one added fixture. A probe the laws still miss is named
  with its reason: equivalent on generated input, or a generator gap
  filed as an issue.

- When a pair carrying prior ids can be drawn, the laws shall run it
  too (provisional: how a generated model comes to hold `priorIds`
  short of writing and replaying a 3.x file is not grounded; if it
  cannot be done cheaply, the pull request says so and the case stays
  with the fixtures in `replayedFragment.test.ts` and
  `mergeCoincidentIds.test.ts`).

M3 may well stay UNCAUGHT by the laws: a generated role's id is its
fact type's id and a position, so a rebased incoming role lands on the
existing role's id and the remap has nothing to record unless the arity
differs. That is a statement about the generator, and the report says
so.

### 2. The oracle

Mechanical. Copy `ModelMerge.ts` as it stands when this workstream
lands to `tests/diff/oracle/ModelMergeOracle.ts`, imports repointed,
nothing else changed; the pull request names the commit copied. `mergeOracle.law.test.ts` draws two models, both id
forms, and a random accepted set, and asserts the live and frozen
merges agree on the serialized document or on the thrown message.

- When this lands, the pull request shall list the lines of the frozen
  copy the oracle law does not execute (v8 coverage of that one file
  under that one test), so later reviewers know which branches rest on
  fixtures.

The copy is a frozen snapshot, and the law is its check. If
`audit:duplication` or `knip` reads it as a finding, it is classified
there as a test oracle with this spec named; it is not a must-agree
copy, since agreeing with it is the test.

### 3. Decisions and the id space (provisional: not yet grounded)

`decide` and `idSpace` as pure functions with unit tests of their own
over hand-built deltas; the phases read them; the in-phase map writes,
six of the seven decision forms and the seven slicing blocks go.
`resolvePlayerId` goes and the stale comments are corrected.

Two claims here are predictions:

- **A role's merged id can be computed without building the fact
  type.** It is the incoming role's id rebased by `rebaseRoles`
  (`:1309-1320`), paired by position. This holds if `addFactType` keeps
  the role ids it is given. If it renames one, `idSpace`'s role half is
  computed after the fact-type stage from the built fact types, and the
  sketch's signature changes to say so.
- **A pure lookup reproduces `resolveObjectTypeId`.** Today an id the
  merged model already holds wins over the map (`:1386`). Under
  id-first matching a shared id is one element, so the two should
  agree; the oracle decides, and a counterexample is recorded here as
  the rule the lookup must keep.

### 4. Stages (provisional: not yet grounded)

The phases become the stage functions of the sketch, the refusals move
to `mergeRefusals.ts`, `remapConstraintIds` and `remapJoinOperand` are
replaced by one `mapConstraintReferences` call handling role and
object-type references, and the three copies of "can it be added; else
is the reference dangling in its source; else drop" become one helper.

The constraint change is the risky one here. `mapConstraintReferences`
returns a constraint in file shape, so a rewritten constraint goes back
through `constraintRecord` and `modelConstraint`, as `mapRoleIds`
already does (`:1464-1466`). Today a constraint that needs no rewriting
is returned as the same object, and that must stay: sending every
constraint through the round trip, a leniently loaded or unnamed one
included, could change the document. The oracle law judges it, and the
45 lines counted for this deletion are a prediction until it has.

### 5. Delete the oracle

Delete `tests/diff/oracle/` and `mergeOracle.law.test.ts`, correct
`packages/core/CLAUDE.md:43`, set this spec's Status. The last
`src/diff/` line reading is reported here.

## API and migration impact

- No public export changes name, signature or module. `src/diff/index.ts`
  is untouched.
- Three internal modules are added under `src/diff/`. None is exported
  from the package.
- No downstream package changes. No surface changes; the capability
  matrix is untouched.

## Open decisions (for review)

- **Stages (this spec), or a spike of B first?** The honest size of
  the staged design is about level. My count from the code is 150 code
  lines removed (45 for the second constraint traversal, 70 for the
  decision chains and slicing blocks, 35 for id resolution and the
  three add-or-carry copies) against 125 added for `decide`, `idSpace`
  and the stage signatures. An earlier estimate of half did not survive
  reading the file: the refusals, the role and population rewriting and
  the subtype-fact rules are the domain, and they stay. What the stages
  buy is structural: the translation is a value with its own tests, the
  stage order is stated where it matters, and barwise-7ny and the
  fact-type throw each become a change to one stage. B is where a real
  reduction could come from, and it needs new model API. Recommend:
  land workstreams 1 and 2 regardless, since they close a measured hole
  and serve either design; then one bounded spike of B against the
  oracle, kept in the test tree, before choosing. The default if the
  owner wants no spike is workstreams 3 to 5 as written.
- **Should a merge pair through prior ids at all?** It is what most of
  the object-type and fact-type translation now serves, and it carries
  the one refusal built on heuristics. Without it, two revisions of an
  older file that renamed an element would merge as a removal and an
  addition, which is what two 4.0 files already do, since 4.0 makes a
  rename an operation (`barwise rename`). The pairing itself is the
  diff's; what the merge would lose is `refuseCoincidentIds` (59 code
  lines) and barwise-wcg.3qv with it, and `idSpace` would no longer
  need to translate an id-paired rename. The `fromBasePrior` seeding
  stays either way: it resolves a fragment's references and pairs
  nothing.
  Against it: a person merging two revisions of a 3.x file today gets
  the rename, and would lose it. This is a behaviour change and the
  `iri-identity` owner's call, not this spec's. Recommend deciding it
  before workstream 3, because it sets how much `idSpace` has to hold;
  the default is to keep prior-id pairing and build `idSpace` for it.
- **Oracle in the test tree, or no oracle?** It adds 1,600 frozen lines
  under `tests/` for the life of workstreams 2 to 4. Recommend the
  oracle, for the reason given in Alternatives; the default if the
  owner prefers less is to rely on workstream 1's laws and re-run the
  six probes on each step.
- **Should the fact-type throw be made consistent while the code is
  open?** It is the one dependent the merge refuses where it drops or
  carries the others. Recommend no: this spec's claim is that nothing
  changes, and a behaviour change inside it would make the oracle law
  fail on purpose. File it against the stage once workstream 4 lands.
- **Should the line count be a requirement?** The owner asked that a
  restructure not end as an addition, and the repository's rule is to
  look at a line count and not gate on it. Scope therefore asks each
  pull request to report `src/diff/`'s code lines before and after, and
  requires nothing of the number. Recommend leaving it there: a person
  reads it, and the tripwire below asks for a stop if it rises. The
  alternative is a hard requirement of no growth, which a restructure
  can meet by moving code out of the directory.

## Risks and testing

- **The oracle agrees because the generator is tame.** Workstream 1's
  coverage block and workstream 2's uncovered-line list are the two
  instruments against this. After each of workstreams 3 and 4 the six
  probes are re-run against the live file where their anchors still
  exist.
- **A stage boundary changes insertion order.** The identity law reads
  the hash of the serialized document, and the oracle compares
  documents, so a reordering fails both.
- **Refusal messages.** The oracle compares thrown messages exactly, so
  moving a refusal cannot reword it unnoticed.
- **Per-PR checks.** `npm run build` then `npx vitest run` in
  `packages/core`, then `npm run ci:local`. `tests/diff` and
  `tests/laws` are the suites that matter; the downstream packages
  compile against an unchanged API.

Tripwires:

- If `idSpace` needs the merged model to answer a question other than
  the two predicted in workstream 3, the translation is not a value and
  the design needs another look before more code is written.
- If the oracle law finds a counterexample that is the live code being
  right and the frozen code wrong, stop: that is a behaviour change,
  and it belongs in an issue, not in this spec's diff.
- If `src/diff/` ends workstream 4 with more code lines than it held
  before workstream 3, say so in the pull request and ask before
  workstream 5.
- If a fix to merge behaviour is needed while the oracle exists and
  cannot be made in both copies in one commit, finish or abandon the
  restructure first; do not edit the oracle alone.

## Non-goals

- No change to what any merge returns or refuses.
- No change to the diff, to `MergeInput`, or to any caller.
- No new capability on any surface.
- No shared walker with rename or replay.
- No mutation-score ratchet over `src/diff`; `mutation-ratchet.spec.md`
  owns that.
