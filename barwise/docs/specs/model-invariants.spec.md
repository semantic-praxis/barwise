# Model invariants: what the store refuses, what validation reports, and what operations promise

Status: Draft -- no workstream implemented

Created: 2026-10-23
Last-updated: 2026-10-23
Tracking: barwise-mtl (this spec); barwise-1l0 (a duplicate id replaces an
element, workstream 1); barwise-b2s (duplicate constraint ids, workstream 2);
barwise-ue5 (merge drops a kept element, workstream 3); barwise-973 (the
builder, which workstream 4 amends)

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

That split is design by contract, applied to a model that must be able to
hold mistakes. Of its three parts, barwise already has two in its own
idiom, and this spec adds what is missing rather than a second mechanism:

| Contract part                              | Barwise today                                                                                                                                    | This spec                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Precondition (what a caller supplies)      | JSON Schema on load; 33 refusals in `OrmModel`; Effect Schema decoders planned (`effect-adoption.spec.md`), whose errors appear in the type      | unchanged                                                                  |
| Invariant (always true of a model)         | Decided 2026-09-06: "can the value exist with this defect" picks build refusals over validation rules (`core-branching-load.spec.md`, Decisions) | applies that test to element ids, which it missed (workstreams 1, 2, 4)    |
| Postcondition (what an operation promises) | Property laws over generated models (`tests/laws/`)                                                                                              | a merge law for partial acceptance, the case that lost data (workstream 3) |

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

| Defect                                                                                     | Can the model hold it?                                     | Today                                                       | Owner                                                                             |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Two object types (or fact types, subtype facts, objectifications, populations) with one id | No: an id-keyed map keeps the last one                     | Silently replaced, from a file and from code; no diagnostic | The store refuses it (workstream 1)                                               |
| Two roles with one id                                                                      | Yes: roles are an array per fact type                      | `structural/duplicate-role-id`                              | Validation, unchanged                                                             |
| Two constraints with one id                                                                | Yes: constraints are arrays                                | Refused by the 3.0 loader only; a 2.0 file and code pass    | Validation reports it (workstream 2); the builder refuses it later (workstream 4) |
| Two object types with one name                                                             | No, at `addObjectType`, which refuses; yes, after a rename | `structural/duplicate-object-type-name`                     | Unchanged                                                                         |
| A role naming an absent object type                                                        | Yes, under a lenient load                                  | `structural/dangling-role-reference`                        | Unchanged until the builder (barwise-973)                                         |

The rule this table states, and which workstream 1 writes into
`core/CLAUDE.md`: **a defect the model cannot hold is refused when it is
stored; a defect it can hold is reported by validation.** A lenient load
skips reference checks, because a dangling reference can be held and shown;
it does not skip identity, because a duplicate id cannot.

## Scope

In scope:

- When an object type, fact type, subtype fact, objectified fact type or
  population is added with an id an element of the same kind already holds,
  `OrmModel` shall refuse it, naming the id and both elements.
- When a file, 2.0 or 3.0, lenient or not, states two elements of one of
  those kinds with one id, the loader shall refuse it, naming the id and
  both elements.
- When a model holds two constraints with one id, validation shall report
  it, naming the id and the fact types of both (closes barwise-b2s for 2.0
  files and models built in code).
- When a merge accepts an added element whose id an element kept from the
  existing model holds, the merged model shall hold both, the added one
  under an id derived from its inputs, with references to it translated;
  the same inputs shall give the same merged model.
- When the merge laws run, they shall include partial acceptance: any
  subset of deltas accepted, not only none or all.

Out of scope:

- Moving the referential rules into the builder. That is barwise-973;
  workstream 4 only amends its list.
- Whether an object type and a fact type may share an id. Different kinds
  live in different maps, so the store can hold it; whether it should is
  Open decision 2.
- Design-by-contract tooling of any kind (resolved above).

## Inventory

Verified on main `1a32f9c7`, 2026-10-23.

