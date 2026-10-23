# Model invariants: what the store refuses, what validation reports, and what operations promise

Status: Draft -- no workstream implemented; open decisions 1 to 3 resolved
by the owner 2026-10-23, each as recommended

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

That split is design by contract, applied to a model that must be able to
hold mistakes. Of its three parts, barwise already has two in its own
idiom, and this spec adds what is missing rather than a second mechanism:

| Contract part                              | Barwise today                                                                                                                                    | This spec                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Precondition (what a caller supplies)      | JSON Schema on load; 33 refusals in `OrmModel`; Effect Schema decoders planned (`effect-adoption.spec.md`), whose errors appear in the type      | unchanged                                                                                     |
| Invariant (always true of a model)         | Decided 2026-09-06: "can the value exist with this defect" picks build refusals over validation rules (`core-branching-load.spec.md`, Decisions) | applies that test to element ids, which it missed (workstreams 1, 3, 4)                       |
| Postcondition (what an operation promises) | Property laws over generated models (`tests/laws/`)                                                                                              | a merge law for partial acceptance over renamed pairs, the case that lost data (workstream 2) |

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

| Defect                                                                                     | Can the model hold it?                                     | Today                                                                 | Owner                                                                             |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Two object types (or fact types, subtype facts, objectifications, populations) with one id | No: an id-keyed map keeps the last one                     | Silently replaced, from a file and from code; no diagnostic           | The store refuses it (workstream 3)                                               |
| Two roles with one id                                                                      | Yes: roles are an array per fact type                      | `structural/duplicate-role-id`                                        | Validation, unchanged                                                             |
| Two constraints with one id                                                                | Yes: constraints are arrays                                | Refused by the 3.0 loader only; a 2.0 file and code pass              | Validation reports it (workstream 1); the builder refuses it later (workstream 4) |
| Two subtype facts over one subtype/supertype pair, different ids                           | Yes: the ids differ                                        | `addSubtypeFact` refuses it, but only outside a lenient load; no rule | Validation reports it (workstream 1)                                              |
| Two object types with one name                                                             | No, at `addObjectType`, which refuses; yes, after a rename | `structural/duplicate-object-type-name`                               | Unchanged                                                                         |
| A role naming an absent object type                                                        | Yes, under a lenient load                                  | `structural/dangling-role-reference`                                  | Unchanged until the builder (barwise-973)                                         |

The rule this table states, and which workstream 3 writes into
`core/CLAUDE.md`: **a defect the model cannot hold is refused when it is
stored; a defect it can hold is reported by validation.** A lenient load
skips the checks for what the model can hold, which today include the
subtype-pair check, so each of those needs a rule that reports it; it never
skips an id the store already holds, because that cannot be reported later.

## Scope

In scope:

- When a model holds two constraints with one id, validation shall report
  it, naming the id and the fact types of both (closes barwise-b2s for 2.0
  files and models built in code).
- When a model holds two subtype facts over one subtype/supertype pair,
  validation shall report it, naming both ids.
- When a merge accepts an added element whose id an element kept from the
  existing model holds, the merged model shall hold both, the added one
  under an id derived from its inputs, with every reference the incoming
  model made to it translated; the same inputs shall give the same merged
  model. This holds for object types, fact types and their roles, subtype
  facts, objectifications and populations.
- When the merge laws run, they shall include partial acceptance over pairs
  in which the incoming model renames an element and keeps its id.
- When an object type, fact type, subtype fact, objectified fact type or
  population is added with an id an element of the same kind already holds,
  `OrmModel` shall refuse it, naming the id and both elements, whether or
  not `skipPlayerValidation` is set.
- When a file, 2.0 or 3.0, lenient or not, states two elements of one of
  those kinds with one id, `deserialize` shall throw `DeserializationError`,
  naming the id and both elements.

Out of scope:

- Moving the referential rules into the builder. That is barwise-973;
  workstream 4 only amends its list.
- Whether an object type and a fact type may share an id. Different kinds
  live in different maps, so the store can hold it, and the owner decided it
  stays allowed (decision 2).
