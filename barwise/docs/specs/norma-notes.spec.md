# NORMA note round-trip: element and model notes

Status: Implemented 2026-08-08 -- object-type, fact-type, and model
notes round-trip as Notes > Note > Text; floating ModelNote texts fold
into the model note on import (blank-line separated).
Created: 2026-08-08
Last-updated: 2026-08-08
Tracking: norma-round-trip-completion.spec.md candidate follow-up
(owner-flagged); barwise-5t9.12

## Principle

Composability again: both metamodels carry informal notes, so notes
should cross the connector boundary like every other shared construct.
The candidate-follow-up entry framed this as needing a design call
("barwise has no notes seat today") -- that premise is stale. barwise
has `note` seats on ObjectType, FactType, and OrmModel ("free-text
note: informal commentary distinct from `definition`"), all serialized
in `.orm.yaml`; NORMA has `Notes > Note > Text` on ObjectTypeType
(inherited by EntityType/ValueType/ObjectifiedType), FactTypeType, and
ORMModelType, immediately after `Definitions` in each sequence
(XSD-verified 2026-08-08). The mapping is one-to-one wiring, the same
shape as the `definition` <-> `Definitions` round-trip that already
works. The open design question dissolves; no metamodel change.

## Scope

In scope (all in `@barwise/formats`, `src/norma/`):

- When an object type, fact type, or model with a `note` is exported,
  the system shall emit `Notes > Note > Text` on the corresponding
  NORMA element (model-level `Notes` before `Objects`, per the XSD
  sequence).
- When an imported NORMA element carries `Notes > Note > Text`, the
  system shall map the text to the element's `note`.
- When an imported NORMA model carries floating `ModelNotes`
  (`ModelNote` elements, a distinct many-valued seat), the system
  shall fold their texts into the model `note` (blank-line separated,
  after the model's own `Notes` text), so no note text is silently
  dropped.

Out of scope: `ModelNote.ReferencedBy` element anchors (no barwise
seat for note-to-element references; the text is preserved, the anchor
is not), notes on subtype facts and queries (no barwise seats), and
export of the model note as `ModelNotes` (the model's own `Notes` seat
is the direct counterpart).

## Inventory

| Module                        | Change                                             |
| ----------------------------- | -------------------------------------------------- |
| `norma/NormaXmlTypes.ts`      | `note?` on entity/value/objectified/fact + doc     |
| `norma/NormaXmlParser.ts`     | `parseNotesText` (mirrors `parseDefinitionText`)   |
| `norma/mapping/*.ts`          | Pass `note` through object/fact/model construction |
| `norma/NormaXmlWriter.ts`     | Write `note` from the model elements               |
| `norma/NormaXmlSerializer.ts` | `addNote` (mirrors `addDefinition`), XSD position  |

`@barwise/core` untouched.

## Workstreams

One workstream; the change is a single construct wired through the
existing four-file pipeline with a round-trip test per seat (object
type, fact type, model, ModelNotes fold on import).

## Risks and testing

- `NormaConstructRoundTrip` gains note cases; the four-fixture RT-B
  diff check must stay clean.
- The element-note emission position follows the XSD (`Notes` directly
  after `Definitions`); the standing manual NORMA-load check covers
  actual NORMA acceptance, as for every other construct.

## Non-goals

- No note-to-element anchor model, no multi-note-per-element support
  (barwise's seat is one string; NORMA's element seat is also at most
  one `Note`), no annotation-system involvement -- barwise TODO/NOTE
  export annotations are a different mechanism and stay untouched.
