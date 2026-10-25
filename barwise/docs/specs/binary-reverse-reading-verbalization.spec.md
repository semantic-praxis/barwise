# A binary constraint on the role no reading names first reads the right way round

Status: Draft -- no workstream implemented

Created: 2026-10-25
Last-updated: 2026-10-25
Tracking: barwise-wsl
Touches: barwise/packages/core/src/verbalization/constraints/sentence.ts,
barwise/packages/core/src/verbalization/constraints/phase1.ts,
barwise/packages/core/src/verbalization/constraints/phase2.ts,
+barwise/packages/core/tests/verbalization/reverseReading.test.ts,
barwise/packages/core/tests/model/readingHyphenBinding.test.ts

When a binary fact type's mandatory, uniqueness or single-role frequency
constraint sits on a role that no reading names before the other role,
the verbalizer shall write the sentence from the reading as the modeller
wrote it -- "For each Customer, some Order is placed by that Customer."
-- rather than slice that reading's predicate and read it backwards.
Today, with only the reading "Order is placed by Customer" and a
mandatory on Customer, every surface prints "Each Customer is placed by
at least one Order.", which states a different fact. barwise-plq now
spills such mandatories into DDL comments and every schema export's
report, so the backwards sentence reaches users more often.

## Principle

Determinism in core holds already; the defect is in what the
deterministic output says. A verbalization is the model's own statement
in its own words, and the readings are the only words the modeller gave
for the fact type. A sentence that turns a reading round asserts a fact
the model does not contain. The fix composes from pieces that exist: the
n-ary mandatory already writes "For each Agreement, some Party ... signs
that Agreement." through `quantifiedReading`
(`nary-mandatory-verbalization.spec.md`), and the binary sentences gain
the same frame for the same situation.

## Observed today (at 4a812272)

`extractPredicate` (`verbalization/constraints/sentence.ts`) looks for a
reading naming the subject role before the object role; when there is
none, it falls back to the first reading's text between its first two
placeholders and uses it as if the subject came first. Three callers
pass the constrained role as the subject: `verbalizeBinaryUniqueness`
and `verbalizeBinaryMandatory` (`phase1.ts`) and the single-role branch
of `verbalizeFrequency` (`phase2.ts`). The fourth caller, the ring
sentence, passes roles 0 and 1 of a fact type whose two players are the
same type, where each ring statement is unchanged by reversing every
edge, so it keeps the fallback.

Over every tracked `.orm.yaml` (6,088 verbalization rows), 125
constraint sentences in 6 files take the fallback: 108 uniqueness and 17
mandatory, no frequency. Most are reference-mode uniqueness written from
"{0} has {1}" only: "Each Asset_id has at most one Asset."

## Scope

- When a binary mandatory, uniqueness or single-role frequency is on a
  role that no reading names before the other, and some reading names
  both, the verbalizer shall write "For each X, Q Y <reading> that X.",
  X the constrained role's player, Y the other's, and Q "some", "at most
  one", or the frequency bound ("at least 2", "exactly 2", "at least 1
  and at most 3").
- A lead bound by a hyphen stays with its own placeholder, after "that"
  or after Q, as every sentence builder places it
  (`reading-hyphen-binding.spec.md`).
- When a reading names the constrained role first, the sentence is
  unchanged ("Each Customer places at least one Order.").
- When no reading names both roles, the old fallback stays. That state
  cannot be loaded: `FactType` validates every reading template, which
  must name every role.

Out of scope: the ring sentence (direction-symmetric, above); plural
agreement after a number ("exactly 2 Order is placed by"), which the
forward frequency sentence already lacks ("exactly 2 Order"); and the
fact-type verbalization, which prints readings as written.

## Workstreams

### 1. The reversed sentence

`orderedPredicate` splits the ordered-reading search out of
`extractPredicate`; `forEachReading` in `sentence.ts` writes the frame
from the first reading naming both roles, through `quantifiedReading`,
which gains the quantifier for the other roles (default "some", so the
n-ary sentence is unchanged). The three callers ask `orderedPredicate`
first and use `forEachReading` when it finds nothing. Acceptance, each
pinned by a test asserting the exact sentence: a mandatory, a uniqueness
and each of the three frequency bounds on the role the only reading
names second; both sentences unchanged when a reverse reading exists and
for the role the reading names first; a hyphen-bound lead stays on its
noun; every other test in the monorepo passes; the corpus effect is
recorded here.

## Open decisions

1. **The quantifier for a mandatory.** (a) "some" (recommended): the
   n-ary mandatory writes "For each Agreement, some Customer ... signs
   that Agreement.", and the two frames should read alike. (b) "at least
   one", as the forward binary sentence says: matches the sentence a
   reader sees for the other direction, and makes the n-ary and binary
   "For each" sentences differ. Recommend (a).
2. **Frequency in scope.** (a) Include it (recommended): the same
   fallback, the same fix, three lines; the corpus has no case, so the
   tests carry it. (b) Leave it for its plural problem: the backwards
   sentence stays for a shape users can build. Recommend (a); the
   missing plural is no worse than the forward sentence's.

## Risks and testing

Measured on a prototype over every tracked `.orm.yaml`: the 125
sentences above change and no other row does; every test in core,
formats, cli, mcp, learn, llm, promptlab, diagram, dbt and code-analysis
passes, with one expectation changed: `readingHyphenBinding.test.ts`
pinned the backwards sentence ("Each Listing is sale price of at most one
Currency.") as the fallback's behaviour, and now pins the forward one
over a reading whose lead stays on its noun. A surface that compares
verbalization text across versions (a diff of `barwise verbalize`
output) sees these sentences change once.