- Constraint id collisions in a merge. Diff pairs constraints by id first
  (orm-format-3 WS3a-iii), so two constraints sharing an id are one
  modified constraint, never a kept one and an added one.
- Design-by-contract tooling of any kind (resolved above).

## Inventory

Verified on main `1a32f9c7`, 2026-10-23.

| Area                                                  | Current state                                                                                                                                                                                                                                                                                        | Verdict                                                                                                                            |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `core/src/model/OrmModel.ts`                          | Five `Map<string, ...>` stores (:63-67); `addObjectType` and `addFactType` check the name (:132, :450), never the id; `addSubtypeFact` checks the subtype/supertype pair inside `if (!skipPlayerValidation)` (:542-578); `addPopulation` checks only its fact type; every refusal is a plain `Error` | each `add*` refuses an id already held, as `DuplicateIdError` (workstream 3)                                                       |
| `core/src/model/Population.ts`                        | No name; a population is described by its fact type                                                                                                                                                                                                                                                  | the refusal and the derived id name it by id and fact type                                                                         |
| `core/src/serialization/OrmYamlSerializer.ts`         | `fromDocument` refuses two constraints sharing an id with `DeserializationError` (`claim`, :268-278); `readDocument20` does not; both call `add*` unwrapped, so a refusal from `OrmModel` surfaces as a plain `Error`                                                                                | both readers turn a `DuplicateIdError` into `DeserializationError` (workstream 3); the constraint check stays                      |
| `core/src/validation/rules/structural.ts`             | `duplicate-role-id`, `duplicate-object-type-name`, `duplicate-fact-type-name`, two objectification duplicates; nothing for constraint ids or subtype pairs                                                                                                                                           | gains `structural/duplicate-constraint-id` and `structural/duplicate-subtype-fact` (workstream 1)                                  |
| `core/src/diff/ModelMerge.ts`                         | `incomingIdToMergedId` (:82) and `incomingFtIdToMergedId` (:87) translate ids for elements matched by name; no map for roles or subtype facts. `resolveObjectTypeId` and `resolveFactTypeId` (:807-834) try a direct hit in the merged model before the map                                          | resolvers become side-aware; role and subtype-fact maps added; collisions get derived ids (workstream 2)                           |
| Id references in the model                            | Roles name object types; constraints name roles and, over subtypes, subtype facts (`subtypeFactIds`); objectifications name a fact type and an object type; populations name a fact type and roles. Nothing names an objectification's or a population's own id                                      | maps needed for object types, fact types, roles and subtype facts; objectifications and populations need only a derived id         |
| `core/tests/laws/merge.law.test.ts`                   | Laws for "accept nothing" (:31) and "accept everything" (:102)                                                                                                                                                                                                                                       | gains partial acceptance (workstream 2)                                                                                            |
| `core/tests/arbitraries/model.ts`                     | Object type and fact type ids and names come from one index (`ot${i}`/`T${i}`, :461-462; `ft${j}`/`F${j}`, :524-525), so two draws never rename an element under a kept id; subtype facts and populations (`sf${i}`, `pop${i}`) do collide across draws                                              | gains a renamed-pair arbitrary (workstream 2)                                                                                      |
| Importers in `code-analysis`, `dbt`, `formats`, `llm` | 14 source files call `addObjectType` or `addFactType`, several with ids they compute themselves                                                                                                                                                                                                      | each a site that could now throw; measured by the full monorepo suite in workstream 3 (provisional: not yet grounded per importer) |
| `docs/specs/core-branching-load.spec.md`              | WS1's `build()` takes `structural/dangling-*`, `structural/duplicate-*`, the `*-not-entity` rules and the subtype cycle                                                                                                                                                                              | amended to name element-id and constraint-id uniqueness (workstream 4)                                                             |

The merge law suite is a shadow of the property it was meant to check. It
covers the two ends of acceptance, nothing and everything, and its
generator never renames an object type or fact type under a kept id, so the
rename case that loses data is never drawn.

## Target architecture

