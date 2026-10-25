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
+barwise/packages/core/tests/verbalization/hyphenBindingCorpus.test.ts,
barwise/packages/diagram/src/session/modelSummary.ts,
barwise/packages/diagram/tests/session/modelSummary.test.ts,
barwise/packages/formats/src/ossie/mapOssieToOrm.ts,
barwise/packages/formats/tests/OssieImportFormat.test.ts,
barwise/docs/specs/ossie-ontology-format.spec.md

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
them (`ossie-ontology-format.spec.md`, Open decision 4).

## Observed today (at 78c4103c)

- Readers that render a template, each substituting `{n}` in the text as
  written: `expandReading` (core root export; called by the fact-type list
  in `Verbalizer`, query output and phase2's fallback),
  `FactTypeVerbalizer`'s template parser, `extractPredicate` (callers: the
  binary uniqueness and mandatory sentences in phase1, the ring sentences
  and binary frequency in phase2), phase2's `spanningArm` ("some X"),
  phase2's `unaryPredicate` (cardinality), phase1's non-binary mandatory
  sentence (a raw `replace`), and the diagram's `renderReading` (a private
  copy of `expandReading`).
- phase1's non-binary mandatory sentence writes the constrained player into
  every slot ("Each Agreement must: Agreement on behalf of Agreement signs
  Agreement."). That is its own defect, barwise-ygy; a golden and a core
  test pin it, and this spec leaves the substitution as it is.
- The template is stored and serialized as written; NORMA and Ossie export
  write it verbatim, which is what both formats expect.

## Scope

In scope:

- One parser, `splitReading(template)` in `model/ReadingOrder.ts`,
  exported from the root: the template as alternating text and role parts,
  where each role part carries its **lead** -- the bound words before it --
  and the text before it no longer contains them; plus whether any hyphen in
  the template was left unbound.
- **The binding rule.** In the text between the previous placeholder (or
  the start) and placeholder `{n}`, the first token that ends in a letter or
  digit followed by a hyphen and then whitespace begins the lead, which runs
  to `{n}`. The lead drops that hyphen and collapses its whitespace to
  single spaces; it is printed before the player's name with one space. A
  hyphen inside a word ("co-owner"), a dash standing alone ("reports to -
  {1}"), or a hyphen with no placeholder after it in the same stretch binds
  nothing, and the template then has an unbound hyphen.
- **The placement rule**, one sentence for every constraint shape: a lead
  goes immediately before its own player's name, after any quantifier or
  determiner in front of that name ("at most one sale Currency", "exactly 2
  sale Currency", "that same child Item", "some sale Currency"). A lead on
  the subject's placeholder goes before the subject's name.
- Every reader in Observed uses `splitReading`:
  - `expandReading` prints each lead before its name, fixing its callers;
  - `FactTypeVerbalizer` emits the lead as text before the reference;
  - `extractPredicate` returns the predicate and the subject's and object's
    leads, and every caller (phase1 uniqueness and mandatory, phase2 ring
    and frequency) places them by the rule;
  - `spanningArm` selects a reading whose first role part is the role (after
    any lead), and puts "some" before the other players' leads;
  - `unaryPredicate` returns the text after the placeholder, and the
    cardinality sentence puts the lead before the type name;
  - phase1's non-binary mandatory sentence keeps its substitution and drops
    the binding hyphen, so its text changes only where a lead exists;
  - the diagram's `renderReading` is replaced by core's `expandReading`.
- The Ossie importer warns only when `splitReading` reports an unbound
  hyphen, instead of on any `word- `; `ossie-ontology-format.spec.md` Open
  decision 4 records the change.

Out of scope:

- **Trailing binding** (`"{0} -word ..."`). No tracked model or fixture uses
  it (Open decision 1); such a hyphen is reported as unbound.
- The raw template in authoring views: the editor's model tree and the LLM
  review and context prompts show the template as written.
- barwise-ygy (above), and stored or exported text.

## Inventory

| Area                                  | Current state                      | Verdict                                 |
| ------------------------------------- | ---------------------------------- | --------------------------------------- |
| `core/src/model/ReadingOrder.ts`      | `expandReading` substitutes `{n}`  | `splitReading`; expand applies leads    |
| `verbalization/FactTypeVerbalizer.ts` | own `{n}` parser                   | reads `splitReading`                    |
| `constraints/sentence.ts`             | `extractPredicate` slices text     | predicate plus subject and object leads |
| `constraints/phase1.ts`               | uniqueness, mandatory sentences    | leads by the placement rule             |
| `constraints/phase2.ts`               | ring, frequency, arms, cardinality | leads by the placement rule             |
| `diagram/src/session/modelSummary.ts` | private `renderReading`            | core `expandReading`                    |
| `formats/src/ossie/mapOssieToOrm.ts`  | warns on any `word- `              | warns on an unbound hyphen only         |
| NORMA, Ossie writers; DDL annotation  | template verbatim                  | unchanged                               |
| editor model tree, LLM prompt context | raw template                       | unchanged                               |

## Workstreams

### 1. The parser and its readers

One PR. Acceptance:

- `splitReading` unit tests:
  - `"{0} has sale- {1}"`: text `" has "`, lead `"sale"` on `{1}`;
  - `"{0} has average-  departure {1}"`: lead `"average departure"`;
  - `"{0} is co-owner of {1}"`, `"{0} reports to - {1}"`: no lead, no
    unbound hyphen for the first, an unbound one for the second;
  - `"{0} smiles- "`: no lead, an unbound hyphen;
  - `"{0} has sold- {1} at {2}"`: a lead on `{1}` only.
- Sentence tests on a fact type `"{0} has sale- {1}"`: binary uniqueness,
  mandatory and frequency print the lead after the quantifier; a ring on
  `"{0} has child- {1}"` prints "that same child Item"; an exclusion arm
  prints "some sale Currency"; a reading `"sale- {0} is priced in {1}"` is
  still chosen for its arm.
- A standing corpus test, `hyphenBindingCorpus.test.ts`: every tracked model
  under `docs/`, `examples/` and `packages/promptlab/evals/` that uses the
  notation verbalizes with no line containing a letter or digit followed by
  `- `. It fails if any reader reintroduces the raw hyphen.
- The diagram summary of a hyphen-bound fact type reads "has sale Currency".
- The Ossie flights import warns about no hyphen; a reading with an unbound
  hyphen still warns.

Each behavioural test is watched red with its change reverted.

## Open decisions

1. **Trailing binding.** Options: (a) front binding only; (b) both
   directions now. **Recommend (a)**: front binding is the form every
   tracked model and both fixture formats use; the parser reports a
   trailing hyphen as unbound, and adding the case later is one more branch
   in one function.
2. **Where a lead goes in a constraint sentence.** Options: (a) before its
   own player's name, after the quantifier; (b) where the reading puts it,
   before the quantifier. **Recommend (a)**: it is what the notation is for
   and what NORMA prints.

## Risks and testing

- **Changed verbalization.** Every model that uses the notation reads
  differently, intentionally; other text is unchanged, which the existing
  verbalization tests and the clinic golden pin.
- **A reading that falls back to the wrong direction.** When a binary has no
  reading in the needed order, `extractPredicate` already slices the first
  reading regardless of direction; the leads follow their own placeholders,
  so the hyphen goes but the sentence's direction problem stays, as today.
