# Cross-Fact-Type Counterexamples

Status: draft
Owner: design conversation (sensemaking initiative)
Tracking: implements WS4 of `implicit-sensemaking.spec.md`, which drafted
it provisionally. File bd issues per workstream when this lands.

## Principle / Problem

WS2 gave counterexamples for the intra-fact-type constraints -- internal
uniqueness, value, frequency, ring -- by inverting `populationValidation`:
for each constraint it generates the minimal population that constraint
forbids, and the round-trip (feed it back through the validator) is the
correctness guarantee. The cross-fact-type constraints have no
counterexample because the validator itself does not check them.
`populationValidation` covers only single-fact-type cases; it skips
mandatory, disjunctive mandatory, and external uniqueness entirely, and
skips exclusion/exclusive-or/subset/equality whenever their roles span
fact types (it needs the cross-population, object-universe view it does
not yet build).

So extending counterexamples requires two things first: `core` must gain
**cross-fact-type population validation**, and the `Counterexample` must
carry the populations of more than one fact type. Both halves stay
deterministic and pure, in `core` (the determinism pillar), and both
extend the existing checker and generator rather than forking them (the
composability pillar).

## Should validation get an object-universe view? (resolved: yes)

Cross-fact-type constraints need to reason about the set of object
instances, not just tuples within one population. We define the
**universe** of an object type as every distinct value that appears in
any role played by that type across all of the model's populations -- a
closed-world reading of the sample. Mandatory then means "every value in
the player's universe appears in the mandatory role"; disjunctive
mandatory, "in at least one of the roles"; spanning exclusion, "in at
most one." This is the interpretation the validator's own comment
anticipates ("requires knowing the full universe of entity instances").

## Should the Counterexample carry one population or many? (resolved: many)

Change `forbidden: Population` to `forbidden: readonly Population[]`. A
single population on one fact type cannot express a violation that spans
two fact types (e.g. a Customer present in `Customer has CustomerId` but
absent from the mandatory `Customer places Order`). The `text` and
`segments` fields are unchanged, and no surfacing reads `forbidden`
(verified) -- so the blast radius is the WS2 tests and the round-trip
helper only.

## Scope

In scope:

- Cross-fact-type population validation in `core`: mandatory, disjunctive
  mandatory, and the spanning cases of exclusion, exclusive-or, subset,
  and equality, built on an object-universe helper.
- `Counterexample.forbidden` becomes a population array; the generator
  emits cross-fact-type counterexamples for the constraints above.
- The round-trip guarantee is preserved: every generated population set,
  attached to the model, fails validation on exactly its constraint.

Provisional / out of scope:

- **External uniqueness** counterexamples. External uniqueness identifies
  an object by a combination of roles across fact types, which needs an
  instance-join the others do not; drafted as WS4c, provisional.
- Any change to constraint semantics, the `.orm.yaml` format, or the WS3
  surfaces (they render `text`, which is unaffected).

## Inventory

| Area                                                 | Change                                                            | WS | Verdict                         |
| ---------------------------------------------------- | ----------------------------------------------------------------- | -- | ------------------------------- |
| `core/src/validation/rules/populationValidation.ts`  | Object-universe helper; mandatory + disjunctive + spanning checks | 4a | Additive, deterministic         |
| `core/src/counterexample/Counterexample.ts`          | `forbidden: readonly Population[]`                                | 4b | Breaking to a new internal type |
| `core/src/counterexample/CounterexampleGenerator.ts` | Generate cross-fact-type counterexamples                          | 4b | Additive                        |
| `core/tests/counterexample/*`                        | Update `forbidden` usage; add cross-fact-type round-trips         | 4b | Test update                     |
| `core` (external uniqueness)                         | Validation + generation for external uniqueness                   | 4c | Provisional                     |

## Target architecture