| Area                                          | Current state                                                                                                                                                                                                       | Verdict                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `core/src/model/OrmModel.ts`                  | Five `Map<string, ...>` stores (:63-67); `addObjectType` and `addFactType` check the name (:132, :450), never the id; `addSubtypeFact` checks the subtype/supertype pair; `addPopulation` checks only its fact type | each `add*` refuses an id already held (workstream 1)                                    |
| `core/src/serialization/OrmYamlSerializer.ts` | `fromDocument` refuses two constraints sharing an id (`claim`, :268-278); `readDocument20` does not; neither checks element ids                                                                                     | element ids refused by workstream 1 through `OrmModel`; the constraint check stays       |
| `core/src/validation/rules/structural.ts`     | `duplicate-role-id`, `duplicate-object-type-name`, `duplicate-fact-type-name`, two objectification duplicates; no duplicate constraint id                                                                           | gains `structural/duplicate-constraint-id` (workstream 2)                                |
| `core/src/diff/ModelMerge.ts`                 | `incomingIdToMergedId` (:82) translates ids for elements matched by name; an added element keeps its incoming id, so it replaces a kept element that holds the same id                                              | an added element whose id is taken gets a fresh one, through the same map (workstream 3) |
| `core/tests/laws/merge.law.test.ts`           | Laws for "accept nothing" (:31) and "accept everything" (:102)                                                                                                                                                      | gains partial acceptance (workstream 3)                                                  |
| `core/tests/arbitraries/model.ts`             | Ids are positional (`ot${i}`, `ft${j}`, :461, :524), so two independent draws share ids under different names                                                                                                       | unchanged: it already produces the collision, and no law looked at it                    |
| `docs/specs/core-branching-load.spec.md`      | WS1's `build()` takes `structural/dangling-*`, `structural/duplicate-*`, the `*-not-entity` rules and the subtype cycle                                                                                             | amended to name element-id and constraint-id uniqueness (workstream 4)                   |

The merge law suite is a shadow of the property it was meant to check. It
covers the two ends of acceptance, nothing and everything. In both, no kept
element meets an added one, so the collision the generator produces on
every draw is never exercised.

## Target architecture

```ts
// OrmModel: one private check, used by the five id-keyed add* methods.
// Runs whatever skipPlayerValidation says: lenience is about references.
private claimId<T extends { readonly id: string; readonly name?: string }>(
  store: ReadonlyMap<string, T>,
  kind: string,
  incoming: { readonly id: string; readonly name?: string },
): void; // throws: `${kind} id "x" is already held by "A"; "B" cannot reuse it.`

// structural.ts: representable, so reported, not refused.
//   structural/duplicate-constraint-id, over model.everyConstraint().

// ModelMerge: an accepted addition never displaces a kept element.
//   if merged already holds the incoming id:
//     derivedId("merge-collision", [kind, incomingId, name]), record it in
//     incomingIdToMergedId, and let the existing translation rewrite references.
//   Derived, not minted: merge mints no id today, so it is a pure function of
//   its inputs, and a random id would end that.
```

The loader needs no change of its own for workstream 1: every reader adds
elements through `OrmModel`, so the refusal reaches 2.0, 3.0 and lenient
loads, and arrives as the `DeserializationError` the editor already shows
for a malformed file.

## Alternatives considered

- **A validation rule for duplicate element ids.** It cannot see the
  defect: by the time a rule runs, the map holds one element. Detecting it
  would mean the store keeping a list of collisions, which is a refusal
  postponed.
- **Make the stores arrays, so the defect is representable and reportable.**
  It turns every id lookup linear or adds an index that must be kept in
  step, for a state no correct model has. The builder (barwise-973) will
  hold arrays and refuse at `build()`, which is the same answer one layer
  later.
- **A model-wide `modelInvariants(model)` check run after every operation.**
  Proposed in conversation before grounding. It cannot see what workstreams
  1 and 3 fix, because a lost element leaves no trace in the output; the
  merge defect is a relation between input and output, which a law states
  and an invariant over the output cannot. And the representable rules
  already have one home, the validation engine.

## Workstreams (each independently shippable)

### 1. The store refuses an id it already holds (barwise-1l0)

`claimId` in `OrmModel`, called by `addObjectType`, `addFactType`,
`addSubtypeFact`, `addObjectifiedFactType` and `addPopulation`, regardless
of `skipPlayerValidation`. The `core/CLAUDE.md` rule stated above.

Acceptance:

- When each of the five `add*` methods receives an id its store holds, it
  shall throw, naming the id and both elements; one test per kind.
- When a 2.0 file and a 3.0 file each state two object types with one id,
  `deserialize` shall throw `DeserializationError` naming the id, with and
  without `lenient`.
- When the tracked corpus is loaded before and after, every model that
  loaded before shall load after (a duplicate id there would be a model
  that already lost an element; the measurement says whether any exists).

