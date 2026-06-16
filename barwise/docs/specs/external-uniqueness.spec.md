# External Uniqueness: Validation and Counterexample (WS4c)

Status: draft
Owner: design conversation (sensemaking initiative)
Tracking: WS4c of `cross-fact-type-counterexamples.spec.md`, drafted there
as provisional. File a bd issue when this lands.

## Principle / Problem

External uniqueness is the one constraint left without cross-fact-type
population validation or a counterexample. It identifies an object by a
**combination of roles across fact types** -- e.g. a Room identified by
the combination of its Building and its RoomNumber, where "Room is in
Building" and "Room has RoomNumber" are separate fact types. To check
"the combination is unique" you must form, per Room, the tuple of its
Building and RoomNumber values -- which requires **joining the two fact
types on the Room**.

The wrinkle: barwise's `ExternalUniquenessConstraint` carries only
`roleIds` (the constrained roles). It has **no join key** -- no record of
the common object the combination identifies. The verbalizer even
resolves the roles against the constraint's owner fact type, which is
wrong for true cross-fact-type external uniqueness. So the join key must
be **inferred** from the model.

This stays in `core`, deterministic and pure, and -- like the rest of WS4
-- preserves the round-trip guarantee: a generated counterexample,
attached to the model, must fail validation on exactly this constraint.

## Should we infer the join key or change the constraint shape? (resolved: infer, skip when unclear)

Infer it. Carrying the common object explicitly would change the
`ExternalUniquenessConstraint` shape and the `.orm.yaml` format -- out of
scope, and a round-trip break. Inference handles the standard pattern: the
common object is the single object type that plays a role in **every**
constrained fact type and is not the player of a constrained role (Room,
above). When the inference is ambiguous (more than one shared type) or
empty, **skip** -- emit no diagnostic and no counterexample. Skipping
preserves the round-trip guarantee: we validate only what we can form a
tuple for.

## Scope

In scope:

- Infer the common object (join key) for an external uniqueness
  constraint; skip gracefully when it is ambiguous or absent.
- Population validation: join the constrained fact types on the common
  object, build each common instance's combination tuple, and flag two
  common instances that share a tuple.
- Counterexample: two common-object instances with the same combination,
  one forbidden population per involved fact type.
- The round-trip guarantee, as in WS4b.

Out of scope:

- Changing `ExternalUniquenessConstraint` or the `.orm.yaml` format.
- Non-standard shapes (a fact type where the common object plays several
  roles, ternary key fact types) -- these skip; a later enhancement.
- The verbalizer's local-role assumption (separate, pre-existing).

## Inventory

| Area                                                 | Change                                                   | Verdict                 |
| ---------------------------------------------------- | -------------------------------------------------------- | ----------------------- |
| `core/src/validation/rules/populationValidation.ts`  | Infer the join key; external-uniqueness join + check     | Additive, deterministic |
| `core/src/counterexample/CounterexampleGenerator.ts` | `forExternalUniqueness`: two colliding common instances  | Additive                |
| `core/tests/...`                                     | Validation (satisfy/violate) + counterexample round-trip | Test addition           |

## Target architecture

```
# Infer the common object: the single type playing a role in every
# constrained fact type that is not a constrained role's player.
inferCommonObject(constraint, model): { objectTypeId; keyRoleByFactType } | undefined
#   undefined -> ambiguous or absent -> skip (no diagnostic, no counterexample)

# Validation: join on the common object, one tuple per common instance.
#   for each common value v:
#     tuple = [ constrainedValue in each fact type's instance where keyRole = v ]
#   two distinct v with the same tuple -> population/external-uniqueness-violation

# Counterexample: two common instances (CommonType#1, CommonType#2) that
# share the same constrained combination -- one forbidden population per
# involved fact type, joined by the common-object value.
```

## Alternatives considered

- **Carry the common object on the constraint.** Rejected (here): a
  metamodel + format change, out of WS4's scope and a round-trip break.
  Worth its own spec if external uniqueness becomes load-bearing.
- **Defer entirely and document a permanent limitation.** Viable --
  external uniqueness is rare. Rejected in favor of the inference because
  the standard pattern is unambiguous and the round-trip guarantee makes
  the implementation safe (we only act when the join key is clear).
- **Validate the constrained-role tuple without a join key** (treat the
  roleIds as one flat tuple). Rejected: the roles live in different fact
  types with no shared instance, so a flat tuple is meaningless -- this is
  exactly why a join key is required.

## Workstreams

- [ ] **WS4c -- External uniqueness (`core`).** Add the join-key
      inference, the population validation join + check, and the
      counterexample generator, all skipping gracefully when the common
      object is not a single clear type. Tests: a satisfying and a
      violating population, the counterexample round-trip, and the
      ambiguous/absent skip cases.

## API and migration impact

Additive. A new validation diagnostic for external uniqueness (previously
unchecked) -- a behavior change for models whose sample populations
violate it, consistent with WS4a's decision to ship the more-correct
validation. No shape or format change.

## Open decisions

- **Skip vs warn on an un-inferable join key.** _Recommend_ skip silently
  (the constraint is structurally fine; the population just cannot be
  joined). Alternative: a low-severity "could not validate" info
  diagnostic. Trade-off: an info diagnostic is honest but adds noise to
  the common case where populations are simply absent.
- **Scope of the standard pattern.** _Recommend_ supporting the
  binary-fact-type pattern (the common object plays exactly one role in
  each constrained fact type) and skipping the rest. Broader shapes are a
  later enhancement.

## Risks and testing

- **Round-trip preserved.** As in WS4b: the generated counterexample's
  populations, attached, must trigger `population/external-uniqueness-violation`.
  Tests assert it.
- **Inference correctness.** The skip-when-unclear rule keeps validation
  sound: a wrong join would risk false positives, so when the common
  object is not a single clear type we do nothing.
- **Determinism.** Inference and generation are pure functions of the
  model; placeholder values stay deterministic (the WS2 minting rule).
- **Formatting.** Same pre-push gate; `dprint fmt:check` runs in CI but
  not in this environment.

## Non-goals

- Changing the constraint or `.orm.yaml` shape.
- Fixing the verbalizer's local-role assumption (separate issue).
- Non-standard external-uniqueness shapes.
