# Model invariants: what the store refuses, what validation reports, and what operations promise

Status: Draft -- no workstream implemented; decisions resolved by the owner
2026-10-23 (decision 1 revised the same day after review)

Created: 2026-10-23
Last-updated: 2026-10-23
Tracking: barwise-mtl (this spec); barwise-b2s (duplicate constraint ids,
workstream 1); barwise-ue5 (merge drops a kept element, workstream 2);
barwise-1l0 (a duplicate id replaces an element, workstream 3); barwise-973
(the builder, which workstream 4 amends)

## Principle

A defect the model's storage cannot represent must be refused where it is
stored, because no rule can report it afterwards. `OrmModel` keeps five
element kinds in maps keyed by id and checks names, not ids, so a second
element with an existing id replaces the first, silently. Measured on main
`1a32f9c7`: a 3.0 file listing two object types with id `x` loads to one
object type, and validation reports nothing; the first is gone before any
rule runs. A defect the storage _can_ represent, such as a dangling role
reference, is the opposite case: barwise loads it on purpose so the editor
can show it, and it belongs to validation.

The same question, asked of an operation, gives the second half: **a shared
id means the same element.** Diff matches object types and fact types by
name, so a rename that keeps its id reads as one element removed and
another added, and the merge that follows can lose the one the user kept.
Pairing by id first, as constraints already are (barwise-18n), makes a
rename one modification, and the collision never forms.

That split is design by contract, applied to a model that must be able to
hold mistakes. Of its three parts, barwise already has two in its own
idiom, and this spec adds what is missing rather than a second mechanism:

| Contract part                              | Barwise today                                                                                                                                    | This spec                                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Precondition (what a caller supplies)      | JSON Schema on load; 33 refusals in `OrmModel`; Effect Schema decoders planned (`effect-adoption.spec.md`), whose errors appear in the type      | unchanged                                                                                                             |
| Invariant (always true of a model)         | Decided 2026-09-06: "can the value exist with this defect" picks build refusals over validation rules (`core-branching-load.spec.md`, Decisions) | applies that test to element ids, which it missed (workstreams 1, 3, 4)                                               |
| Postcondition (what an operation promises) | Property laws over generated models (`tests/laws/`)                                                                                              | diff pairs a shared id; a merge law over renamed pairs and partial acceptance, the case that lost data (workstream 2) |

## Should barwise adopt a design-by-contract library or runtime assertions? (resolved: no)

Each part already has a home that does more than an assertion would. A
precondition stated as an Effect Schema is checked by the decoder and named
in the function's type; a `requires` clause beside it would state the rule
twice. A postcondition asserted at run time is checked only on the inputs a
user happens to supply, and costs every call in core; the same statement as
a property law is checked on hundreds of generated models in CI and costs
nothing at run time. And a blanket invariant check after every change cannot
work here at all: barwise loads a model with a dangling reference so the
editor can mark it, so a check that threw on every broken rule would stop a
user opening the file they need to fix.

What design by contract does add is the question it makes you ask of each
rule: who is responsible, the caller, the store, or the operation? Asked of
element ids, that question found both defects below.

## Which rules does the store refuse? (resolved: exactly those it cannot represent)

`core-branching-load.spec.md` already fixed the test: a rule is a refusal
when the value cannot exist with the defect, and a validation rule
otherwise. It applied the test to 12 reference and name rules. It did not
list element ids, and today's code shows why that is the sharpest case:

| Defect                                                                                     | Can the model hold it?                                     | Today                                                                                                       | Owner                                                                             |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Two object types (or fact types, subtype facts, objectifications, populations) with one id | No: an id-keyed map keeps the last one                     | Silently replaced, from a file and from code; no diagnostic                                                 | The store refuses it (workstream 3)                                               |
| Two roles with one id                                                                      | Yes: roles are an array per fact type                      | `structural/duplicate-role-id`, reported from `graphOf` (`graph.ts:205-216`, `referenceDiagnostics.ts:114`) | Validation, unchanged                                                             |
| Two constraints with one id                                                                | Yes: constraints are arrays                                | Refused by the 3.0 loader only; a 2.0 file and code pass                                                    | Validation reports it (workstream 1); the builder refuses it later (workstream 4) |
| Two subtype facts over one subtype/supertype pair, different ids                           | Yes: the ids differ                                        | `addSubtypeFact` refuses it, but only outside a lenient load; no rule                                       | Validation reports it (workstream 1)                                              |
| Two object types with one name                                                             | No, at `addObjectType`, which refuses; yes, after a rename | `structural/duplicate-object-type-name`                                                                     | Unchanged                                                                         |
| A role naming an absent object type                                                        | Yes, under a lenient load                                  | `structural/dangling-role-reference`                                                                        | Unchanged until the builder (barwise-973)                                         |

