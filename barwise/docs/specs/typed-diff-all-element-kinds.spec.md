# The diff should cover the model, not three sevenths of it

Status: WS1 and WS2 implemented (the element-label table; subtype facts
and objectified fact types diffed and merged); WS3 (populations) not
started
Created: 2026-09-07
Last-updated: 2026-09-08 (WS2 shipped)
Tracking: barwise-940 (this spec); barwise-937 (the merge defect that
exposed it, fixed by carrying the four kinds through unchanged);
`core-model-laws.spec.md`'s open decision "Shape of the barwise-937 fix",
whose option B this is; `core-branching-load.spec.md`, which proposed the
typed diff

In one sentence: `diffModels` emits deltas for three of `OrmModel`'s
seven element kinds, so an incoming model's new subtype facts,
objectifications and populations never merge in no matter what a
reviewer accepts -- and the union that says which kind a delta is about
has consumers that read it with two-way ternaries, so adding the missing
four will silently mislabel them rather than fail to compile.

## Principle

**Explicit over implicit, applied to a gap that currently reads as a
feature.** `mergeModels` builds a fresh `OrmModel` from deltas, so
whatever the diff does not model cannot survive a merge. barwise-937
fixed the resulting data loss by carrying the four unmodelled kinds
through from the existing model unchanged. That was the right minimal
fix and it left a second, quieter defect in place: carried means
carried, so the incoming model's version of those kinds is discarded
whatever the user does. `barwise merge` and `barwise import transcript`
accept every delta a reviewer ticks and still write the old subtype
facts. Nothing reports this, because from the outside a merge that keeps
the existing subtype facts looks exactly like a merge where they did not
change.

**Composability**, secondarily: the diff is the seam every review
surface is built on -- the CLI's `diff` and `merge`, the MCP tool, the
VS Code import review, and `sampleAgreement` in `llm`. A seam that
covers three sevenths of the model puts the same hole in all five.

There is a third principle at stake and it decides the workstream order.
`ModelDelta["elementType"]` is already a closed union of three literals,
which is what `closed-sets-as-unions.spec.md` argues for. Its consumers
are not exhaustive over it: four sites read it as
`x === "object_type" ? "Object type" : "Fact type"`, so a fourth member
is not a compile error, it is a subtype fact labelled "Fact type" in the
CLI, in `barwise history`, and in the VS Code review panel. Widening a
union whose readers are ternaries is how a closed set stops being
closed. The label table comes first for that reason.

## How should an element with no name be matched? (resolved: by the names it references)

The existing diff matches by name, because LLM re-extraction mints fresh
UUIDs and only names survive. Three of the four missing kinds have no
name at all -- they are relationships -- and the fourth does.

| Kind                  | Has a name? | Identity                                           |
| --------------------- | ----------- | -------------------------------------------------- |
| `DiagramLayout`       | yes         | `name`, exactly like the existing three            |
| `SubtypeFact`         | no          | the resolved pair `(subtypeName, supertypeName)`   |
| `ObjectifiedFactType` | no          | the resolved pair `(factTypeName, objectTypeName)` |
| `Population`          | no          | genuinely ambiguous -- see the open decision       |

Resolving through names rather than ids is the same decision the diff
already made and for the same reason, and it composes: a subtype fact
whose subtype was renamed reads as removed-plus-added, which is what a
renamed object type reads as too, and the existing synonym detection is
the mechanism for noticing that.

`ObjectifiedFactType` carries nothing beyond its two references, so it
has no modifiable content: its deltas are added, removed or unchanged
and never modified. That is a property of the type, not a limitation to
work around, and the delta type should say so rather than carry an
always-empty `changes` array.

## Scope

In scope:

- When the incoming model contains a subtype fact, objectified fact
  type or population that the existing model does not,
  `diffModels` shall emit an `added` delta for it.
- When both models contain the same element by the identity above and
  its content differs, `diffModels` shall emit a `modified` delta
  carrying `ChangeDescription` variants for what differs.
- When a delta for one of these kinds is accepted, `mergeModels` shall
  apply it; when rejected, the existing element shall survive unchanged.
