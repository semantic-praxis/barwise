# The rules that judge by absent data say so in their signature

Status: Implemented (see Implementation notes)
Created: 2026-09-08
Last-updated: 2026-09-08
Tracking: barwise-938 (WS4 of `core-model-laws.spec.md`, whose last open
decision this resolves)

In one sentence: five population rules judge a model by what its data
does NOT contain, they each fetch the closed-world object universe for
themselves, and the sample-population law therefore has to restate which
five they are -- so the universe becomes a parameter and the list
becomes a typed table the law reads.

## Principle

**Explicit over implicit**, with the copy removed rather than guarded.

`core-model-laws.spec.md` WS4 states a law: adding a SAMPLE population
to a model must not make a rule that judges by absent data fire. A
sample is explicitly not evidence about the world -- `buildObjectUniverse`
skips it -- so it can satisfy an obligation and never create one.

To state that law you need the set of rules that read the universe. The
spec offered three ways to know it: a marker each rule module exports
(A), an enumeration in the test registered in `parity.manifest.json`
(B), or a stronger law that needs no set (C). All three accept that the
set is a copy and argue about how to guard it.

The fourth way removes the copy. A rule that reads the universe takes it
as a parameter; the dispatcher builds it once and passes it; the rules
that take it are a typed list in production, and the law calls exactly
that list. There is nothing left to restate, so there is nothing to
drift.

It is also faster and more honest about the model: `buildObjectUniverse`
walks every population of every fact type and is called seven times per
validation today, each call rebuilding the same map.

## Which rules, and which are deliberately not (resolved: five, by measurement)

Five exported checks call `buildObjectUniverse`:
`checkMandatoryViolations`, `checkDisjunctiveMandatoryViolations`,
`checkSpanningExclusiveOrViolations`,
`checkObjectCardinalityViolations` and `checkJoinPathViolations`.

`checkUnaryRoleCardinalityViolations` deliberately does not, and the
difference is exactly the point. It counts through `valuesPlayedInRole`,
which reads EVERY population including samples, so a sample population
can push a unary-role count past its maximum and create a diagnostic.
That is either a defect or a deliberate reading of "how many things play
this role in the data I was shown"; either way it is outside this
change, which is why the law's set is the rules that judge by ABSENCE
rather than every population rule. Filed separately with the
measurement.

Two exported helpers -- `mandatoryViolationsFor` and
`disjunctiveMandatoryViolationsFor` -- keep building the universe
themselves. They are called by `constraintEnforcement.ts` with a model
and one constraint, have no dispatcher to receive a universe from, and
are not rules the law runs.

## Scope

In scope, stated as requirements:

- When a population rule judges by the object universe, it shall take
  that universe as a parameter rather than building it.
- When the population dispatcher runs, it shall build the universe once
  and pass it to each such rule.
- When a rule is added to or removed from the universe-reading list, the
  type of that list shall reject a rule with the wrong signature.
- When any module under `rules/population/` other than the two named
  helpers imports `buildObjectUniverse`, a test shall fail.
- When a sample population is added to any generated model, the
  diagnostics produced by the universe-reading rules shall not grow.

Out of scope: `checkUnaryRoleCardinalityViolations`'s reading of sample
data; any change to what a rule reports; any public API change.

## Inventory

| Module                                     | Current state                                          | Verdict                                           |
| ------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------- |
| `validation/rules/population/shared.ts`    | `buildObjectUniverse(model): Map<string, Set<string>>` | gains the `ObjectUniverse` type                   |
| `population/mandatory.ts`                  | two checks and two `*ViolationsFor` helpers build it   | the two CHECKS take it; the helpers keep building |
| `population/spanning.ts`                   | `checkSpanningExclusiveOrViolations` builds it         | takes it                                          |
| `population/cardinality.ts`                | `checkObjectCardinalityViolations` builds it           | takes it                                          |
| `population/joinPath.ts`                   | `checkJoinPathViolations` builds it inside a loop      | takes it                                          |
| `validation/rules/populationValidation.ts` | calls 21 checks, each with `(model)`                   | builds the universe once; gains the table         |
| `validation/constraintEnforcement.ts`      | calls the two `*ViolationsFor` helpers                 | untouched                                         |
| `core/tests/laws/sample.law.test.ts`       | does not exist                                         | new: the law                                      |
| `core/tests/arbitraries/model.ts`          | `arbOrmModel`, no population-for-a-model arbitrary     | gains `arbSamplePopulationFor`                    |
| `parity.manifest.json`                     | no row for the absent-data set                         | untouched: the copy is removed, not registered    |

The `parity.manifest.json` row is the one the spec's Option B would
have added. Removing the copy is why it is not needed, and the empty
row is the evidence for that claim rather than an omission.

## Target architecture

```ts
// population/shared.ts
/** Every value that appears in a NON-sample population, by type id. */
export type ObjectUniverse = ReadonlyMap<string, ReadonlySet<string>>;

// populationValidation.ts
/** A rule that judges a model by what its non-sample data does not contain. */
export type UniverseRule = (
  model: OrmModel,
  universe: ObjectUniverse,
) => Diagnostic[];

/**
 * The rules that judge by ABSENT data. A sample population must not make
 * one of these fire -- that is `sample.law.test.ts`, which reads this
 * list rather than restating it.
 */
export const UNIVERSE_RULES = [
  checkMandatoryViolations,
  checkDisjunctiveMandatoryViolations,
  checkSpanningExclusiveOrViolations,
  checkObjectCardinalityViolations,
  checkJoinPathViolations,
] as const satisfies readonly UniverseRule[];

/** The subset whose every diagnostic is derived from absence. */
export const ABSENT_DATA_RULES = [
  checkMandatoryViolations,
  checkDisjunctiveMandatoryViolations,
  checkObjectCardinalityViolations,
] as const satisfies readonly (typeof UNIVERSE_RULES)[number][];
```

