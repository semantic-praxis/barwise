# A binary mandatory, uniqueness or frequency sentence states the whole reading

Status: Draft

Created: 2026-10-28
Last-updated: 2026-10-28
Tracking: barwise-m1c, barwise-zx2
Plan-reviewed: b66a7f1f (code-review, pr-review)
Touches: barwise/packages/core/src/verbalization/constraints/phase1.ts,
barwise/packages/core/src/verbalization/constraints/phase2.ts,
barwise/packages/core/src/verbalization/constraints/sentence.ts,
barwise/packages/core/tests/verbalization,
barwise/packages/core/src/model/Constraint.ts,
barwise/packages/cli/tests/characterization/golden,
barwise/docs/tutorial,
barwise/docs/anki/04-verbalization.txt,
barwise/docs/anki/README.md,
barwise/trial/customers/C08-utility/personas/billing-analyst.gym.yaml,
barwise/trial/customers/C08-utility/customer.yaml,
barwise/docs/specs/binary-reverse-reading-verbalization.spec.md,
barwise/docs/release-notes/unreleased.md

When barwise verbalizes a binary mandatory, uniqueness or single-role
frequency constraint, the sentence shall state the whole reading. That
means the text before, between and after the placeholders. A frequency
sentence shall say nothing about instances that do not play the role.
Two defects break this today:

- **barwise-m1c.** The forward mandatory and uniqueness sentences keep
  only the text between the two placeholders. "{0} has {1} as primary
  doctor" reads "Each Patient has at most one Doctor." The words "as
  primary doctor" are dropped.
- **barwise-zx2.** The frequency sentence keeps the same slice, so it
  reads backwards on the role no reading names first. "Each Customer
  rates at least 1 and at most 10 Product" also says every Customer
  rates something, which a frequency does not require, and it uses a
  singular noun after a plural count.

## Principle

Determinism in core and explicit over implicit. A verbalization is the
model read back to its author, so it may not drop words the author
wrote or add a claim the constraint does not make. Both fixes build the
sentence from the parts of the whole reading, through `openingReading`
and `quantifiedReading`. Those are the helpers the n-ary mandatory
sentence and the barwise-wsl reverse sentences already use, so all
these sentences take the reading the same way.

## Observed today (at 7458ee65)

- `binarySentence` (`phase1.ts`) uses `orderedPredicate`. That keeps
  `textOf(parts.slice(s + 1, o))`, the text between the subject and
  object placeholders. A reading with no subject-before-object order
  falls back to `forEachReading`, which writes the whole first reading
  (barwise-wsl).
- `verbalizeFrequency` (`phase2.ts`) uses `extractPredicate`. That is
  the same slice, with a fallback that reads the first reading
  backwards.
- Measured over the tracked corpus with `barwise verbalize`, the
  scratchpad `verb-corpus.sh` (6,674 lines):
  - with the forward mandatory and uniqueness sentence built from the
    whole opening reading, 8 sentences change. Each gains the words it
    dropped: "Distance from center", "EntityNode as supertype", "Doctor
    as primary doctor", "Faculty as thesis advisor", and "on which at
    least one Party borrows" (today "Each LoanAccount is the Account on
    which at most one Party.", which has no verb);
  - 12 single-role frequency sentences exist, all forward. None reads
    backwards today.

## Scope

### Workstream 1: the forward sentence writes the whole reading (barwise-m1c)

- When a binary mandatory or uniqueness has a reading that opens with
  the constrained role (`openingReading`), the sentence shall be
  `Each <lead> X <rest of the reading>.`. The other placeholder is
  quantified "at least one" or "at most one", and any text after it is
  kept. Example: "Each Patient has at most one Doctor as primary
  doctor."
- When no reading opens with the role, the sentence shall be the
  `forEachReading` sentence, as today for a reading with no
  subject-before-object order.
  - This now also covers a reading where text precedes the subject
    ("In {0} ... {1}"), which today is sliced.