```ts
// OrmModel: one private check before each of the five id-keyed stores.
// Runs whatever skipPlayerValidation says: the store cannot hold a second
// element under one id, so lenience cannot defer it to a rule.
export class DuplicateIdError extends Error {
  readonly id: string;
  readonly kind:
    | "object type"
    | "fact type"
    | "subtype fact"
    | "objectification"
    | "population";
}
// message: `Object type id "x" is already held by "A"; "B" cannot reuse it.`
// A population, which has no name, reads "population of fact type F".

// Both readers: catch DuplicateIdError around add*, rethrow as
// DeserializationError naming the id. Nothing else they call is wrapped.

// structural.ts: representable, so reported, not refused.
//   structural/duplicate-constraint-id, over model.everyConstraint().
//   structural/duplicate-subtype-fact, over model.subtypeFacts.

// ModelMerge: an accepted addition never displaces a kept element.
//   An incoming element's references are in the incoming id space, so a
//   resolver given one consults the incoming map first and the merged model
//   only for an id the map does not hold. An existing element's references
//   resolve directly, as today.
//   On a collision: derivedId("merge-collision", [kind, incomingId, label]),
//   where label is the name, or a population's fact type id; recorded in the
//   kind's map (object type, fact type, role, subtype fact), so roles,
//   constraints over subtypes, objectifications and populations that the
//   incoming model wrote against the old id are rewritten.
//   An added fact type's roles get derived ids too when any is held.
//   Derived, not minted: merge mints no id today, so it is a pure function
//   of its inputs, and a random id would end that.
```

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
- **The loader checks element ids itself, as `claim` does for constraints.**
  It gives the right error type without a new class, but states the rule in
  two places, the store and the loader, and the store's copy still covers
  only code. One refusal in the store, converted at the loader, keeps one
  owner.
- **A model-wide `modelInvariants(model)` check run after every operation.**
  Proposed in conversation before grounding. It cannot see what workstreams
  2 and 3 fix, because a lost element leaves no trace in the output; the
  merge defect is a relation between input and output, which a law states
  and an invariant over the output cannot. And the representable rules
  already have one home, the validation engine.

## Workstreams (each independently shippable)

The order is forced: workstream 3 makes the store throw on a held id, and
until workstream 2 lands, a merge that hits the rename case would then
throw instead of finishing. Workstream 2 therefore lands first among the
two.

### 1. Validation reports what the store can hold (barwise-b2s)

`structural/duplicate-constraint-id` over `everyConstraint`, an error naming
the id and the fact types each constraint applies to, and
`structural/duplicate-subtype-fact`, an error naming both ids and the pair.
The 3.0 loader's `claim` stays: a 3.0 file is refused at load, a 2.0 file
and a model built in code are reported.

Acceptance: tests plant each duplicate in a 2.0 file, in a lenient load,
and in code, and see one diagnostic each; both ids are registered in
`ruleId.ts`. Independent of the other workstreams.

### 2. Merge keeps both elements, and the laws draw renames (barwise-ue5)

The side-aware resolvers, the role and subtype-fact maps, and derived ids
on collision, as in Target architecture, for all five id-keyed kinds and
roles.

A new arbitrary draws a pair in which the incoming model is the existing
one with some object types and fact types renamed under the same ids (and,
independently, some roles added), so diff reports a removal and an addition
sharing an id.

Acceptance:

- The probe from barwise-ue5, as a test: existing `x`/A, incoming `x`/B
  with an added fact type whose role plays B, only the additions accepted.
  The result holds A under `x`, B under the derived id, and the role plays
  B; merging twice gives byte-identical YAML.
- The same for a fact type renamed under a kept id with the same role ids:
  no two roles in the result share an id.
- A law over renamed pairs and a drawn subset of deltas: every existing
  element whose removal was not accepted is in the result, every accepted
  addition is in the result, and every reference resolves to the element
  the side it came from meant.
- The law fails on main before the fix; main is the mutant.

### 3. The store refuses an id it already holds (barwise-1l0)