Two lists, not one, and the second is typed as a subset of the first so
a rule can only be in it if it is also in the first. Reading the
universe and judging BY ABSENCE turned out not to be the same property;
see the implementation notes for how that was found.

`as const satisfies` is what makes the list a claim rather than a
convention: a rule that does not take the universe cannot be in it, and
a rule that takes it and is left out never receives one, so it does not
compile at its call site either.

That closes one direction. The other -- a NEW rule that quietly calls
`buildObjectUniverse` itself instead of joining the list -- is not a
type question, so it gets a source scan: a test asserts that no module
under `rules/population/` imports `buildObjectUniverse` except
`mandatory.ts`, whose two enforcement helpers legitimately do.

## Alternatives considered

The three the parent spec listed, all of which keep the copy:

- **A marker each rule module exports**, read by the test. Production
  code carrying a field that exists only for a test, and a rule that
  forgets the marker is invisible.
- **Enumerate in the test, register in `parity.manifest.json`.** The
  parent spec's recommendation, and a good one when a copy is
  unavoidable. Here it is avoidable.
- **Assert the stronger law** -- a sample adds no diagnostic at all --
  and generate tuples that satisfy every present-data constraint. That
  is a generator problem of a different order, and the law would be
  about the generator's cleverness rather than the rules.

## Workstream: the universe is a parameter and the list is a table

One workstream: thread the parameter, add the table and the import
scan, add `arbSamplePopulationFor` and the law.

Acceptance, in EARS form: when the population dispatcher validates a
model, it shall call `buildObjectUniverse` exactly once; when a sample
population is added to any of 250 generated models, the count of
diagnostics from `UNIVERSE_RULES` shall not increase; and when a rule
module other than `mandatory.ts` imports `buildObjectUniverse`, the
import scan shall fail. The full core suite shall pass unchanged.

## API and migration impact

- No public API change: none of these functions is exported from
  `@barwise/core`'s index.
- `buildObjectUniverse` is called once per validation instead of seven
  times. No output changes.
- The five rule signatures change. All call sites are in one file.

## Risks and testing

- **The risk is a silent behaviour change** while threading a
  parameter through five rules. The whole core suite is the guard, and
  a rule that received the wrong universe would fail its own fixtures.
- **A law that cannot fail** is the second risk: if the generated
  models carry no populations, the sample law asserts nothing. The
  generator's population coverage is counted, and the count is asserted
  as a floor, following `generator-coverage-floors.spec.md`.
- The import scan is a source-text check, so it is shown red by adding
  the import to a rule module and watching it fail.
- One PR, followed by `npm run ci:local` from `barwise/` with the exit
  code read directly.

## Non-goals

- No change to what any rule reports.
- No change to `checkUnaryRoleCardinalityViolations`.
- No public API change, and no new dependency.

## Implementation notes

**Reading the universe and judging by absence are different properties,
and the law found the difference.** The design assumed the five
universe-reading rules were the absent-data set. Run over all five, the
law went red twice:

- `checkJoinPathViolations`: `population/join-exclusion-violation` --
  "the tuple [...] is projected by more than one operand". It reads the
  universe to enumerate a join path's roots and reports a PRESENT-data
  violation.
- `checkSpanningExclusiveOrViolations`:
  `population/exclusive-or-violation` -- `"v2" plays 2 of them (must be
  exactly one)`. One rule id covers both "plays none" (absence) and
  "plays two" (presence).

Neither is a defect. A sample population is incomplete, not false, so a
tuple it supplies is a real fact and a contradiction among real facts is
a real violation. What a sample cannot support is a conclusion drawn
from absence. So `ABSENT_DATA_RULES` is the three rules whose every
diagnostic is absence-derived, typed as a subset of `UNIVERSE_RULES`.

This is the same boundary that made the parent spec's Option B
unimplementable -- one rule ID straddles it -- and it turns out to
straddle at the rule level too, which no list of functions alone could
have shown either. The law showed it.

**The law asserts set membership, not a count.** "The number of
diagnostics did not rise" would pass a rule that loses one diagnostic
and gains another, which is a new obligation hidden behind a satisfied
one. Every diagnostic after the sample must have been present before.

**Coverage, measured at the fixed seed over 250 models**: 90 models
carry non-sample population data (without it the universe is empty and
every absent-data rule returns early), and 52 produce at least one
absent-data diagnostic for the law to compare. Both asserted as floors
(30 and 15), following `generator-coverage-floors.spec.md`.

**Red-first proof for the import scan**: adding the text
`buildObjectUniverse` to `population/ring.ts` fails
`universeRuleTable.test.ts`; removing it passes. The scan also asserts
it enumerated at least ten modules, because a scan that enumerates
nothing reports OK (barwise-905).

**No behaviour changed**: 1569 tests pass across the core suite, and all
28 gates pass. `buildObjectUniverse` now runs once per validation rather
than five times.
