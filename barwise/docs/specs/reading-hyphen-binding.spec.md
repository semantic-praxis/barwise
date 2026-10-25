# Readings bind hyphenated words to the role player that follows

Status: Draft -- no workstream implemented

Created: 2026-10-25
Last-updated: 2026-10-25
Tracking: barwise-iiw
Touches: barwise/packages/core/src/model/ReadingOrder.ts,
barwise/packages/core/src/index.ts,
barwise/packages/core/src/verbalization/FactTypeVerbalizer.ts,
barwise/packages/core/src/verbalization/constraints/sentence.ts,
barwise/packages/core/src/verbalization/constraints/phase1.ts,
barwise/packages/core/src/verbalization/constraints/phase2.ts,
+barwise/packages/core/tests/model/readingHyphenBinding.test.ts,
barwise/packages/diagram/src/session/modelSummary.ts,
barwise/packages/formats/src/ossie/mapOssieToOrm.ts,
barwise/packages/formats/tests/OssieImportFormat.test.ts

When a reading writes a word with a trailing hyphen before a role
placeholder -- `"{0} has sale- {1}"`, `"{0} has average- departure {1}"` --
the verbalizer shall treat the words from that one up to the placeholder as
part of the role player's phrase, without the hyphen: "Listing has sale
Currency", and with a quantifier, "Each Listing has at most one sale
Currency", instead of today's "Each Listing has sale- at most one Currency".

## Principle

**One answer per question, and the notation ORM already has.** Hyphen
binding is ORM's way (Halpin; NORMA implements it) of saying which words
qualify a role player rather than belong to the predicate. barwise reads
the reading templates in about a dozen places, each slicing the text around
`{n}` itself, and none knows the convention, so the hyphen is printed and a
quantifier lands between the bound words and their player.

It is not hypothetical. The tracked models use it -- the auction example
alone has `has child- {1}`, `includes mandatory- {1}`, `has sale- {1}`,
`has sold- {1} at {2}`, `has starting- {1}` -- and `barwise verbalize
docs/auction.orm.yaml` prints, among others:

```
Listing has sale- Currency
  Each Listing has sale- at most one Currency.
```

The Ossie importer keeps such readings and warns that barwise does not apply
them (`ossie-ontology-format.spec.md`, Open decision 4, barwise-iiw).

## Observed today (at b3524c4d)

- `expandReading` (core, root export), `FactTypeVerbalizer`'s template
  parser, `extractPredicate` (constraint sentences), phase2's role
  sentences ("some X"), phase1's mandatory sentence (a raw `replace`), and
  the diagram's `renderReading` (a private copy of `expandReading`) each
  substitute `{n}` in the template text as written.
- No checked-in generated file contains a hyphen-bound verbalization, so no
  golden or tutorial output needs regenerating.
- The template is stored and serialized as written; NORMA and Ossie export
  write it verbatim, which is what both formats expect.

## Scope

In scope:

- One parser, `splitReading(template)` in `model/ReadingOrder.ts`,
  exported from the root: the template as alternating text and role parts,
  where each role part carries its **lead** -- the bound words before it,
  hyphen removed -- and the text before it no longer contains them.
- The binding rule: in the text immediately before placeholder `{n}`, the
  first word that ends in a hyphen followed by whitespace begins the lead,
  which runs to the placeholder. A hyphen inside a word ("co-owner") or one
  not followed by a placeholder in the same stretch of text binds nothing.
- Every reader that renders a reading uses it:
  - `expandReading`: the lead is printed before the player name, so every
    caller of it (the fact-type list in `Verbalizer`, query output, phase2's
    fallback) is fixed at once;
  - `FactTypeVerbalizer`: the lead is a text segment before the player
    reference;
  - `extractPredicate`: returns the predicate without the object's lead and
    the lead beside it, and the binary uniqueness and mandatory sentences
    put it after the quantifier;
  - phase2's role sentences: "some" goes before the lead;
  - phase1's mandatory sentence: `expandReading` instead of a raw replace;
  - the diagram's `renderReading`: replaced by core's `expandReading`.
- The Ossie importer stops warning about hyphen binding.

Out of scope:

- **Trailing binding** (`"{0} -word ..."`, a leading hyphen binding words
  after a placeholder to the player before it). No tracked model or fixture
  uses it (Open decision 1).
- The raw template in authoring views: the editor's model tree and the LLM
  review and context prompts show the template as written, which is the
  notation a modeller edits.
- Stored and exported text: unchanged.

## Inventory

| Area                                  | Current state                     | Verdict                              |
| ------------------------------------- | --------------------------------- | ------------------------------------ |
| `core/src/model/ReadingOrder.ts`      | `expandReading` substitutes `{n}` | `splitReading`; expand applies leads |
| `verbalization/FactTypeVerbalizer.ts` | own `{n}` parser                  | reads `splitReading`                 |
| `verbalization/constraints/sentence`  | `extractPredicate` slices text    | predicate and object lead            |
| `verbalization/constraints/phase1`    | uniqueness, mandatory sentences   | quantifier before the lead           |
| `verbalization/constraints/phase2`    | role sentences, "some X"          | "some" before the lead               |
| `diagram/src/session/modelSummary.ts` | private `renderReading`           | core `expandReading`                 |
| `formats/src/ossie/mapOssieToOrm.ts`  | warns per hyphen-bound reading    | warning removed                      |
| NORMA, Ossie writers; DDL annotation  | template verbatim                 | unchanged                            |
| editor model tree, LLM prompt context | raw template                      | unchanged                            |

## Workstreams

### 1. The parser and its readers

One PR. Acceptance:

- `splitReading` unit tests:
  - `"{0} has sale- {1}"`: text `" has "`, lead `"sale"`;
  - `"{0} has average- departure {1}"`: lead `"average departure"`;
  - `"{0} is co-owner of {1}"`: no lead (the hyphen is inside a word);
  - `"{0} smiles- "`: no lead (no placeholder follows in that stretch);
  - `"{0} has sold- {1} at {2}"`: a lead on `{1}` only.
- On the auction model, `barwise verbalize` prints "Listing has sale
  Currency" and "Each Listing has at most one sale Currency." and no line
  of its output contains a word followed by `- `.
- Over every tracked model, `barwise verbalize` output differs from today's
  only on lines whose reading contains a binding hyphen.
- The diagram summary's readings for the auction model contain "has sale
  Currency".
- The Ossie flights import no longer warns "uses hyphen binding".

Each behavioural test is watched red with the change reverted.

## Open decisions

1. **Trailing binding.** Options: (a) front binding only, as above; (b) both
   directions now. **Recommend (a)**: front binding is the form every
   tracked model and both fixture formats use; trailing binding is rarer in
   NORMA models, and adding it to the same parser later costs one more
   case, not a redesign.
2. **Where the lead goes in a constraint sentence.** Options: (a) after the
   quantifier, "Each Listing has at most one sale Currency"; (b) before it,
   "Each Listing has sale at most one Currency". **Recommend (a)**: it is
   what the notation is for, and what NORMA prints.

## Risks and testing

- **Changed verbalization.** Every model that uses the notation reads
  differently, intentionally; the corpus check bounds the change to those
  lines.
- **A hyphen that was not meant as binding.** A word ending in a hyphen
  followed by a space before a placeholder is the notation by definition;
  the corpus check lists every changed line for review.