The rule this table states, and which workstream 3 writes into
`core/CLAUDE.md`: **a defect the model cannot hold is refused when it is
stored; a defect it can hold is reported by validation.** A lenient load
skips the checks for what the model can hold, which today include the
subtype-pair check, so each of those needs a rule that reports it; it never
skips an id the store already holds, because that cannot be reported later.

## When two models share an id, are they the same element? (resolved: yes)

The first draft of this spec answered no, by omission: it kept the diff's
name matching and made merge keep both elements, the added one under a new
id. Review found four ways that design still cross-wired references
(rejected additions, constraints across fact types, re-merging a saved
derived id, the entity's preferred identifier), and the owner named the
deeper defect: keeping both puts one concept in the model twice. Customer
renamed to Client under one id, kept as two entity types, splits its facts
between the copies, and a uniqueness or mandatory rule stated once holds on
one copy only. Each copy is consistent alone, so validation cannot see it.

A shared id is the strongest evidence of identity the format carries, since
3.0 makes every id required and stable. The diff's name matching predates
that: its stated reason is that "re-extraction mints fresh ids and only
names survive" (`ModelDiff.ts:289-291`), which still holds for an LLM
draft and is kept as the fallback. The owner decided constraints the same
way on 2026-10-18 (barwise-18n). Accepting a renamed object type then needs
no merge mechanism at all: an accepted modification already takes the
incoming content under the existing id (`ModelMerge.ts:134-145`).

## Scope

In scope:

- When a model holds two constraints with one id, validation shall report
  it, naming the id and the fact types of both (closes barwise-b2s for 2.0
  files and models built in code).
- When a model holds two subtype facts over one subtype/supertype pair,
  validation shall report it, naming both ids.
- When both models hold an object type, or a fact type, with one id,
  `diffModels` shall pair them whatever their names, and report a changed
  name as a `name` change on that one delta, labelled with the existing
  model's name. Elements whose id only one side holds pair by name, as
  today.
- When an element of any kind refers to a paired object type or fact type
  (a role's player, a subtype fact's ends, an objectification, a
  population's fact type, a constraint's other fact type, an entity's
  preferred identifier), `diffModels` shall compare that reference by the
  pair, not by the name, so a rename is reported once, on the renamed
  element, and nowhere else.
- When the caller says the two models' ids are unrelated
  (`matching: "content"`), `diffModels` shall pair object types, fact types
  and constraints by name and content only, as `constraintMatching:
  "content"` does for constraints today.
- When a merge would add an object type or fact type whose name or id the
  merged model already holds, it shall refuse before building anything,
  with a `merge-error` diagnostic naming both elements, instead of
  evicting one or failing on `addObjectType`'s bare name error.
- When a merge would add an objectification whose id the merged model
  already holds, it shall give it a fresh id, as it already does for subtype
  facts and populations.
- When the merge laws run, they shall include pairs in which the incoming
  model renames object types and fact types under kept ids, and any subset
  of deltas accepted.
- When an object type, fact type, subtype fact, objectified fact type or
  population is added with an id an element of the same kind already holds,
  `OrmModel` shall refuse it with `DuplicateIdError`, naming the id and both
  elements, whether or not `skipPlayerValidation` is set.
- When a file, 2.0 or 3.0, lenient or not, states two elements of one of
  those kinds with one id, `deserialize` shall throw `DeserializationError`,
  naming the id and both elements.

Out of scope:

- Moving the referential rules into the builder. That is barwise-973;
  workstream 4 only amends its list.
- Whether an object type and a fact type may share an id. Different kinds
  live in different maps, so the store can hold it, and the owner decided it
  stays allowed (decision 2).
- Id-first matching for subtype facts, objectifications and populations.
  They have no name, and diff identifies them by what they relate
  (`ModelDiff.ts:313-314`, `:378-381`, `:467-468`). Once what they relate
  is compared by pair (in scope above), a rename cannot split them; the
  merge's fresh id covers a collision between two of them.
- The fresh ids merge mints for those three kinds come from the installed
  generator, so such a merge is not reproducible. Filed separately
  (barwise-yg5), since no lost element depends on it.
- Design-by-contract tooling of any kind (resolved above).

## Inventory

Verified on main `09adf160`, 2026-10-23.

| Area                                                                                               | Current state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Verdict                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/src/model/OrmModel.ts`                                                                       | Five `Map<string, ...>` stores (:63-67); `addObjectType` and `addFactType` check the name (:132, :450), never the id; `addSubtypeFact` checks the pair inside `if (!skipPlayerValidation)` (:542-578); `addPopulation` checks only its fact type; every refusal is a plain `Error`                                                                                                                                                                                                                                                                                                            | each `add*` refuses an id already held, as `DuplicateIdError` (workstream 3)                                                                                                                                                  |
| `core/src/model/Population.ts`, `SubtypeFact.ts`, `ObjectifiedFactType.ts`                         | None of the three has a name                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | the refusal names them by what they relate (Target architecture)                                                                                                                                                              |
| `core/src/serialization/OrmYamlSerializer.ts`                                                      | `fromDocument` refuses two constraints sharing an id (`claim`, :268-278); `readDocument20` does not; both call `add*` unwrapped                                                                                                                                                                                                                                                                                                                                                                                                                                                               | both readers turn a `DuplicateIdError` into `DeserializationError` (workstream 3)                                                                                                                                             |
| `core/src/validation/rules/structural.ts`                                                          | `structuralRules(model, graph)` (:37), skipped when `graphOf` cannot resolve a reference, and `structuralWellFormedness(model)` (:51), which always runs                                                                                                                                                                                                                                                                                                                                                                                                                                      | both new rules go in `structuralWellFormedness`: neither reads a reference (workstream 1)                                                                                                                                     |
| `core/src/diff/ModelDiff.ts`                                                                       | Object types and fact types keyed by name (:90-91, :137-138); subtype facts, objectifications and populations by what they relate; constraints id-first through `constraintMatching` (:40, :85)                                                                                                                                                                                                                                                                                                                                                                                               | object types and fact types id-first; one `matching` option for all three (workstream 2)                                                                                                                                      |
| `core/src/diff/elementDiff.ts`                                                                     | `diffObjectType` and `diffFactType` compare no name, since names matched; the comment at :436 says "one renamed is a different one". Every comparison of a reference goes through `playerName` (:144) and `factTypeName` (:155), which return the name: `diffFactType`'s `rolePlayer` (:247), `withSubtypeFacts` (:484-485), `preferredIdentifierLabel` (:883), `roleKeys`, and in `ModelDiff.ts` the subtype fact, objectification and population keys (:313-314, :378-381, :467-468); 13 calls of the two across `ModelDiff.ts`, `elementDiff.ts` and `synonyms.ts`, less their definitions | a `name` change; the comment goes; every comparing call takes the pair key, and the two functions keep only labelling (workstream 2)                                                                                          |
| `core/src/diff/changeDescription.ts`, `breakingLevel.ts`                                           | No `name` change kind. The header: "Safe changes alter documentation or naming, not the shape anything binds to"; `roleName` and `readings` are `safe`                                                                                                                                                                                                                                                                                                                                                                                                                                        | `name` added, rated `safe`, as `roleName` is: both rename generated columns or tables, and the table rates naming, not its downstream spelling                                                                                |
| `core/src/diff/deltas.ts`                                                                          | `SynonymCandidate`: a removed and an added element that may be a rename, "never auto-linked". `synonyms.ts:144-148` matches a fact type's players by name or through `otSynonymPairs`, built from removed-plus-added object type pairs only                                                                                                                                                                                                                                                                                                                                                   | player correspondence compares pair keys, so a player renamed under a kept id still corresponds; still flags renames between models whose ids differ                                                                          |
| `core/src/diff/ModelMerge.ts`                                                                      | Subtype facts and populations get `id: undefined` when the merged model holds theirs (:362-369, :471, :480), so `OrmModel` mints one; objectifications keep their id and evict; an accepted modification keeps the existing id (:134-145); a throw nulls the merge (`mergeAndValidate`)                                                                                                                                                                                                                                                                                                       | objectifications follow the same pattern; a name or id clash for an object type or fact type is refused through `mergeAndValidate`'s `merge-error` diagnostic (:999-1009), the one channel every surface reads (workstream 2) |
| `core/src/diff/ModelMerge.ts` `addableSubtypeFact` (:557-583), `addableObjectification` (:649-662) | Mirror `OrmModel`'s guards so a throw does not null the whole merge; guarded by a comment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | replaced by predicates `OrmModel` exports and its own `add*` calls (workstream 3)                                                                                                                                             |
| `llm/src/diffOptions.ts`                                                                           | `UNRELATED_IDS_DIFF = { constraintMatching: "content" }` (:11), the one caller of the option outside core                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `{ matching: "content" }`                                                                                                                                                                                                     |
| `core/tests/laws/merge.law.test.ts`                                                                | Laws for "accept nothing" (:31) and "accept everything" (:102)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | gains partial acceptance (workstream 2)                                                                                                                                                                                       |
| `core/tests/arbitraries/model.ts`                                                                  | Object type and fact type ids and names come from one index (`ot${i}`/`T${i}`, :461-462; `ft${j}`/`F${j}`, :524-525), so two draws never rename an element under a kept id                                                                                                                                                                                                                                                                                                                                                                                                                    | gains a renamed-pair arbitrary (workstream 2)                                                                                                                                                                                 |
| Importers in `code-analysis`, `dbt`, `formats`, `llm`                                              | 14 source files call `addObjectType` or `addFactType`, several with ids they compute themselves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | each could now throw; measured in workstream 3 (provisional: not yet grounded per importer)                                                                                                                                   |
| `docs/specs/core-branching-load.spec.md`                                                           | WS1's `build()` takes `structural/dangling-*`, `structural/duplicate-*`, the `*-not-entity` rules and the subtype cycle                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | amended to name element-id and constraint-id uniqueness (workstream 4)                                                                                                                                                        |

The merge law suite is a shadow of the property it was meant to check. It
covers the two ends of acceptance, nothing and everything, and its
generator never renames an object type or fact type under a kept id, so the
rename case that loses data is never drawn.

## Target architecture

```ts
// diff: one question, asked once -- are the two models' ids related?
interface DiffOptions {
  /** "id-first" (default): a shared id pairs, whatever the name; the rest
   *  pair by name (object types, fact types) or content (constraints).
   *  "content": ids say nothing (independent LLM samples); never pair by id. */
  readonly matching?: "id-first" | "content";
}
// ChangeDescription gains { change: "name"; from: string; to: string },
// on object type and fact type deltas only, rated "safe". The delta's own
// `name` is the existing model's spelling, so a reviewer reads which
// element is being renamed, and the change says to what.

// Identity is resolved once, before any element is compared.
interface DiffIdentity {
  /** The same string for both sides of a pair, by id or by name:
   *  `pair:<existing id>`; an unpaired element's is `<side>:<id>`. */
  objectTypeKey(side: "existing" | "incoming", id: string): string;
  factTypeKey(side: "existing" | "incoming", id: string): string;
}
// Every comparison of a reference reads these keys; playerName and
// factTypeName stay for labels only. Two places used to answer "is this the
// same element" -- the top-level pairing and every nested name -- and now
// one does.

// merge: under id-first an added object type or fact type cannot share an
// id with an existing one (it would have paired), so what is left is a
// NAME clash -- a rename accepted onto a name another element keeps -- and
// content-mode ids. Both are found before anything is built and refused as
// the merge-error diagnostic mergeAndValidate already returns, naming both
// elements. No error class: every caller reads that diagnostic, and a
// class's fields would stop at its catch.
// Objectifications: id: undefined when held, as subtype facts and
// populations already are; nothing references an objectification's id.

// OrmModel: one check before each of the five id-keyed stores, whatever
// skipPlayerValidation says.
export class DuplicateIdError extends Error {
  readonly id: string;
  readonly kind:
    | "object type"
    | "fact type"
    | "subtype fact"
    | "objectification"
    | "population";
}
// Elements are named by name where they have one, otherwise by what they
// relate: "subtype fact Manager -> Employee", "objectification of
// Enrollment", "population of fact type Person has Name".
// canAddSubtypeFact / canAddObjectifiedFactType: the guards, exported, and
// called by add* itself, so merge's pre-checks read the same predicate.

// Both readers: catch DuplicateIdError around add*, rethrow as
// DeserializationError naming the id. Nothing else they call is wrapped.

// structuralWellFormedness: representable, so reported, not refused.
//   structural/duplicate-constraint-id, over model.everyConstraint().
//   structural/duplicate-subtype-fact, over model.subtypeFacts.
```

## Alternatives considered

- **Keep name matching, and have merge keep both elements** under a derived
  id. The first two drafts of this spec. Rejected by the owner after
  review: it puts one concept in the model twice, and four cases still
  cross-wired references (the section above).
- **Keep name matching, and refuse the merge on any id collision.** Small,
  and it closes the loss, but it refuses the common case (a rename under a
  kept id) that id-first pairing handles as an ordinary modification.
- **A validation rule for duplicate element ids.** It cannot see the
  defect: by the time a rule runs, the map holds one element.
- **Make the stores arrays, so the defect is representable and reportable.**
  It turns every id lookup linear or adds an index that must be kept in
  step, for a state no correct model has. The builder (barwise-973) will
  hold arrays and refuse at `build()`, which is the same answer one layer
  later.
- **The loader checks element ids itself, as `claim` does for constraints.**
  It states the rule in two places, the store and the loader. One refusal
  in the store, converted at the loader, keeps one owner.
- **A model-wide `modelInvariants(model)` check run after every operation.**
  It cannot see a lost element, which leaves no trace in the output; that
  is a relation between input and output, which a law states.

## Workstreams (each independently shippable)

The order is forced: workstream 3 makes the store throw on a held id, and
until workstream 2 lands, a merge that hits the rename case would then fail
instead of finishing. The tracker records it: barwise-1l0 depends on
barwise-ue5.

### 1. Validation reports what the store can hold (barwise-b2s)

`structural/duplicate-constraint-id` over `everyConstraint`, an error naming
the id and the fact types each constraint applies to, and
`structural/duplicate-subtype-fact`, an error naming both ids and the pair,
both in `structuralWellFormedness`. The 3.0 loader's `claim` stays: a 3.0
file is refused at load, a 2.0 file and a model built in code are reported.

Acceptance: tests plant each duplicate in a 2.0 file, in a lenient load with
a dangling role beside it, and in code, and see one diagnostic each; both
ids are registered in `ruleId.ts`. Independent of the other workstreams.

### 2. Diff pairs a shared id; merge refuses what is left (barwise-ue5)

`DiffIdentity`, computed first; id-first pairing for object types and fact
types with the name fallback; every comparing call site moved to its keys;
the `name` change; the one `matching` option (and `UNRELATED_IDS_DIFF`
moved to it); the clash refusal; the objectification fresh id; and the
renamed-pair arbitrary: the incoming model is the existing one with some
object types and fact types renamed under the same ids, populations,
subtype facts, objectifications and preferred identifiers included.

Acceptance:

- The probe from barwise-ue5, as a test: existing `x`/A, incoming `x`/B.
  `x` plays a role in two fact types, is an entity with a preferred
  identifier, and is the supertype of a subtype fact. `diffModels`
  reports exactly one non-unchanged delta: the object type, with one
  `name` change. Accepting it yields B under `x`; rejecting it yields A
  under `x`; every role that played `x` plays the one element either way.
- The same for a fact type renamed under a kept id with the same role and
  constraint ids, a population, an objectification and a constraint across
  it: one non-unchanged delta, and the merged model holds one fact type,
  one set of roles, one population and one set of constraints whichever
  way the rename is decided.
- The same pair with the fact type under a fresh id in the incoming model
  (a re-extraction): it is still a synonym candidate, as on main.
- A swap (A and B exchange names under kept ids) with one rename accepted
  and the other rejected: the merge returns no model and one `merge-error`
  diagnostic naming both.
- Two models whose ids are unrelated but coincide (positional `ot0`), under
  `matching: "content"`: pairing by name, as today.
- A law over renamed pairs and a drawn subset of deltas: the merge either
  refuses with `merge-error` or returns a model in which every existing
  element whose removal was not accepted is present, every accepted
  addition is present, no element was replaced, and no two elements of one
  kind state the same content (the duplicated population a nested name
  comparison produces). It fails on main first; main is the mutant.

### 3. The store refuses an id it already holds (barwise-1l0)

`DuplicateIdError` and the check before each of the five stores, the
exported guard predicates that merge's `addable*` pre-checks call instead of
restating, both readers converting the error, and the `core/CLAUDE.md` rule
stated above.

Acceptance:

- When each of the five `add*` methods receives an id its store holds, it
  shall throw `DuplicateIdError`, naming the id and both elements; one test
  per kind, each kind named as in Target architecture.
- When a 2.0 file and a 3.0 file each state two object types with one id,
  `deserialize` shall throw `DeserializationError` naming the id, with and
  without `lenient`.
- When the full monorepo suite and the tracked corpus run, they shall pass.
  An importer whose test now throws was already losing an element: it is
  fixed in its own PR, with the input that triggers it, and this workstream
  lands after that PR. A duplicate id is never caught and dropped to get
  green.

### 4. The builder's list names the id rules (provisional: not yet grounded)

Amend `core-branching-load.spec.md` WS1: `build()` refuses duplicate
element ids and duplicate constraint ids, and the two rules workstream 1
adds move into the builder with the other duplicate rules. A spec edit
only; it lands whenever barwise-973 is next grounded.

## API and migration impact

- New exports: `DuplicateIdError` and the two guard
  predicates, from core.
- `DiffOptions.constraintMatching` becomes `matching` and covers object
  types and fact types too. One caller outside core (`llm/src/diffOptions.ts`).
- Diff output changes for a rename under a kept id: one `modified` delta
  with a `name` change, where it was a `removed` and an `added`. The CLI,
  MCP and VS Code diff and merge surfaces print deltas as they come, so each
  shows the rename as one change; any test that pins the old pair changes
  with it, in the same PR.
- `OrmModel.add*` throws in a case it accepted. Any caller that relied on
  replacement by id was already losing data; workstream 3 measures whether
  one exists among the importers.
- Two new validation rule ids, both errors.
- No surface gains or loses a capability; the capability matrix is
  unchanged.

## Decisions (resolved by the owner, 2026-10-23)

The options are kept so a later workstream does not reopen them without the
trade-off in view.

1. **Merge on a collision.** First decided as (a) keep both, the added
   element under a derived id; revised the same day, after review, to (c).
   (a) puts one concept in the model twice and still cross-wired references
   in four cases. (b) Refuse the merge on any id collision: small, but it
   refuses the ordinary rename. (c) Chosen: a shared id is the same
   element, so diff pairs object types and fact types by id first and a
   rename is one modification; merge refuses only the name clash that is
   left.
2. **May two elements of different kinds share an id?** (a) Chosen: leave
   it allowed and out of this spec. The stores hold it, every `OrmModel`
   lookup is per kind (`getObjectType`, `getFactType`, ...), and NORMA ids
   are already a separate branded space (`model-graph-and-id-spaces.spec.md`).
   (b) Make ids model-wide, as constraint ids are, with a validation rule.
   Worth doing only when a reader looks an id up without knowing its kind.
3. **Where the rule in Principle is written down.** (a) Chosen:
   `core/CLAUDE.md`, beside the placement and preferred-identifier rules,
   since it governs how core stores elements. (b) The root `CLAUDE.md`,
   which would make it a project-wide rule; no other package stores model
   elements.

## Risks and testing

- **Accidental shared ids pair unrelated elements.** Two models built apart
  can share positional ids (`ot0`, promptlab's deterministic ids). Every
  comparison of independent LLM samples already passes the content mode
  through `UNRELATED_IDS_DIFF`, which now covers object types and fact
  types; `barwise diff` and MCP `diff_models` cannot yet ask for it, which
  is barwise-uy7, raised in priority by this spec.
- **Transcript imports keep pairing by name.** `barwise import transcript`
  and the VS Code import diff the base model against an LLM draft with the
  default mode. The draft's object types are built without an id
  (`llm/src/parse/objectTypes.ts:50`), so each gets a fresh UUID that no
  base element holds, and every one falls through to the name fallback.
  `barwise history`, which diffs one file across commits, is the surface
  that gains: a rename there becomes one change.
- **An importer depends on replacement.** Workstream 3 runs the whole
  monorepo suite and lands only after any importer it exposes is fixed.
- **A law that cannot fail.** Workstream 2's law is run against main
  first; the existing generator could not have failed it, which is why the
  renamed-pair arbitrary is part of the workstream.

## Non-goals

- No design-by-contract library, decorator or `assert` calls in core.
- No change to lenient loading of dangling references; the editor still
  opens a broken file.
- No new id format, and no branded ids beyond what
  `model-graph-and-id-spaces.spec.md` decided.