- When `mergeModels` builds its result, every element kind except
  diagram layouts shall come from a delta; `carryUnmodelledElements`
  shall shrink to carrying layouts alone, per the resolved decision
  below.
- When a surface labels a delta by its element kind, it shall read that
  label from one table in core, so that adding a kind without a label
  is a compile error.
- The merge identity law and the accept-all law shall stay green, and
  the accept-all law shall be strengthened to assert all seven kinds.

Out of scope:

- Exposing the new delta kinds through the MCP tool's JSON shape beyond
  the existing `{elementType, name, kind, breakingLevel,
  changeDescriptions}` projection. A richer payload is a surface change
  with a capability-matrix row.
- Synonym detection over the new kinds. `detectSynonymCandidates` reads
  object types and fact types; extending it is a separate question about
  what a renamed relationship even means.
- Any change to `sampleAgreement`'s behaviour. It narrows `elementType`
  to two literals in its own types, so it will fail to compile and must
  be updated -- but updating it to _ignore_ the new kinds preserves its
  current meaning, which is what this spec does.

## Inventory

| File                                             | Current state                                                                   | Verdict                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------- | --------------------------------------------------- |
| `core/src/diff/deltas.ts`                        | `DeltaCommon` plus three element deltas; `ModelDelta` is their union            | Four delta types added; label table added           |
| `core/src/diff/ModelDiff.ts`                     | Three matched loops, ~40 lines each, one per kind                               | Four more loops, or one generic matcher             |
| `core/src/diff/elementDiff.ts`                   | `diffObjectType`, `diffFactType`, `diffDefinition` return `ChangeDescription[]` | Three comparers added                               |
| `core/src/diff/changeDescription.ts`             | 22 variants                                                                     | Variants added for the new kinds' fields            |
| `core/src/diff/breakingLevel.ts`                 | `CHANGE_LEVEL` is `Record<ChangeKind, BreakingLevel>`                           | Rows added; the Record makes omission a build error |
| `core/src/diff/ModelMerge.ts`                    | Three delta phases plus `carryUnmodelledElements` (barwise-937)                 | Three phases added; the carry shrinks to layouts    |
| `cli/src/commands/diff.ts`, `history.ts`         | `elementType === "object_type" ? "Object type" : "Fact type"`                   | Read the label table instead                        |
| `vscode/src/commands/ImportTranscriptCommand.ts` | The same ternary                                                                | Read the label table instead                        |
| `llm/src/sampleAgreement.ts`                     | Narrows `elementType` to `"object_type" \| "fact_type"` in its own types        | Skips the new kinds explicitly; behaviour unchanged |
| `mcp/src/tools/diff.ts`                          | Projects `{elementType, name: term-or-name, ...}`                               | Needs a name for the new kinds; see WS1             |
| `core/tests/laws/merge.law.test.ts`              | Accept-all law asserts object types, fact types, definitions                    | Strengthened to all seven                           |

The thing that looks affected and is not: **`OrmModel` itself**. Every
collection the diff needs is already exposed as a readonly getter, and
every kind already has a `toXConfig` round-trip function that
`ModelMerge` uses today.

## Target architecture

```
core/src/diff/deltas.ts

  type ElementType =
    | "object_type" | "fact_type" | "definition"
    | "subtype_fact" | "objectified_fact_type" | "population" | "diagram_layout"

  const ELEMENT_LABEL = {
    object_type: "Object type",
    ...
  } as const satisfies Record<ElementType, string>

  elementLabel(d: ModelDelta): string     // for a surface's prose
  elementName(d: ModelDelta): string      // the identity, as text

  ObjectifiedFactTypeDelta extends Omit<DeltaCommon, "changes">
    // no modifiable content: added | removed | unchanged only

ModelMerge.ts
  phases 1-3 unchanged
  phase 4  subtype facts        (needs object types: after phase 1)
  phase 5  objectified fact types (needs both: after phase 2)
  phase 6  populations           (needs fact types, and the role remap)
  diagram layouts: carried, never diffed (resolved decision)
  carryUnmodelledElements: layouts only (see the resolved decision)
```

