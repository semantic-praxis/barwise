# A binary constraint on the role no reading names first reads the right way round

Status: Implemented

Created: 2026-10-25
Last-updated: 2026-10-25
Tracking: barwise-wsl
Plan-reviewed: a18ab1ec (code-review, pr-review)
Touches: barwise/packages/core/src/verbalization/constraints/sentence.ts,
barwise/packages/core/src/verbalization/constraints/phase1.ts,
+barwise/packages/core/tests/verbalization/reverseReading.test.ts,
barwise/packages/core/tests/verbalization/naryMandatory.test.ts,
barwise/packages/core/tests/model/readingHyphenBinding.test.ts

When a binary fact type's mandatory or uniqueness constraint sits on a
role that no reading names before the other role,
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
(`nary-mandatory-verbalization.spec.md`), and the binary sentences share
that frame, one helper for both, for the same situation.

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

`quantifiedReading` writes "some Y" for every placeholder other than the
constrained role's, and `validateReadingTemplate` accepts a placeholder
repeated in one reading, so "{1} owns {0} via {1}" gives "some Currency
owns that Listing via some Currency": two Currencies where the reading
has one.

Over every tracked `.orm.yaml` (6,088 verbalization rows), 125
constraint sentences in 6 files take the fallback: 108 uniqueness and 17
mandatory, no frequency. Most are reference-mode uniqueness written from
"{0} has {1}" only: "Each Asset_id has at most one Asset."

## Scope

- When a binary mandatory or uniqueness is on a role that no reading
  names before the other, the verbalizer shall write "For each X, Q Y
  <first reading> that X.", X the constrained role's player, Y the
  other's, and Q "some" or "at most one". The first reading names both
  roles, since `FactType` validates every reading template, which must
  name every role, and it names the other role first, since none names
  the constrained role first.
- A lead bound by a hyphen stays with its own placeholder, after "that"
  or after Q, as every sentence builder places it
  (`reading-hyphen-binding.spec.md`).
- When a reading names the constrained role first, the sentence is
  unchanged ("Each Customer places at least one Order.").
- When a reading repeats a placeholder, the verbalizer shall write
  "that Y" after its first mention, in every sentence `quantifiedReading`
  writes: this one, both n-ary mandatory sentences, and the arms of a
  disjunctive mandatory or exclusion over several fact types
  (`spanningArm`, `phase2.ts`, which changes no line of its own). No
  tracked model repeats a placeholder.

Out of scope: the ring sentence (direction-symmetric, above); the
single-role frequency sentence, which reads backwards the same way
(barwise-zx2: the frame would make the counted noun the subject of a
singular verb, "exactly 2 Order is placed by", and "For each X" asserts
that every X plays the role, which a frequency does not; since decided
in `binary-constraint-sentences.spec.md`); and the fact-type
verbalization, which prints readings as written.

## Workstreams

### 1. The reversed sentence

`orderedPredicate` splits the ordered-reading search out of
`extractPredicate`; `forEachReading` in `sentence.ts` writes the frame
from the first reading through `quantifiedReading`, which gains the
quantifier for the other roles and the repeat rule. The n-ary mandatory's
"For each" branch calls `forEachReading` with "some", so the two frames
are one. The two binary callers ask `orderedPredicate` first and use
`forEachReading` when it finds nothing. Acceptance, each pinned by a test
asserting the exact sentence: a mandatory and a uniqueness on the role
the only reading names second; both unchanged when a reverse reading
exists and for the role the reading names first; a hyphen-bound lead
after Q and after "that"; a repeated placeholder; every other test in
the monorepo passes; the corpus effect is recorded here.

## Implementation notes

- Implementation review changed three things the plan did not name:
  - When two roles of the fact type have the same player, the "For each"
    frame numbers them by role position, as the ring sentence does:
    "For each Bid2, at most one Bid1 responds to that Bid2." Without the
    numbers, "that Bid" reads as the Bid just named, which is a different,
    reflexive fact.
  - The constrained role's hyphen-bound lead also goes in the head ("For
    each draft Agreement, ... that draft Agreement"), as the opening form
    writes "Each new Customer". This applies to the n-ary sentence too,
    and one n-ary expectation changes with it.
  - The binary uniqueness and mandatory builders are now one function,
    differing only in their two quantifiers.
- The corpus effect is unchanged at 125 sentences in 6 files. Four of them
  read differently from the plan: the two "Bid responds to Bid" rows now
  carry the numbers, and the two "has child SimpleItem" rows carry the lead
  in the head. Every suite passes, barwise-vscode included (133 tests).
- Declined: a reading that opens with text before its first placeholder
  ("the {0} is placed by {1}") gives "the some Order". The n-ary sentence
  has always done this, and an article belongs in a hyphen-bound lead.
- Filed: the forward sentence drops reading text outside its two
  placeholders (barwise-m1c). That predates this change, but now the two
  directions can differ. Since decided: `binary-constraint-sentences.spec.md`.

## Open decisions

1. **The quantifier for a mandatory.** (a) "some" (recommended): the
   n-ary mandatory writes "For each Agreement, some Customer ... signs
   that Agreement.", and the two frames should read alike. (b) "at least
   one", as the forward binary sentence says: matches the sentence a
   reader sees for the other direction, and makes the n-ary and binary
   "For each" sentences differ. Recommend (a).
2. **Frequency.** (a) Leave it to barwise-zx2 (recommended): the frame
   that fixes its direction breaks its agreement and implies a mandatory,
   and the corpus has no case. (b) Include it: fixes the direction now,
   pinning two new defects as tested output. Recommend (a).

## Risks and testing

Measured on a prototype over every tracked `.orm.yaml`: the 125
sentences above change and no other row does; every test in core,
formats, cli, mcp, learn, llm, promptlab, diagram, dbt and code-analysis
passes, with one expectation changed: `readingHyphenBinding.test.ts`
pinned the backwards sentence ("Each Listing is sale price of at most one
Currency.") as the fallback's behaviour, and now pins "For each Listing,
at most one Currency is that sale price of Listing." over the same
reading, whose lead "sale price of" stays bound to Listing by the
binding rule. A surface that compares
verbalization text across versions (a diff of `barwise verbalize`
output) sees these sentences change once.
