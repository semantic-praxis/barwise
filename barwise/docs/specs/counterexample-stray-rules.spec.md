# A counterexample answers one question, and its filler values answer none

Status: Implemented
Created: 2026-09-11
Last-updated: 2026-09-11
Tracking: barwise-995. Continues barwise-958 (the forbidding side read the
enumeration and ignored ranges), barwise-959 (the admitting side did the
mirror of it), and barwise-945 (whose new value-type rules made a third
layer visible). Leaves barwise-1017 (contradictory value types are a model
error nothing reports), barwise-1014 (the arbitrary builds join
constraints no population satisfies) and barwise-1015 (the minter knows
what a role admits, not what the tuple owes).

In one sentence: a counterexample's filler values must clear every domain
that governs where they land -- all three layers of each role and all the
roles one value occupies -- because consulting the layers one at a time
is what has produced this same defect three times running.

## Principle

**Define errors out of existence**, and **the shadow and the property**.

A counterexample is a probe: "here is a population your model forbids,
and here is the rule that forbids it." Its worth is that it demonstrates
ONE thing. A probe whose filler values break a second rule is telling
the modeller two things and labelling them as one, and the modeller has
no way to tell which part of the population is the point.

Minting those filler values is one question -- _what may sit in this
role_ -- and it was answered three times, by three functions, each
unaware of the others' answers. `mintValue` tried the role's own value
constraint, then the player's, then the player's data type, and returned
the first that produced anything. It never showed that answer to the
other two. So a value type declaring `decimal` and enumerating
`{v1, v2}` over a range of "at most 10" minted `v1`: admitted by its own
enumeration, rejected by its own data type, when `10` satisfies both.

That is the shape barwise-959 fixed for the role layer and barwise-945
then re-exposed one layer out. Fixing it layer by layer is what
guarantees a fourth occurrence; asking once, of everything that applies,
is what ends it.

## The reading

The instrument collects EVERY (constraint kind -> stray rule) pair over
`arbOrmModel()` at the law's own `SEED` and `RUNS`, rather than failing
on the first, so the families can be counted. Denominators first,
because a sweep reporting zero strays over zero counterexamples is
measuring nothing:

|                         | before | after |
| ----------------------- | ------ | ----- |
| models                  | 250    | 250   |
| counterexamples         | 252    | 252   |
| tripped their own rule  | 252    | 252   |
| local stray pairs       | 57     | 56    |
| local stray occurrences | 153    | 123   |

barwise-995's title records 35 pairs. That number is stale: it was taken
before barwise-945 added `population/value-type-data-type-violation` and
`population/value-type-domain-violation`, and the honest re-measurement
is 98 total pairs, of which 57 are local in the sense below.

### The axis the issue proposed does not separate the families

barwise-995 split the strays by CLAUDE.md's present-data / absent-data
axis, on the theory that absent-data strays are structural (a partial
population cannot satisfy a mandatory rule) while present-data strays
are the probe's own doing. Derived from `ABSENT_DATA_RULES` rather than
hand-listed, that split gives 72 present-data pairs and 26 absent-data
ones -- and the 72 are dominated by the same structural problem:

```
5  subset -> population/equality-violation
     "tuple [T4#1] in roles [ft1r0] has no match in roles [ft0r0]"
3  ring -> population/subset-violation
     "tuple [T1#1] in roles [ft0r0] has no match in roles [ft2r0]"
```

Those rules read populations directly, so they are present-data by the
CLAUDE.md test, and they fire for exactly the reason the absent-data
rules do: the counterexample populated `ft1` and deliberately left `ft0`
empty. Present-data-ness is a shadow of the property, and it diverges
precisely on constraints that relate two fact types.

**The property is locality**: does the rule's verdict depend on a fact
type the counterexample chose not to populate? A counterexample is a
partial population by construction, so a constraint with a role outside
its fact types is asking a question the counterexample does not answer,
and no filler value can change the answer. Splitting on that instead
gives 57 local pairs and 50 non-local ones, and the non-local side is
now homogeneous: object cardinality, and the set-comparison and join
constraints that span fact types.

