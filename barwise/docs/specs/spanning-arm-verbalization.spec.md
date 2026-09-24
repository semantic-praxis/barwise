# Spanning-constraint arms name the other role's player

Status: Implemented 2026-09-24
Created: 2026-09-24
Last-updated: 2026-09-24
Tracking: barwise-1003

## Principle

Determinism is not correctness. The three "one subject, several arms"
verbalizers -- disjunctive mandatory, exclusion, exclusive-or -- are pure
and stable, and they have been stably wrong: each arm printed the
constrained role's name followed by that role's OWN player. For an
exclusive-or over `Person drives Car` and `Person rides Bus` that reads
"Each Person either drives some Person or rides some Person but not
both." The subject is already the common player; the object of each arm
is the player of the role(s) the subject does NOT play.

The three verbalizers held one copy each of the same loop body, so the
defect was in three places. The fix moves the arm into one helper, which
is also what makes a fourth copy unnecessary.

## What was measured

- `cli/tests/characterization/golden/constraints-showcase.verbalize.txt:4`
  pinned the wrong sentence; PR #487 regenerated that golden for an
  unrelated reason (subset and equality), so the sentence was accepted
  rather than reviewed.
- `Phase2ConstraintVerbalizer.test.ts` pinned the same shape three more
  times ("Each Employee works on some Employee, ...") on a ternary fact
  type whose three roles have three different players -- a constraint
  whose roles share no player, which cannot mean anything as a
  one-subject sentence. Those tests existed to check comma placement.

## Behaviour

An arm is rendered from the role's home fact type (found model-wide,
since spanning roles are foreign by design):

1. **A reading that starts with the role's placeholder.** Take the text
   after it and replace every other placeholder with "some {Player}".
   Binary: "drives some Car". Unary: "smokes". Ternary: "works on some
   Project in some Department". This is the FORML shape and it follows
   the modeller's own reading rather than the role name.
2. **No such reading.** The role name, then "some {Player}" for each
   other role in the fact type. For a binary whose only reading is
   written from the other side this gives "is driven by some Person".
3. **The role is in no fact type.** The raw id twice, as before. That
   is a dangling reference and the structural rules report it; the
   verbalizer keeps its existing degradation.

Each player is a reference segment carrying the player's id, as before.

## Requirements

- When a disjunctive-mandatory, exclusion or exclusive-or constraint is
  verbalized, the system shall render each arm with the players of the
  roles the common subject does not play in that arm's fact type.
- Where the arm's fact type has a reading that starts with the
  constrained role's placeholder, the system shall render the arm from
  that reading.
- If no reading starts with the constrained role's placeholder, then
  the system shall render the arm as the role name followed by "some
  {Player}" for each other role.
- If the constrained role is in no fact type, then the system shall
  render the arm from the raw role id, as it did before this change.

## Alternatives considered

- **Fix the three loops in place.** Smallest diff, and it leaves three
  copies of one decision, which is how one defect became three. Lost on
  change amplification.
- **Route the arms through `spanningRoleLabel`**, the helper subset and
  equality already share. It answers a different question -- which
  player a role refers to, qualified by fact type ("Person in Person
  rides Bus") -- and produces a noun phrase, not a predicate. An arm
  needs a predicate and its object; forcing both through one helper
  would widen its interface for one caller class.
- **Role name plus the other player, always.** Simpler than consulting
  readings, and correct on this fixture, where each role name is the
  predicate. Role names are not reliably predicates: a NORMA-derived fixture in this repository carries role names equal to the role ids (barwise-981; which step put them there is not yet established). The reading is
  the modeller's phrasing, so it wins, and the role name stays as the
  fallback.

## Inventory

| Module                                                        | Change                                                                             |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `core/src/verbalization/constraints/phase2.ts`                | `spanningArm` helper; three verbalizers call it                                    |
| `core/tests/verbalization/Phase2ConstraintVerbalizer.test.ts` | exact-sentence tests over a well-formed three-arm model; the ternary pins replaced |
| `core/tests/verbalization/localRoleFallbacks.test.ts`         | the role-id fallback site moves into `spanningArm`                                 |
| `cli/tests/characterization/golden/constraints-showcase.*`    | regenerated; only the exclusive-or line changes                                    |

## Non-goals

- No validation rule for a spanning constraint whose roles share no
  player. `resolveCommonPlayer` still picks the first resolvable role's
  player; whether that shape should be reported is a separate question.
- Subset, equality and external uniqueness are unchanged; they already
  route through `spanningRoleLabel`.
