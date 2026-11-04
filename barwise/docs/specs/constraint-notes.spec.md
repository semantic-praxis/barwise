# Constraint notes

Status: Draft -- no workstream implemented

Created: 2026-10-22
Last-updated: 2026-10-22
Tracking: barwise-y7c

## Principle

Every constraint kind gains an optional `note` that states why the rule
holds. The note is excluded from the constraint's identity, a change to it is
diffed as `safe`, and it ships in the format the version gate selects
(`orm-format-3.spec.md`, Open decision 12). Today a constraint cannot carry
its reason: object types, fact types and the model each carry a `note`,
and constraints carry nothing but their structure. The rationale therefore
lives in YAML comments, and the next barwise save erases it, because every
save goes text to model to text. The comment audit of 2026-10-22 found about
25 such lines in the trial kernels, and they are the most valuable domain
content there: "an MRN is unique only within the facility that issued it, so
the pair (MRN, Facility) identifies a patient record".

What a tool is meant to keep belongs in the model, not in formatting the
tool cannot see: explicit over implicit, applied to the model's own content.

## Should a constraint get `definition` as well as `note`? (resolved: no, `note` only)

A `definition` on an object type defines a term of the domain's language;
the model-level `definitions` list does the same. A constraint names no term,
and what it means is already stated twice, by its structure and by its
verbalization. What the corpus comments add is the reason for the rule and
the business context behind it, which is what `note` holds on object types
and fact types. One optional field, with the name and meaning it already has
elsewhere, is the smaller interface to learn.

## Scope

In scope:

- When a constraint of any kind carries a `note`, the system shall keep it
  through load, save, diff, merge and split, as it keeps a fact type's note.
- When a file in the format the version gate selects states `note` on a constraint, the loader shall accept it;
  a 2.0 file cannot carry one (every 2.0 constraint branch sets
  `additionalProperties: false`) and is unaffected.
- When two models differ only in a constraint's note, `diffModels` shall
  report one modification of that constraint, rated `safe`, and content
  matching shall still pair the two constraints.
- When `describe`, the VS Code hover on a constraint, or the DDL export's
  spilled-constraint comment shows a constraint, it shall show its note.

Out of scope:

- Moving the corpus comments into notes. That is orm-format-3 WS5, which
  runs after workstream 1 here.
- A note on roles, populations, subtype facts or diagram views. The audit
  found no comment about any of them.
- Storing the LLM extraction's `InferredConstraint.description` as a note.
  It restates the constraint in prose (it is what the extraction verbalized),
  so it would duplicate the verbalization, not add a reason. Open decision 3.

## Inventory

Verified against the code on 2026-10-22.

| Area                                                          | Current state                                                                                                                                                                                          | Verdict                                                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `core/src/model/Constraint.ts`                                | Every kind extends `ConstraintBase { id?; modality? }` (:21-26)                                                                                                                                        | gains `note?: string`                                                                                  |
| `core/schemas/orm-model.schema.json`                          | No shared constraint block: 7 internal and 9 external `oneOf` branches each repeat `id` and `modality`, each `additionalProperties: false`                                                             | `note` added to all 16 branches, with a drift test (below)                                             |
| `orm-model-2.0.schema.json`                                   | Frozen copy                                                                                                                                                                                            | untouched                                                                                              |
| `serialization/yaml/constraint.ts`                            | Shared fields handled once after the per-kind switch: write :136-142, read :236-239                                                                                                                    | `note` handled there, written only when non-empty                                                      |
| `serialization/derivedId.ts`                                  | Hashes `canonicalJson(c)` of the whole constraint (:99)                                                                                                                                                | `note` excluded from the hash (decision 2)                                                             |
| `diff/elementDiff.ts`                                         | `constraintKey` (:496-505) is structure plus `\|deontic`; `pairById` marks a pair changed only when keys differ (:613), so a note edit is invisible to diff                                            | note compared separately, on paired constraints                                                        |
| `diff/ModelDiff.ts`                                           | Model-level constraints, which is where 3.0 stores the external kinds, get their deltas at :208-212, and the only change emitted is `constraintsModified`, which `breakingLevel.ts:68` rates `caution` | emits a `note` change when only the note differs, so the edit rates `safe`                             |
| `diff/changeDescription.ts`                                   | Has `note` change kind for object and fact types (:131-132)                                                                                                                                            | reused for constraints                                                                                 |
| `diff/breakingLevel.ts`                                       | `note` is `safe` (:36)                                                                                                                                                                                 | unchanged                                                                                              |
| `diff/ModelMerge.ts`                                          | Copies constraints whole; fields are carried only when listed by name elsewhere (barwise-937, :70-72)                                                                                                  | test that a note is carried both ways                                                                  |
| `tests/types/constraintRecord.ts`                             | Frozen `Base { id; modality }` checked kind by kind against the union                                                                                                                                  | gains `note`                                                                                           |
| `tests/serialization/factTypeLayout.test.ts`                  | Byte layout of one constraint of every kind                                                                                                                                                            | one constraint gains a note                                                                            |
| `describe/summaries.ts`, `vscode/src/server/HoverProvider.ts` | Read `definition` only, never `note`, for any element                                                                                                                                                  | show a constraint's note (workstream 2)                                                                |
| `formats/src/ddl/DdlExportFormat.ts`                          | Spilled constraints print `-- Constraint (reason): verbalization` (:262), and a second site at :223                                                                                                    | note appended (workstream 2)                                                                           |
| NORMA import and export                                       | Parser and writer handle Notes for object types, fact types and the model only; `NormaConstraint` has no note                                                                                          | provisional: whether NORMA's schema allows a note on a constraint is not verified (no XSD in the repo) |
| `verbalization/`                                              | Reads neither `definition` nor `note` for any element                                                                                                                                                  | untouched: verbalization states the rule, a note explains it                                           |