```
# WS4a: an object-universe view powers the cross-fact-type checks.
# universe(objectTypeId) = every value appearing in any role played by
# that type across all model populations.
function objectUniverse(model): Map<objectTypeId, Set<value>>

# New population rules (the inverse of which WS4b will generate):
#   mandatory          -- every value in universe(player) appears in the role
#   disjunctive_mandatory -- ... appears in at least one of the roles
#   exclusion (spanning)  -- no value appears in more than one role
#   exclusive_or (spanning) -- exactly one
#   subset/equality (spanning) -- tuple containment across the two fact types

# WS4b: a counterexample can span fact types.
interface Counterexample {
  readonly factTypeId: string;            # the primary fact type
  readonly constraintId?: string;
  readonly constraintType: Constraint["type"];
  readonly forbidden: readonly Population[];   # CHANGED: one per involved fact type
  readonly segments: readonly VerbalizationSegment[];
  readonly text: string;
}

# Round-trip, extended: attaching every population in `forbidden` to the
# model makes populationValidation report a violation of `constraintId`.
```

## Alternatives considered

- **Generate counterexamples without validator support (no round-trip).**
  Rejected: the round-trip is what makes WS2 trustworthy; dropping it for
  cross-fact-type cases would ship populations we cannot prove are
  actually forbidden. Building the validator first keeps the guarantee.
- **Keep `forbidden: Population` and add a second optional field.**
  Rejected: a population array is the honest shape for an N-fact-type
  violation and avoids special-casing two vs more.
- **Open-world mandatory (only flag instances explicitly marked absent).**
  Rejected: there is no "absent" marker; the closed-world universe over
  the sample is the only well-defined reading.

## Workstreams

- [ ] **WS4a -- Cross-fact-type population validation (`core`).** Add an
      `objectUniverse` helper and validation for mandatory, disjunctive
      mandatory, and the spanning cases of exclusion, exclusive-or,
      subset, and equality. Independently valuable -- validation gets more
      complete. Unit tests over satisfying and violating populations.
- [ ] **WS4b -- Multi-population counterexamples (`core`).** Change
      `Counterexample.forbidden` to `readonly Population[]`, update WS2
      tests and the round-trip helper, and generate counterexamples for
      the WS4a constraints. _(provisional: not yet grounded -- confirm the
      minimal forbidden population set per constraint before building.)_
- [ ] **WS4c -- External uniqueness.** Validation and counterexample for
      external uniqueness, which needs an instance-join across fact types.
      _(provisional: not yet grounded.)_

## API and migration impact

- WS4a is additive: new validation diagnostics for constraints that were
  previously unchecked. Models that silently violated mandatory in their
  sample populations will now get a diagnostic -- intended, but worth
  calling out as a behavior change for population validation.
- WS4b changes `Counterexample.forbidden` from `Population` to
  `readonly Population[]`. The type shipped in WS2 and is consumed only by
  the generator, its tests, and the round-trip helper; no surface reads
  it. WS3 surfaces render `text` and are unaffected.

## Open decisions

- **External uniqueness now or later.** _Recommend_ later (WS4c,
  provisional): its identity-join is materially harder than the others,
  and the rest deliver most of the value.
- **Universe from populations vs declared instances.** _Recommend_ the
  population-derived universe (closed-world over the sample) -- barwise
  has no separate instance registry, and this matches the existing
  population-validation model.
- **New-diagnostic behavior change.** WS4a will flag mandatory violations
  that today pass silently. _Recommend_ shipping it (more correct), noting
  it in the changelog.

## Risks and testing

- **Round-trip preserved.** The correctness test stays the same shape: for
  each generated counterexample, attaching every population in `forbidden`
  to the model must make `populationValidation` report a violation of that
  constraint. Tests assert this per cross-fact-type constraint.
- **Closed-world subtlety.** The universe is sample-relative; tests pin the
  intended reading (an instance "exists" iff it appears in some role).
- **Determinism.** Both validation and generation remain pure functions of
  the model; placeholder values stay deterministic (the WS2 minting rule).
- **Formatting.** Same pre-push gate; `dprint fmt:check` runs in CI but not
  in this environment.

## Non-goals

- Changing constraint semantics or the `.orm.yaml` format.
- Changing the WS3 surfaces.
- An instance registry separate from populations.