Smallest radius: one file, plus tests. It is first because it closes a
silent loss with no design choice left in it.

### 2. Validation reports two constraints with one id (barwise-b2s)

`structural/duplicate-constraint-id` over `everyConstraint`, an error naming
the id and the fact types each constraint applies to. The 3.0 loader's
`claim` stays: a 3.0 file is refused at load, a 2.0 file and a model built
in code are reported.

Acceptance: a test plants the duplicate in a 2.0 file and in code, and
sees one diagnostic naming the id; the rule id is registered in `ruleId.ts`.

### 3. Merge keeps both elements, and the laws check partial acceptance (barwise-ue5)

In `mergeModels`, an accepted addition whose id the merged model already
holds is given an id derived from its kind, its incoming id and its name
(`serialization/derivedId.ts`, the UUIDv8 hash constraint ids use), recorded in `incomingIdToMergedId` (and its fact
type counterpart), so the existing translation rewrites the roles,
objectifications and populations that name it.

Acceptance:

- The probe from barwise-ue5, as a test: existing `x`/A, incoming `x`/B,
  only the addition accepted; the result holds A under `x` and B under the
  derived id, and merging twice gives byte-identical YAML.
- A law over two generated models and a generated subset of deltas: every
  element of the existing model whose removal was not accepted is in the
  result, and every accepted addition is in the result. It must fail on
  main before the fix (`mutate.mjs` is not needed: main is the mutant).

### 4. The builder's list names the id rules (provisional: not yet grounded)

Amend `core-branching-load.spec.md` WS1: `build()` refuses duplicate
element ids and duplicate constraint ids, under the ids workstreams 1 and 2
give them, and `structural/duplicate-constraint-id` moves into the builder
with the other duplicate rules. A spec edit only; it lands whenever
barwise-973 is next grounded.

## API and migration impact

- `OrmModel.add*` throws in a case it accepted. Any caller that relied on
  replacement by id was already losing data; workstream 1's corpus
  measurement and the full monorepo suite say whether one exists.
- One new validation rule id, an error. A 2.0 file with duplicate constraint
  ids now shows a diagnostic in the editor.
- Merge: the result can now contain an id neither input used, derived from
  the inputs, so a merge is still reproducible.
  The MCP and VS Code merge write-back writes it like any other id.
- No surface gains or loses a capability; the capability matrix is
  unchanged.

## Open decisions (for review)

1. **Merge on a collision: keep both, or refuse.** (a) Recommended: keep
   both, the added element under a derived id. The user accepted an addition
   and rejected a removal, and both choices are honoured. (b) Refuse the
   merge, naming the collision. Simpler, but it blocks the common rename
   case (an id like `ot-customer` kept while the name changes) until the
   user edits a file by hand.
2. **May two elements of different kinds share an id?** (a) Recommended:
   leave it allowed and out of this spec. The stores hold it, and every
   `OrmModel` lookup is per kind (`getObjectType`, `getFactType`, ...), and NORMA ids are already a separate branded space
   (`model-graph-and-id-spaces.spec.md`). (b) Make ids model-wide, as
   constraint ids are, with a validation rule. Worth doing only when a
   reader looks an id up without knowing its kind; none does today.
3. **Where the rule in Principle is written down.** (a) Recommended:
   `core/CLAUDE.md`, beside the placement and preferred-identifier rules,
   since it governs how core stores elements. (b) The root `CLAUDE.md`,
   under Design Principles, which would make it a project-wide rule; no
   other package stores model elements.

## Risks and testing

- **A tracked model depends on replacement.** Workstream 1 loads the whole
  corpus before and after, and reports any model that stops loading rather
  than adjusting it.
- **A merge that stops being reproducible.** Minting the new id from the
  installed generator would make one merge give two results, against the
  determinism rule for core. The id is derived instead, and workstream 3's
  test merges twice and compares bytes.
- **A derived id that collides again.** The hash input includes the incoming
  id and name; a second collision means a model already holding that hash,
  which the law's generator cannot produce. The merge refuses that case
  rather than looping.
- **A law that cannot fail.** Workstream 3's law is verified by running it
  against main first, where the generator's colliding ids make it fail.

## Non-goals

- No design-by-contract library, decorator or `assert` calls in core.
- No change to lenient loading of dangling references; the editor still
  opens a broken file.
- No new id format, and no branded ids beyond what
  `model-graph-and-id-spaces.spec.md` decided.