`DuplicateIdError` and the check before each of the five stores, both
readers converting it, and the `core/CLAUDE.md` rule stated above.

Acceptance:

- When each of the five `add*` methods receives an id its store holds, it
  shall throw `DuplicateIdError`, naming the id and both elements; one test
  per kind, the population case naming its fact type.
- When a 2.0 file and a 3.0 file each state two object types with one id,
  `deserialize` shall throw `DeserializationError` naming the id, with and
  without `lenient`.
- When the tracked corpus and the full monorepo suite run before and after,
  everything that passed before shall pass after. An importer test that now
  throws is an importer that was already losing an element: it is filed as
  its own bug with the input that triggers it, not worked around here.

### 4. The builder's list names the id rules (provisional: not yet grounded)

Amend `core-branching-load.spec.md` WS1: `build()` refuses duplicate
element ids and duplicate constraint ids, and the two rules workstream 1
adds move into the builder with the other duplicate rules. A spec edit
only; it lands whenever barwise-973 is next grounded.

## API and migration impact

- New export: `DuplicateIdError` from core's root.
- `OrmModel.add*` throws in a case it accepted. Any caller that relied on
  replacement by id was already losing data; workstream 3's measurement
  says whether one exists among the importers.
- Two new validation rule ids, both errors. A 2.0 file with duplicate
  constraint ids now shows a diagnostic in the editor.
- Merge: the result can contain an id neither input used, derived from the
  inputs, so a merge is still reproducible. The MCP and VS Code merge
  write-back writes it like any other id.
- No surface gains or loses a capability; the capability matrix is
  unchanged.

## Decisions (resolved by the owner, 2026-10-23)

Each was decided as recommended: (a) in all three. The options are kept so
a later workstream does not reopen them without the trade-off in view.

1. **Merge on a collision: keep both, or refuse.** (a) Chosen: keep
   both, the added element under a derived id. The user accepted an
   addition and rejected a removal, and both choices are honoured. (b)
   Refuse the merge, naming the collision. Far smaller (no resolver or map
   changes, no arbitrary), but it blocks the common rename case (an id like
   `ot-customer` kept while the name changes) until the user edits a file
   by hand. Under (b), workstream 2 shrinks to the refusal and the law, and
   still lands before workstream 3.
2. **May two elements of different kinds share an id?** (a) Chosen:
   leave it allowed and out of this spec. The stores hold it, and every
   `OrmModel` lookup is per kind (`getObjectType`, `getFactType`, ...),
   and NORMA ids are already a separate branded space
   (`model-graph-and-id-spaces.spec.md`). (b) Make ids model-wide, as
   constraint ids are, with a validation rule. Worth doing only when a
   reader looks an id up without knowing its kind; none does today.
3. **Where the rule in Principle is written down.** (a) Chosen:
   `core/CLAUDE.md`, beside the placement and preferred-identifier rules,
   since it governs how core stores elements. (b) The root `CLAUDE.md`,
   under Design Principles, which would make it a project-wide rule; no
   other package stores model elements.

## Risks and testing

- **An importer depends on replacement.** Fourteen importer files call
  `add*`, some with computed ids. Workstream 3 runs the whole monorepo
  suite before and after and reports any importer that starts throwing,
  rather than adjusting it in the same PR.
- **A merge that stops being reproducible.** Minting the new id from the
  installed generator would make one merge give two results, against the
  determinism rule for core. The id is derived instead, and workstream 2's
  test merges twice and compares bytes.
- **A derived id that collides again.** The hash input includes the
  incoming id and a label; a second collision means a model already holding
  that hash, which the generator cannot produce. The merge refuses that
  case rather than looping.
- **A law that cannot fail.** Workstream 2's law is verified by running it
  against main first. The existing generator could not have failed it,
  which is why the renamed-pair arbitrary is part of the workstream rather
  than an option.

## Non-goals

- No design-by-contract library, decorator or `assert` calls in core.
- No change to lenient loading of dangling references; the editor still
  opens a broken file.
- No new id format, and no branded ids beyond what
  `model-graph-and-id-spaces.spec.md` decided.