The classifier is derived, not listed: `roleIdsOf(c)` already answers
"which roles does this constraint reference", so a kind added to the
metamodel is classified by the same code that classifies the rest.

## What changes

**WS1: one question, asked once.** `mintValueForAll(placements, model,
index)` takes every role a value will occupy, gathers every domain
governing each of them, and returns the first candidate satisfying the
conjunction. `mintValue` is the one-placement case.

Two axes, and both were unchecked:

- Along the layers: a role is governed by up to three domains at once.
  `allowedValueCandidates` in `model/valueDomain.ts` now offers a
  domain's candidates without filtering by that domain, so the caller
  can apply the conjunction; `mintAllowedValue` is that list filtered by
  its own predicate, which is its previous behaviour stated once.
- Across roles: an exclusion, exclusive-or, subset or equality probe
  puts ONE value in several roles, and a mandatory or disjunctive
  probe puts it in an anchor role in a different fact type. Those roles
  need not share a player. `valueInAllRoles`, `forMandatory` and
  `forDisjunctive` now mint against every placement rather than the
  first.

The fallback is reached only when no candidate clears everything, which
means the placements are jointly contradictory -- an enumeration whose
members are not of the declared data type admits nothing at all, and two
roles with disjoint player domains share no value. It then mints what it
always did, narrowest layer first, leaving the contradiction visible
rather than hiding it behind a value chosen for no reason.

**WS2: the law ratchets on what remains.** The law asserted only that
each counterexample trips its own rule. It now also asserts, over the
same models:

- every local stray's rule id is one of the ids the baseline names (a
  new rule straying fails),
- every id the baseline names still strays (a fixed one fails until its
  row is removed),
- the local stray occurrence count equals the baseline's exactly (both
  directions, so the number can only come down deliberately).

That is the shape `audit:duplication` and `audit:rubric` already use,
and it is what makes barwise-995's "the exclusion list is not
open-ended" true: the non-local exclusion is derived from `roleIdsOf`,
and everything else is enumerated with its reason.

The baseline is keyed to rule ids and a count, NOT to the 56
(kind -> rule) pairs. Pairs would be a stronger assertion and a worse
artifact: any future change to `arbOrmModel` reshuffles all 56 rows, and
a contributor facing 56 diff lines regenerates the baseline rather than
reading it, which is the ratchet-silencing failure `pr-review` names.
Rule ids survive a reshuffle; the count still forces the number down.

## What does not change

The residue is real and is filed, not fixed here:

- **Jointly contradictory models** (barwise-1017): a value type
  declaring `integer` and enumerating `{v3, v1, v2}` admits nothing, so
  no minted value can avoid `value-type-data-type-violation`. This is a
  MODEL error that nothing reports -- the sibling of barwise-945 that
  barwise-995 predicted -- and the fix is a validation rule, not a
  better minter.
- **Degenerate join constraints** (barwise-1014): `arbOrmModel`
  generates join exclusions whose two operands are the same path with
  the same projection, which any populated tuple violates.
- **Sibling-role constraints within the probed fact type**
  (barwise-1015): ring, frequency, value-comparison and unary-role
  cardinality still stray because `mintValueForAll` knows what a role
  admits but not what the fact type's OTHER constraints require of the
  tuple as a whole -- distinct values under irreflexivity, ordered ones
  under a value comparison. This is barwise-995's family 2 as it
  survives the re-measurement, and it is the next tractable piece.

Non-local strays are excluded rather than filed, because there is
nothing to file: closing them needs a globally consistent population,
which is constraint solving and not counterexample generation.

## Verification

- `npm run build` and the full `@barwise/core` suite from
  `packages/core`.
- The law itself is the acceptance test, and it was watched red before
  green: the baseline count was set to 122 and to 124 and the law failed
  each way, and a rule id was removed from the baseline and it failed
  again.
- `npm run ci:local` before the push.