`subtypeFlags.ts` and the subtype constraints are untouched beyond the shared
field: a constraint over subtypes is a `Constraint` and inherits it.

## Target architecture

```ts
// model/Constraint.ts
interface ConstraintBase {
  readonly id?: string;
  readonly modality?: ConstraintModality;
  /** Why the rule holds, in the domain's words. Never part of what it says. */
  readonly note?: string;
}
```

```yaml
# the selected format version
- id: c-mrn-facility
  type: external_uniqueness
  roles: [r-mrn, r-facility]
  note: An MRN is unique only within the facility that issued it.
```

Identity stays structural. `constraintKey`, content matching and the derived
id read what the constraint says, never its note, so editing a note never
turns a constraint into a different one. The diff reports the note as its own
change on the pair it already made.

## Alternatives considered

- **A model-level map from constraint id to note**, like the preferred
  identifier map. It keeps the constraint union untouched, but splits one
  fact about a constraint across two places, and every reader that shows a
  constraint must look it up. The map was right for the preferred identifier
  because that is a fact about the entity; a note is a fact about the
  constraint.
- **Comment-preserving saves.** Keeps every comment, rationale included, in
  every file. It is worth doing for formatting, but it leaves the rationale
  invisible to `describe`, the hover, review and every other surface, and it
  is a serializer-wide change. Filed separately; this spec does not depend on
  it.
- **A shared schema block (`allOf` over a common constraint base)** instead of
  sixteen copies of `note`. Cleaner, but every branch sets
  `additionalProperties: false`, which draft-07 applies to each schema alone,
  so a property declared in the shared block would be refused by the branch.
  Closing a composition needs `unevaluatedProperties`, from draft 2019-09,
  and the schemas are draft-07 under plain `Ajv` (`SchemaValidator.ts:29`).
  Moving drafts is its own change. A drift test over the sixteen copies costs
  one test.

## Workstreams (each independently shippable)

### 1. The field, end to end in core

`ConstraintBase.note`, the schema's sixteen branches, the serializer, diff
(a `note` change on paired constraints, in `elementDiff.ts` for a fact type's own constraints and in `ModelDiff.ts` for the model's), merge (carried both ways), split
(travels with its constraint), the derived-id exclusion, `ConstraintRecord`,
and the byte-layout test.

Acceptance:

- When a file with a note on one constraint of each kind is loaded and
  saved, the system shall write it back byte for byte.
- When the schema's constraint branches are listed, a drift test shall find
  `note` in every one, beside `id` and `modality` (the same test reads all
  three, so the next shared field is checked too).
- When only a note differs, `diffModels` shall report exactly one constraint
  modification whose change is `note`, rated `safe`.
- When a merge takes either side's constraint, the merged constraint shall
  carry that side's note.

### 2. Surfaces show it (provisional: not yet grounded)

`describe` (the constraint summary), the VS Code hover on a constraint, and
the DDL spilled-constraint comment. NORMA import and export if NORMA's format
holds a note on a constraint, which grounding must check against a NORMA-saved
file.

## API and migration impact

- One optional field on every constraint kind; no existing value changes.
- Format: the version `orm-format-3.spec.md` Open decision 12 selects. No tag
  contains 3.0 today (`v1.7.0` and `edge` both predate
  semantic-praxis/barwise#708).
- Downstream: everything that builds a constraint compiles unchanged, since
  the field is optional. The LLM response schema is not touched.

## Open decisions (for review)

1. **Format version.** Decided once, for this spec and its two siblings, by
   `orm-format-3.spec.md` Open decision 12. Its recommended default puts the
   field in 3.0, which holds only if this spec's workstream 1 lands before 3.0
   is released; otherwise it becomes 3.1.
2. **Does a note feed the derived id?** (a) Recommended: no. Only an id-less
   2.0 constraint gets a derived id, and 2.0 cannot carry a note, so this
   changes no id today; excluding it states the rule that identity is
   structural, so a later change to derivation cannot make a note edit move
   an id. (b) Leave the hash as it is, which is equivalent today and silent
   about the rule.
3. **Should LLM extraction write a note?** (a) Recommended: not from
   `InferredConstraint.description`, which restates the rule. (b) Add a
   separate `rationale` to the extraction format so the model can record a
   reason the transcript gave. This changes the response schema and the
   prompt, and needs a prompt-eval run; it belongs with
   `model-open-questions.spec.md` if anywhere.

## Risks and testing

- **Diff blindness.** The live risk is the current `pairById`: it compares
  keys only, so a note edit would pass silently. Workstream 1's diff test is
  the guard, and it must fail before the change.
- **Content matching.** A note must not enter `constraintKey`, or an LLM
  sample with a reworded note would read as a removed and an added
  constraint. Guarded by a test pairing two id-less constraints whose notes
  differ.
- **Merge drops fields it does not name** (barwise-937). Guarded by the merge
  test in both directions.

## Non-goals

- No verbalization change: verbalization says what the rule is.
- No new validation rule: a note is free text.
- No change to how constraints are identified, matched or keyed.
