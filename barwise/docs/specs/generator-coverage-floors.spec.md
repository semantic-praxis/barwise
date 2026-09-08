# A coverage assertion that passes on one model in 250 is not coverage

Status: Implemented (see Implementation notes)
Created: 2026-09-08
Last-updated: 2026-09-08
Tracking: barwise-968 (this spec); barwise-967, whose once-only law was
carried by a single generated model

In one sentence: the mapper law's coverage assertions say
`toBeGreaterThan(0)`, two of them were satisfied by a handful of models
in 250, and a law nothing reaches is a law that passes for the wrong
reason -- so the generator builds those shapes deliberately and the
assertions become floors.

## Principle

**Explicit over implicit**, applied to a test's own premises.

`mapper.law.test.ts` asserts the generator reaches the shapes the
mapper branches on, because a law over models with no objectified fact
type and no subtype never enters the two steps that rewrite a primary
key -- which is where barwise-931 and barwise-963 lived. The assertions
exist for exactly the right reason and then say `> 0`, which is the
weakest statement that can be made about coverage: it cannot tell one
model from two hundred.

Measured at the fixed seed over 250 models, that mattered. A composite
foreign key was reached by 5 models; an entity identified by a
preferred binary to a value type, by 1. The barwise-931 mutation --
truncating a foreign key to its target's first column -- is invisible
without a composite target key, so five models were the whole of that
guard's evidence. The once-only law added by barwise-967 rested on one.

## What the numbers are (resolved: measured before and after)

| Shape                                      | Before | After | Floor |
| ------------------------------------------ | ------ | ----- | ----- |
| composite primary key                      | 124    | 160   | 50    |
| composite foreign key                      | 5      | 18    | 10    |
| model carrying a subtype fact              | 79     | 96    | 30    |
| model carrying an objectified fact type    | 76     | 70    | 30    |
| entity with a preferred identifying binary | 1      | 14    | 10    |

All at `SEED = 20260907` over `RUNS = 250`. The issue recorded the
composite foreign key at 1; it is 5 on the current tree, which is the
kind of drift that makes a `> 0` assertion look fine while what it
guards decays.

The floors sit well under the measured counts, so an ordinary generator
change does not trip them, and well over one, so a collapse does.

## Three levers, and why each (resolved: all three, none of them a rewrite)

The generator is not replaced. Three targeted changes, each aimed at a
shape the assertions name:

1. **Objectify a fact type with two or more entity players when one
   exists.** A composite primary key is what absorbing such a fact type
   produces, and a composite FOREIGN key needs a composite key to point
   at. Picking uniformly reached a multi-entity objectification in 12
   models of 250; preferring it reaches 40.
2. **Weight the entity/value split 2:1 toward entity.** A fair coin over
   two to five object types leaves few models with two entity players in
   one fact type at all. This is the lever that moved the composite
   primary key from 124 to 160.
3. **Build the preferred-identifier shape deliberately.** A binary, an
   entity on one side, a value type on the other, and an internal
   uniqueness constraint on that fact type that happens to be marked
   preferred is four coincidences; it co-occurred once in 250, and zero
   times after lever 2 made value types rarer. `withPreferredIdentifier`
   adds the constraint when the draw asks for it and the model has such
   a binary, and never a second one on an entity that already has one --
   `completeness/multiple-preferred-identifiers` calls that
   contradictory, and a generator producing it would be manufacturing
   the diagnostic rather than the shape.

Lever 2 costs something: it makes value types rarer, which is why lever
3 exists and why `objectified fact type` falls slightly (70 from 76).
Both are recorded rather than papered over.

## Scope

In scope, stated as requirements:

- When the arbitrary objectifies a fact type and a fact type with two
  or more entity players exists, the system shall objectify one of
  those.
- When the arbitrary draws an object type's kind, the system shall
  choose entity twice as often as value.
- When the draw asks for a preferred identifier and the model has an
  entity-value binary whose entity has none, the system shall mark that
  binary preferred.
- When the mapper law asserts coverage of a shape, the system shall
  assert a floor above one rather than above zero.

Out of scope: the seed and run count; any law's content; any change to
the mapper.

## Inventory

| Module                                      | Current state                                        | Verdict                                             |
| ------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------- |
| `core/tests/arbitraries/model.ts`           | fair entity/value coin; uniform objectification pick | three levers above                                  |
| `core/tests/laws/mapper.law.test.ts`        | five coverage assertions, all `toBeGreaterThan(0)`   | five floors                                         |
| `core/tests/laws/serialization.law.test.ts` | asserts no `structural/*` on any generated model     | untouched; must still hold under a richer generator |
| the rest of `core/tests`                    | 1557 tests, several over `arbOrmModel`               | untouched; must still pass                          |

The two `untouched` rows are the real risk: changing the generator
changes every sampled model, so any law it feeds can newly fail. That
is a finding if it happens, not a reason to revert -- but it has to be
run, not assumed.

## Alternatives considered

- **Raise `RUNS`.** More samples of the same distribution. 250 runs
  reaching 5 becomes 1000 runs reaching 20, at four times the runtime of
  every law in the file, and the shape stays rare rather than becoming
  represented.
- **A second arbitrary for the composite shapes**, sampled alongside the
  general one. Cleaner in principle, and it doubles the surface: two
  generators to keep honest, and every law would have to say which it
  runs over.
- **Assert nothing and rely on the fixtures.** The fixtures exist and
  are the deterministic guard; the laws are what catch the shapes nobody
  thought to write a fixture for, which is the whole reason barwise-931
  was found. Abandoning their coverage abandons that.

## Workstream: reach the shapes, then hold the line

The three generator levers and the five floors land together: the floors
are red against the current generator, which is the proof they measure
something.

Acceptance, in EARS form: when the mapper law runs at the fixed seed,
each coverage assertion shall report a count at or above its floor; and
when it runs against the pre-change generator, the composite-foreign-key
and preferred-identifier floors shall fail. The whole `@barwise/core`
suite shall pass unchanged otherwise.

## Risks and testing

- **The risk is a law that newly fails**, because the generator now
  reaches a shape the mapper handles badly. That is a defect found, and
  it is reported rather than tuned away.
- The second risk is a floor set so close to the measured count that an
  unrelated generator change trips it. Each floor is roughly a third to a
  half of measured, which is the trade: it catches a collapse and
  tolerates drift.
- One PR, followed by `npm run ci:local` from `barwise/` with the exit
  code read directly.

## Non-goals

- No change to `SEED` or `RUNS`.
- No change to any law's content, or to the mapper.
- No second arbitrary.

## Implementation notes

**The whole core suite passes unchanged**: 1562 tests, 103 files, with
the richer generator. No law newly failed, which is the outcome the
Risks section named as the thing to check rather than assume.

**Red-first proof.** With the pre-change arbitrary restored and the new
floors in place, `mapper.law.test.ts` reports 2 failed of 8: the
composite-foreign-key floor and the preferred-identifier floor. The
other three floors pass against the old generator too, because 124, 79
and 76 were already well clear of them -- those floors ratchet what
already held rather than fixing a thin spot.

**A test file is type-checked by nothing, and it showed.** The first
version of `withPreferredIdentifier` mutated `ft.constraints`, which is
declared `readonly constraints?: readonly Constraint[]` on
`FactTypeConfig`. `npx tsc --noEmit` in `packages/core` reported clean,
because its tsconfig includes only `src/`. The helper now returns a new
array; the assignment would have run correctly and compiled nowhere.
This is barwise-944, sighted again in the file that exists to generate
counterexamples.
