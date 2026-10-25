# Readings bind hyphenated words to the role player that follows

Status: Implemented -- WS1

Created: 2026-10-25
Last-updated: 2026-10-25
Tracking: barwise-iiw
Plan-reviewed: c2a093be (code-review, pr-review)
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
  and objectification sentences in `Verbalizer`, query output and phase2's
  join-path chains),
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
- **The binding rule.** A _binding hyphen_ is a hyphen that directly
  follows a letter or digit (in any script) and is followed by whitespace
  (`sale- {1}`). A hyphen flush against a placeholder (`non-{1}`) is a
  prefix compound and stays as written; one at the end of the template
  (`smiles-`) is reported as unbound. In the text between the previous
  placeholder (or the start) and placeholder `{n}`, the first token ending in
  a binding hyphen begins the lead, which runs to `{n}`. The lead drops every
  binding hyphen in it and collapses its whitespace to single spaces; it is
  printed before the player's name with one space.
- **Unbound hyphens.** A binding hyphen the rule does not consume (one with
  no placeholder after it in the same stretch, `"{0} smiles- "`), and a
  hyphen that directly follows whitespace and precedes a letter (the
  trailing form, `"{0} -word"`, wherever it appears, a lead included), are
  reported as unbound. A minus sign before a number (`balance -5`) is text. A hyphen
  inside a word (`co-owner`) or a dash standing alone (`reports to - {1}`)
  is ordinary text, neither bound nor reported.
- **The placement rule**, for every constraint shape: a lead goes
  immediately before the name in its own role slot, after any quantifier or
  determiner in front of that name ("at most one sale Currency", "exactly 2
  sale Currency", "some sale Currency"). In a ring sentence each clause
  places the leads by role slot, whichever instance name fills the slot
  ("No Item has that same child Item"; "If Item1 has child Item2 then Item2
  does not have child Item1"). A lead on the subject's slot goes before the
  subject's name.
- **When no reading has the needed direction**, `extractPredicate` already
  slices the first reading as written; it then returns that text with its
  binding hyphens removed and no leads, so the sentence reads as today
  without the hyphen, and no lead moves onto the wrong noun.
- Every reader in Observed uses `splitReading`:
  - `expandReading` prints each lead before its name, fixing its callers;
  - `FactTypeVerbalizer` emits the lead as text before the reference;
  - `extractPredicate` returns the predicate and the subject's and object's
    leads, and every caller (phase1 uniqueness and mandatory, phase2 ring
    and frequency) places them by the rule;
  - `spanningArm` keeps its selection -- a reading whose text before the
    role's placeholder is empty -- and also accepts one where that text is
    exactly a lead, which it omits, since the caller prints the shared
    subject once; it puts "some" before the other players' leads;
  - `unaryPredicate` returns the text after the placeholder, its fallback
    strips the lead and binding hyphens, and the cardinality sentence puts
    the lead before the type name;
  - phase1's non-binary mandatory sentence keeps its substitution and drops
    the binding hyphen, so its text changes only where a lead exists;
  - the diagram's `renderReading` is replaced by core's `expandReading`.
- The Ossie importer warns only when `splitReading`, run on the converted
  template (after named placeholders become `{n}`), reports an unbound
  hyphen, instead of on any `word- ` in the raw pattern; `ossie-ontology-format.spec.md` Open
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
  - `"{0} has big- red- {1}"`: lead `"big red"`;
  - `"{0} is a non-{1}"`: no lead, nothing unbound ("non-Smoker");
  - `"{0} has café- {1}"`: lead `"café"`;
  - `"{0} has balance -5 below {1}"`: nothing unbound;
  - `"{0} is co-owner of {1}"`, `"{0} reports to - {1}"`: no lead, nothing
    unbound;
  - `"{0} smiles- "`, `"{0} -word {1}"`: no lead, an unbound hyphen;
  - `"{0} has sold- {1} at {2}"`: a lead on `{1}` only.
- Sentence tests on a fact type `"{0} has sale- {1}"`: binary uniqueness,
  mandatory and frequency print the lead after the quantifier; rings on
  `"{0} has child- {1}"` print "that same child Item" (irreflexive) and
  "has child Item2 then Item2 does not have child Item1" (asymmetric); an
  exclusion arm prints "some sale Currency"; a reading `"sale- {0} is priced
  in {1}"` is chosen for its arm with the lead omitted, and `"the {0} drives
  {1}"` is still not chosen; a binary with only `"{1} is sale- price of {0}"`
  verbalizes a uniqueness on role 0 as today minus the hyphen; a unary
  `"active- {0}"` cardinality names neither `active-` nor an empty role.
- Query: `describe` of a hyphen-bound fact type prints "has sale Currency".
- A standing corpus test, `hyphenBindingCorpus.test.ts`: every tracked model
  under `docs/`, `examples/` and `packages/promptlab/evals/` that uses the
  notation verbalizes with no binding hyphen left in any line (the binding
  rule's own definition, applied to the output), and every reading in those
  models has nothing unbound. It fails if any reader reintroduces the raw hyphen.
- The diagram summary of a hyphen-bound fact type reads "has sale Currency".
- The Ossie flights import warns about no hyphen; a reading with an unbound
  hyphen still warns.

Each behavioural test is watched red with its change reverted.

## Implementation notes

- **Acceptance measured.** `tests/model/readingHyphenBinding.test.ts` (the
  parser, every sentence shape, query and fact-type verbalization),
  `tests/verbalization/hyphenBindingCorpus.test.ts` (five tracked models),
  the diagram summary test and the Ossie import tests. Watched red, one
  mutation each: `expandReading` without leads; the uniqueness, frequency,
  ring, arm, unary and fact-type parser leads dropped; the fallback given
  leads; the diagram's raw substitution; the Ossie importer's old regex.
  Each failed its own test. The corpus test failed on all five models with
  main's `FactTypeVerbalizer` restored.
- **Corpus diff.** `barwise verbalize` over every tracked model, before and
  after: five files change, every changed line contained a binding hyphen,
  and no line of the new output contains one.
- **Lead text rather than a new segment kind.** The lead is a text segment
  before the player reference, so the structured verbalization (and every
  surface that renders it) needs no new segment type.
- **Code review tightened the rule.** A hyphen flush against a
  placeholder no longer binds (it read "non-Smoker" as "non Smoker"); a word
  is a letter or digit in any script; the trailing form needs a letter after
  the hyphen, so a minus sign is text, and it is reported inside a lead too.
  The patterns are built from one character class, the corpus test imports
  the parser's own `containsBindingHyphen` rather than a copy, and it fails
  when a model that uses the notation stops loading. `Predicate` places its
  own leads (`subject`, `object`), so a new sentence builder cannot drop
  one by writing only the predicate text.
- **The fallback** joins its text and the second placeholder's lead with
  single spaces ("has child at most one GroupItem"), since the text between
  two placeholders ends in whitespace.

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
