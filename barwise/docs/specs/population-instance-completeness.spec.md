# A population instance must be able to fill every role, and then must actually fill it

Status: Implemented
Created: 2026-08-22
Last-updated: 2026-08-22
Tracking: barwise-835. Fourth instance of the class barwise-826 named,
found from the other end -- while pricing a prompt bullet for
barwise-813 rather than while reading a validator.

## Principle

Define errors out of existence, and prefer the deterministic lever. Both
prompt variants carry the line "Every instance MUST supply a value for
EVERY role of the fact type", and `population/incomplete-instance` is an
**error** in the validator. Conformance never checked it, so an
extraction that emits an incomplete instance carries an unavoidable 0.1
penalty -- the same shape as constraint arity (barwise-826), frequency
bounds (barwise-830), and ring players (barwise-831).

The second half is the more interesting one, and it inverts the fix. For
one whole class of fact type the instruction is not merely unheeded but
**impossible to obey**, so no amount of prompt text could ever have
satisfied it.

## A self-referencing fact type cannot have a valid population

`parse/populations.ts` resolves each key of `role_values` by object type
name only, via `getObjectTypeByName`, and then takes `rolesForPlayer(...)[0]`.
For `Employee mentors Employee` both roles are played by `Employee`, and
a JSON object cannot carry the key `"Employee"` twice. So:

| Spelling the model emits                        | What happens                                     |
| ----------------------------------------------- | ------------------------------------------------ |
| `{"Employee": "Alice"}` (player name)           | one role filled of two -> **error**, 0.1         |
| `{"mentors": "Alice", "is mentored by": "Bob"}` | `player "mentors" not found` -> instance dropped |

Verified end to end against `ValidationEngine`. Neither spelling can
produce a valid population, so any ring or self-referencing fact type --
mentoring, prerequisites, org hierarchies, part-of structures, exactly
the shapes ORM ring constraints exist for -- is structurally incapable
of carrying an example.

This is why the fix is not "tell the model to be more careful". The
model was being asked for something the parser could not accept.

## Two resolvers in one package that disagree

`parse/helpers.ts` already resolves constraint roles properly: role name
first (case-insensitively), then player name, **each match consuming a
role** so a repeated player name selects two distinct roles. That is
exactly what `Employee mentors Employee` needs, and it is why the
recorded `project-staffing` ring constraint works while a population of
the same fact type cannot.

`parse/populations.ts` does none of it. The same package resolves the
same kind of name two different ways, and the weaker one is the one
handling data. Aligning them is the fix, and it is the DRY argument the
house rules make room for: this is duplication that also fails the user.

## Scope

In scope:

- When a population instance names its roles by role name, the parser
  shall resolve them, as constraint parsing already does.
- When two roles of a fact type share a player, the parser shall assign
  distinct roles to distinct keys rather than the same role twice.
- When an instance still cannot supply a value for every role,
  conformance shall drop that instance and record a correction; and
  when dropping empties the population, the population shall go too --
  **charging nothing further**, since the instance corrections already
  name the defect and the emptiness is our own consequence rather than
  a second thing the extraction did wrong. Check 1 charges for a
  population the model itself emitted empty, which is a different
  claim. Corrected during implementation, where the first version
  priced one defect at 0.04.
- A complete instance, by either spelling, shall be unaffected.

Out of scope, deferred and named:

- **Inventing the missing value.** Nothing here guesses what the absent
  role's value was. That is the failure mode barwise-827 was about, and
  an invented tuple is worse than an omitted one.
- **The prompt bullet.** Whether the line still earns its place in the
  variants once the parser accepts role names is a barwise-813
  question, and needs the diagnostic round rather than an opinion.
- **The other population rules.** Fifteen more `population/*` rules
  exist and this audits one. barwise-834 carries the sweep.

## Why drop the instance rather than the population

Finer-grained than the three checks already in `cleanPopulations`,
which remove whole populations, and deliberately so: an instance is the
unit that is defective, and a population of five good instances and one
bad one is mostly evidence. Dropping the population would discard five
usable examples to punish one, which is the opposite of what the sample
semantics (barwise-827) were introduced to achieve.

One correction per dropped instance, matching how arity and bounds
charge per removed constraint. Ten bad instances really is ten defects,
and at 0.02 each that is still a fifth of what ten validation errors
would cost.

## Inventory

| Area                                        | Current state                          | Verdict |
| ------------------------------------------- | -------------------------------------- | ------- |
| `llm/src/parse/populations.ts`              | Player-name only; `rolesForPlayer[0]`  | modify  |
| `llm/src/ExtractionConformance.ts`          | No instance-completeness check         | modify  |
| `core/.../rules/population/structural.ts`   | Correct; the reference side            | none    |
| `promptlab/tests/fixtures/responses/*.json` | One population, three distinct players | guard   |

## Risks and testing

- **Moving the answer keys.** The seven recorded payloads hold exactly
  one population, one instance, three distinct players, keyed by player
  name. It resolves under the new order too (role name misses, player
  name hits), so the pinned scores must not move -- asserted by the
  existing `scoreExtraction.test.ts` pins rather than by a new test.
- **Consuming a role twice.** The bug being fixed is that
  `rolesForPlayer(...)[0]` always returns the same role. The test that
  matters gives a self-referencing fact type two role-name keys and
  asserts two _distinct_ role ids, since asserting "two entries" would
  pass on the broken behavior if the map were keyed by name.
- **Case sensitivity.** Role-name matching is case-insensitive to match
  the constraint resolver; player-name matching stays exact, also to
  match it. Divergence here would be the barwise-831 bug again.
- **A test that passes either way.** Both halves were verified by
  mutation rather than by being green: reverting the parser to
  player-name-only fails 2 tests, and disabling the conformance check
  fails 4. A later edit here should be checked the same way.
- Full gate: `npm run build`, `test`, `lint` -- all green, and the seven
  answer-key scores are byte-identical (0.96, 0.96, 0.94, 0.94, 0.98,
  0.98, 0.96), which is the guard that mattered.

## Non-goals

- No change to `population/incomplete-instance` or any validator rule.
- No change to the scoring weights.
- No prompt change.