`elementName` is the piece the MCP tool and the CLI both need and
neither can compute today: `d.elementType === "definition" ? d.term :
d.name` is a two-case expression that four files repeat, and the new
kinds have neither field. One function, one table, seven arms the
compiler counts.

## Alternatives considered

- **Keep `carryUnmodelledElements` and diff only what it cannot carry.**
  Cheapest, and it is where we are. It leaves the defect: an incoming
  model's new subtype facts never arrive. The issue exists because that
  is not acceptable.
- **A generic matcher over `{key, compare}` instead of seven loops.**
  Tempting -- the three existing loops are near-identical and the four
  new ones would be too. It loses on the phase ordering: the merge must
  add object types before fact types before populations, and each phase
  reads state the previous one built (`incomingIdToMergedId`,
  `roleIdMap`). A generic matcher for the _diff_ is real and worth
  doing; a generic applier for the _merge_ would need the ordering
  expressed as data anyway. Recommend the matcher for the diff in WS2
  and explicit phases in the merge, and see the duplication ratchet's
  verdict rather than predicting it.
- **Give every kind a synthetic name at model-construction time**, so
  the diff can keep matching by one string. Rejected: it puts a diff
  concern into the metamodel, and a synthetic name for a subtype fact is
  its two references concatenated -- the same key, stored redundantly.
- **Emit the new deltas but leave the merge carrying.** Halfway: a
  reviewer would see subtype-fact deltas and accepting one would do
  nothing. Worse than either end.

## Workstreams (each independently shippable)

### 1. One label table, and `elementName` (implemented)

Add `ElementType`, `ELEMENT_LABEL`, `elementLabel` and `elementName` to
core; replace the four ternaries in `cli` and `vscode` and the
projection in `mcp` with calls. No new element kinds, no behaviour
change, no delta type added.

This ships first because it is the only workstream whose absence makes
the others silently wrong: with the ternaries in place, WS2 mislabels
three new kinds as "Fact type" in three surfaces and no build fails.
With the table in place, WS2 cannot compile until every kind has a
label.

Acceptance: when a member is added to `ElementType` without a row in
`ELEMENT_LABEL`, the build shall fail; and the CLI's `diff`, `history`
and the VS Code review panel shall print the labels they print today,
pinned by their existing tests.

### 2. The two name-derivable kinds (implemented)

Subtype facts and objectified fact types: delta types,
comparers, `ChangeDescription` variants, matched loops in `diffModels`,
and merge phases. Layouts are NOT among them, per the resolved decision:
`carryUnmodelledElements` loses subtype facts and objectified fact types
and keeps populations and layouts.

Acceptance: when the incoming model adds a subtype fact and its delta is
accepted, the merged model shall contain it; when the delta is rejected,
the merged model shall contain the existing model's subtype facts and
not the incoming one's. The identity law stays green.

### 3. Populations, and the end of the carry (provisional: not yet grounded)

Populations, under whichever identity the open decision settles, plus
the deletion of `carryUnmodelledElements`'s population arm and the role-remap logic it
owns -- `recordRoleRemap` and `remapPopulationRoles` move into the
population phase, since an accepted fact-type modification still moves
roles out from under a population the merge keeps.

