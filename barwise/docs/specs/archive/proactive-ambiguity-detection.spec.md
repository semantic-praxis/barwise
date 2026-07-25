# Proactive LLM ambiguity detection during transcript extraction

Status: Implemented -- structured ambiguity checklist (cardinality,
overloaded terms, temporal semantics, with flag-triggers and examples)
in packages/llm/src/prompt/systemPrompt.ts.
Created: 2026-03-08
Last-updated: 2026-07-25

## Problem

The LLM extraction prompt instructs the model to "flag contradictions,
unclear terminology, or open questions" but provides no checklist,
categories, or examples. The result is reactive ambiguity detection --
the LLM only flags obvious contradictions it happens to notice, rather
than systematically checking for the common data modeling pitfalls that
experienced modelers would catch in a review session.

This means transcripts with subtle issues (overloaded terms, unstated
cardinality, implicit optionality, missing temporal semantics) produce
clean-looking models with hidden assumptions baked in.

## Solution

Expand the ambiguity instruction in `ExtractionPrompt.ts` with a
structured checklist of common data modeling ambiguity categories and
concrete examples. The LLM should treat this checklist as a review
pass after initial extraction -- scanning its own output for each
category and flagging anything uncertain.

No changes to types, parser, annotator, or downstream consumers. The
improvement is purely in prompt quality; the existing `Ambiguity`
interface and annotation pipeline already handle everything downstream.

## Ambiguity checklist

The prompt should instruct the LLM to check for these categories:

### 1. Identification ambiguity

Does every entity type have a clear, unambiguous identifier? Flag when:

- Multiple candidate identifiers exist (e.g., "customer ID" and "email"
  both implied as unique)
- No identifier is stated or implied
- Composite identification is unclear (which combination of attributes?)

Example: "Each customer has a customer number and an email address" --
is customer number the sole identifier, or is email also unique?

### 2. Cardinality ambiguity

Is the multiplicity of each relationship clear? Flag when:

- One-to-many vs many-to-many is not explicit
- "Has" or "contains" could mean either direction
- Aggregation vs association is unclear

Example: "A project has team members" -- can a team member belong to
multiple projects?

### 3. Optionality ambiguity

Is participation mandatory or optional? Flag when:

- The transcript says "can have" or "may have" without clarifying
  whether the reverse is also optional
- Mandatory participation is assumed but not stated
- Null/empty cases are not addressed

Example: "An order can have a discount code" -- must every discount
code be used on at least one order?

### 4. Overloaded terms

Are the same words used with different meanings? Flag when:

- A term appears in multiple contexts with potentially different
  semantics
- Abbreviations or acronyms are used without definition
- Domain jargon could be interpreted multiple ways

Example: "Account" used for both user accounts and financial accounts.

### 5. Temporal ambiguity

Are time-dependent facts modeled correctly? Flag when:

- A relationship changes over time but is modeled as current-state only
- Historical tracking may be needed but is not mentioned
- Effective dates or validity periods are implied but not explicit

Example: "An employee works in a department" -- is this current
assignment only, or should we track the history?

### 6. Granularity ambiguity

Is the level of detail appropriate? Flag when:

- An entity could be decomposed further (e.g., "address" as a single
  value vs structured fields)
- A value type might be better modeled as an entity with its own
  attributes
- Measurement precision is unstated (e.g., "price" -- to what decimal?)

Example: "Each store has an address" -- is address a single text value,
or does it have street, city, state, postal code components?

### 7. Derivation ambiguity

Is a fact stored or computed? Flag when:

- A stated fact appears derivable from other facts
- Aggregations or calculations are described as attributes
- It is unclear whether a value should be stored or computed on demand

Example: "Each order has a total amount" -- is this stored, or derived
from line item prices and quantities?

### 8. Constraint completeness

Are business rules fully captured? Flag when:

- A constraint is implied but not explicit enough to formalize
- Mutual exclusion or dependency between facts is hinted at
- Boundary conditions or edge cases are not addressed

Example: "A flight is either domestic or international" -- is this
exclusive (exactly one), or could it be neither?

## Prompt structure

The ambiguity instruction (currently lines 119-122 in
`ExtractionPrompt.ts`) should be replaced with a structured section
containing:

1. The checklist above, condensed to fit the prompt without excessive
   token cost (~400 tokens for the checklist)
2. One concrete example per category showing the ambiguity and what a
   good flag looks like
3. An instruction to perform the check as a review pass: "After
   extracting all elements, review your output against each category
   and add an ambiguity entry for anything uncertain"

The existing Ambiguity schema (`description` + `source_references`)
is sufficient -- no schema changes needed.

## Files

### Modified files

- `packages/llm/src/ExtractionPrompt.ts` -- replace ambiguity
  instruction with structured checklist
- `packages/llm/tests/ExtractionPrompt.test.ts` -- add tests verifying
  the prompt includes each ambiguity category

### No new files

The change is confined to prompt text.

## Test coverage

- Prompt content tests: verify each of the 8 ambiguity categories
  appears in the generated system prompt
- Integration test with a synthetic transcript containing at least 3
  ambiguity categories: verify the LLM flags them (this may need to be
  a manual verification or a recorded-response test depending on CI
  constraints)
- Regression: existing extraction tests continue to pass (the prompt
  change should not alter extraction of unambiguous transcripts)

## Success criteria

- The system prompt includes all 8 ambiguity categories with examples
- Extraction of a transcript with known ambiguities produces at least
  one ambiguity per relevant category
- No regression in extraction quality for clear transcripts
- Prompt token increase is under 500 tokens