- `phase1.ts` stops importing `orderedPredicate`. It stays, because
  `extractPredicate` calls it and the ring sentence calls
  `extractPredicate`. The `extractPredicate` comment and the
  `sentence.ts` header are updated: ring is now the only user of the
  slice and its fallback.
- Out of scope: the ring sentence. It still slices between the
  placeholders ("No EntityNode specializes that same EntityNode." drops
  "as supertype"). It is barwise-7tx.

### Workstream 2: a frequency sentence is conditional and counts instances (barwise-zx2)

- The count phrase is `at least N`, `exactly N`, or `at least N and at
  most M`, followed by `instances of`. This avoids writing a plural the
  model does not hold. The noun is `instance of` when the last number in
  the phrase is 1 ("exactly 1 instance of", "at least 1 instance of").
- When a reading opens with the constrained role, the sentence shall be:
  `Each X that <rest, with some Y> <rest, with the count Y>.` For
  example: "Each Customer that rates some Product rates at least 1 and
  at most 10 instances of Product."
- When none does, the sentence shall be:
  `For each X, if <first reading, with that X and some Y>, then that
  holds for <count> Y.` For example: "For each Customer, if some Order
  is placed by that Customer, then that holds for exactly 2 instances
  of Order."
  - A ring's two roles are numbered, as `forEachReading` numbers them.
  - It is `forEachReading` with an optional conditional tail, not a
    second builder. Both keep one lead lookup and one numbering.
- Out of scope: frequency over several roles, and frequency on a unary
  or n-ary fact type (`verbalizeMultiRoleFrequency`,
  `verbalizeGenericFrequency`).

Each workstream is pinned by unit tests in
`core/tests/verbalization`, and each test fails on today's code:

- a reading with text after the second placeholder, for mandatory and
  uniqueness;
- a frequency in both directions, a ring frequency, exactly 1, and
  at least 1 unbounded.

The existing frequency tests in `Phase2ConstraintVerbalizer.test.ts`
assert with `toContain`. They move to the exact sentence. The
"extractPredicate uses fallback" test exercises a uniqueness, which no
longer reaches `extractPredicate`, so it moves to a ring, the one
remaining caller.

Every copy of a changed sentence is updated in the same change:

- the CLI goldens (`UPDATE_GOLDEN=1 npx vitest run characterization`),
  whose diff must be exactly the sentences above;
- the tutorial render (`npm run regen:tutorial`), held by its drift test;
- the C08 trial's `requires_verbalization` check and its
  `not_expressible` row. Those pin the deontic frequency sentence
  verbatim, and the gym matches it exactly;
- the Anki verbalization cards on frequency and the README template
  list, which say they quote the tool verbatim;
- the `FrequencyConstraint` JSDoc example;
- the barwise-wsl spec's notes on m1c and zx2, which gain "Since
  decided".

## Open decisions

1. **Forward m1c sentence: the opening reading, or keep
   `orderedPredicate` and append the outer text?**
   - (a) The opening reading through `quantifiedReading` (recommended).
     It is the helper the other sentences use, and it handles leads,
     repeats and flush placeholders.
   - (b) Extend `orderedPredicate` with the text before and after. This
     keeps "a reading with the subject before the object" as the forward
     test. But text before the subject has no place in "Each X ...".

   Recommend (a).
2. **The frequency frame.**
   - (a) "Each X that ... some Y ... <count> instances of Y", and
     "For each X, if ..., then that holds for <count> Y" (recommended).
     It is conditional, as the constraint is, and needs no plural.
   - (b) Keep "Each X ... <count> Y" and pluralize Y. That needs a
     plural the model does not store, and it still implies a mandatory.

   Recommend (a). The cost is a longer sentence. On the 12 corpus
   frequencies the conditional clause repeats the reading once.

## Risks and testing

Verbalization feeds every surface and every exported constraint spec:
`buildConstraintSpec` embeds it in the DDL comments, and in the dbt,
OpenAPI, Avro and Ossie reports. A frequency is always spilled there, so
a user's generated files change text on the next export. That is the
intended change, and the release note says so. The checks that only the
intended sentences change are the golden diff, the tutorial drift test
and the corpus measurement.
