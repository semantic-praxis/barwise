# The rest of the validator, audited the same way

Status: Implemented (see Implementation notes)
Created: 2026-08-22
Last-updated: 2026-08-22
Tracking: barwise-834. Completes the sweep barwise-831 scoped to one
rule module and explicitly deferred for the other eight.

## Principle

The same argument as barwise-831, applied to the modules it left alone.
`enforceConformance` exists to hand the parser something the validator
will accept, so a purely structural rule with no counterpart becomes an
error the extraction cannot avoid and the eval charges 0.1 for. Five
instances of that have now been found -- constraint arity, frequency
bounds, ring players, population instances, and this one.

What changes here is the ratio. Four of the five earlier finds were real
gaps; this audit covers 51 error-severity diagnostic sites across eight
modules and turns up **one**. That is worth stating plainly, because a
reader who saw the run of four could reasonably expect a mess and would
be wrong: most of the validator is already unreachable from the
extraction path, and unreachable by construction rather than by luck.

## The enumeration

71 distinct rule ids across 92 diagnostic sites in
`core/src/validation/rules/`. `constraintConsistency` (20 sites) was
audited in barwise-831. Of the remainder, the error-severity ones group
into four kinds:

| Module                      | Errors | Reachable from extraction?                                   |
| --------------------------- | -----: | ------------------------------------------------------------ |
| `structural.ts`             |     12 | **one is** -- see below                                      |
| `joinConstraintRules.ts`    |      8 | no: nothing in `llm/src` ever builds a `joinPath`            |
| `projectRules.ts`           |      5 | no: takes an `OrmProject`; extraction produces an `OrmModel` |
| `population/structural.ts`  |      2 | one was, fixed as barwise-835; the other the parser skips    |
| `population/cardinality.ts` |      2 | no: needs `ObjectType.cardinality`, absent from the payload  |

The `population/*` modules are otherwise almost entirely **warnings**,
not errors -- a population that contradicts a constraint is reported at
the lint tier, not the error tier. That single fact is why the
population side is far less exposed than the constraint side, and it is
not obvious from reading either module alone.

Within `structural.ts`, eleven of twelve are unreachable for one shared
reason: the parser resolves every name against what it has already
built, and skips what it cannot resolve. A dangling role reference, a
subtype naming an object type that does not exist, an objectification
pointing at a missing fact type -- all are dropped before a model
exists. That is "define errors out of existence" holding across a whole
module, and it is worth recording so a future auditor does not add
eleven dead conformance checks.

## The one gap: a subtype cycle

`structural/subtype-cycle` is an error, is structural, and nothing stops
it. Both edges of `Order is-a Customer` / `Customer is-a Order` resolve
perfectly well -- each names an object type that exists and is an entity
-- so the parser builds them and the model carries a cycle.

It is decidable on the payload: `subtypes[]` is a list of name pairs,
and a cycle in a name graph needs no model. Reachable in practice too,
since a transcript describing overlapping roles ("managers are staff",
"our staff are all managers") gives a model every reason to emit both
directions.

**The edge that closes the cycle is dropped, not the whole hierarchy.**
Processing declarations in order and rejecting any edge whose addition
would close a cycle keeps every relationship declared before it, which
is both deterministic and the least destructive reading: the earlier
edges are the ones the extraction committed to first. Dropping the whole
subtype set to punish one contradictory edge would discard the correct
hierarchy along with it.

## Scope

In scope:

- When the subtype declarations contain a cycle, conformance shall drop
  the edge that closes it and record a correction.
- A subtype hierarchy without a cycle, including a deep one and a
  diamond, shall survive untouched.
- The mechanical sweep shall extend to the structural rules, so a new
  one with no counterpart fails a test rather than a sweep.

Out of scope, deferred and named:

- **Conformance checks for the eleven unreachable structural rules.**
  They are unreachable by construction. Writing them would be dead code
  that a later reader would have to disprove.
- **The join, project, and cardinality rules.** Unreachable for the
  reasons tabulated above; if the extraction vocabulary ever gains a
  join path, an object cardinality, or a project, they become live and
  this table is where to start.
- **The population warning tier.** Real cost -- warnings are 0.05 each
  -- but they are lint, not invalidity, and suppressing them in
  conformance would hide the feedback they exist to give. Pricing them
  is the barwise-813 diagnostic round's job.

## Inventory

| Area                                         | Current state               | Verdict |
| -------------------------------------------- | --------------------------- | ------- |
| `llm/src/ExtractionConformance.ts`           | No subtype-cycle check      | modify  |
| `llm/tests/ConstraintCorrespondence.test.ts` | Sweeps constraints only     | modify  |
| `core/.../rules/structural.ts`               | Correct; the reference side | none    |

## Risks and testing

- **Dropping the wrong edge.** Order-dependent by design, so the test
  asserts _which_ edge survives, not merely that the cycle is gone.
- **A self-edge.** `A is-a A` is a cycle of length one and must be
  caught by the same check rather than slipping through a
  two-node-minimum assumption.
- **A diamond is not a cycle.** Two paths from `A` to `D` is legal ORM
  and must survive; a check written with a naive visited-set would
  reject it. Tested directly.
- **A sweep that passes either way.** Verified by mutation, as
  barwise-831 and barwise-835 were.
- Full gate: `npm run build`, `test`, `lint`.

## Non-goals

- No change to any validation rule.
- No change to the scoring weights.
- No prompt change.

## Implementation notes (2026-08-22)

Shipped as specified. The audit's headline is the ratio: 51
error-severity sites across eight modules, one gap. Four of the five
earlier finds in this class were real gaps, so a reader arriving from
that run would expect a mess and would be wrong.

- **`subtype_cycle` conformance check.** Declarations are walked in
  order and an edge is dropped when its supertype already reaches its
  subtype. The test asserts _which_ edge survives, not merely that the
  cycle is gone -- dropping the other one is equally cycle-free and
  arbitrary, so a silent change of policy would otherwise pass.
- **A diamond is not a cycle**, and the check is written per edge
  rather than with one visited set across the whole walk so that it
  survives. Tested directly, because the naive implementation looks
  correct and rejects legal ORM.
- **The structural sweep asserts the outcome, not the mechanism.**
  Eleven of the twelve structural rules are stopped by the parser
  rather than by conformance; the sweep asserts no error reaches the
  model, so a later change moving responsibility between the two still
  passes while a parser that started admitting unresolved names fails.
- **Verified by mutation:** disabling the cycle check fails five tests,
  including the sweep entry.