Ships last because it carries the one unresolved identity question and
the one piece of subtle existing logic (barwise-941's `null` sentinel).

Acceptance: the accept-all law, strengthened to assert all seven kinds,
shall be green for the six diffed kinds; and `carryUnmodelledElements`
shall carry diagram layouts and nothing else.

## API and migration impact

- `@barwise/core/diff` gains `ElementType`, `elementLabel`,
  `elementName` and four delta types; `ModelDelta` gains four union
  members. Every existing `ModelDelta` reference still type-checks
  except where it narrows the union, which is the point.
- `llm` fails to compile at `sampleAgreement.ts` until it skips the new
  kinds. That is the compiler doing its job and it is the one place the
  union widening is caught for free.
- `cli`, `mcp` and `vscode` change display code only. No capability
  matrix row changes: no surface gains or loses a capability, and the
  MCP tool's JSON keys stay as they are.
- Run the full monorepo build after WS1 and after WS2: this is a core
  public-API change and a per-package `tsc --noEmit` reads the old
  `dist`.

## Open decisions (for review)

- **How a population is identified. (resolved: `(factTypeName, sample)`.)**
  Nothing enforces one population
  per fact type -- `addPopulation` keys by the population's own id and
  accepts many. Measured across every tracked `.orm.yaml`: 28
  populations in 11 models, **all 28 carrying a description**, and **no
  model with more than one population on a single fact type**. So all
  three options behave identically on every model that exists, and the
  choice is only about which failure mode to prefer for models that do
  not yet.

  Option A: key by fact type name. Simple; cannot represent a fact type
  carrying both a significant and a sample population. Option B: key by
  `(factTypeName, description ?? "")`. Option C: key by
  `(factTypeName, sample)`.

  **C**, revised from B once the measurement was in, and confirmed by the
  reviewer.
  `description` is prose, which makes it a non-key attribute, and putting
  a non-key attribute in the key turns an update to it into a delete plus
  an insert: rewording a population's description would report the
  population removed and a different one added, its instances appearing
  to vanish and reappear. Rewording is the edit that actually happens.
  `sample` is stable under it, is the flag the metamodel already treats
  as load-bearing (`sample-populations.spec.md`), and discriminates the
  one realistic two-population case; flipping it reads as
  remove-plus-add, which is right, because it is a change of kind rather
  than of content. Whichever is chosen, the identity belongs in a named
  function with the reasoning attached, because it is the assumption most
  likely to be wrong.

- **Whether a diagram layout is worth diffing at all. (resolved: no --
  layouts stay carried.)** The reviewer's call, and the evidence is
  stronger than the argument this draft first made. A layout is only ever
  written by a human: the VS Code diagram panel saves one when someone
  arranges nodes (`DiagramPanel.ts`), `extension.ts` creates a named
  view, and the NORMA importer brings one in. `packages/llm/src` contains
  no reference to `DiagramLayout` at all, so a re-extracted incoming
  model has **none**. Diffing layouts would therefore emit a `removed`
  delta for every existing layout on every import, and a reviewer
  accepting all deltas would delete their whole arrangement. That is a
  concrete harm, not a preference.

  So `carryUnmodelledElements` survives, owning exactly one kind, and its
  comment says why that one is deliberate rather than pending. This
  contradicts barwise-940's acceptance criteria
  ("`carryUnmodelledElements` is deleted"), which were written before
  anyone asked what a layout delta would mean; the issue is updated
  rather than the design bent to fit it.

- **What breaking level each new change reads as.** A removed subtype
  fact changes what the model asserts about identity and is plausibly
  `breaking`; a changed population is data rather than shape and is
  plausibly `safe`. `CHANGE_LEVEL` forces a row per variant, so nothing
  can be forgotten -- but the values are a judgement nobody has made
  yet. Recommend deciding them in WS2 and WS3 with the variants in front
  of us, rather than guessing here.

## Risks and testing

- **The merge identity law is the guard that matters** and it already
  exists: `merge.law.test.ts`'s "every element kind survives the
  identity merge" is exactly the property barwise-937 broke. It must
  stay green at every step, and it will fail loudly if a phase is
  ordered wrong.
- **The accept-all law is the acceptance test**, and it is currently
  too weak to notice this bug: it asserts object types, fact types and
  definitions only. Strengthening it is WS3's acceptance, and it should
  be watched failing against today's `carryUnmodelledElements` before
  the fix -- a law that passes both before and after proves nothing.
- **The population role remap is the subtle existing behaviour.**
  barwise-941's `null` sentinel distinguishes "this role is gone" from
  "this role was not remapped", and `??` collapses them. Moving that
  logic into a diffed phase must preserve it; its test must move with
  it.
- **Phase ordering is the likely defect.** A population added before its
  fact type throws inside `OrmModel`, and `mergeAndValidate` catches the
  throw and returns a null model -- losing the whole merge rather than
  one element. The identity law covers this for generated models; the
  phases should also be listed in one comment naming what each depends
  on.

## Non-goals

- No new capability on any surface, and no capability-matrix change.
- No synonym detection over the new kinds.
- No richer MCP payload. The JSON keys stay as they are.
- No change to what `sampleAgreement` measures.
