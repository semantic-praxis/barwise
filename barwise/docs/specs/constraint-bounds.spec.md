# Conformance must mirror every structural rule the validator enforces

Status: Implemented
Created: 2026-08-22
Last-updated: 2026-08-22
Tracking: barwise-830, with barwise-831 for the audit this argues for.
Third instance of the pattern barwise-826 named.

## Principle

Orthogonality in its failure mode, for the third time. `enforceConformance`
and `constraintConsistency` are separate modules that are not
independent: conformance exists to hand the parser something the
validator will accept. Every purely structural rule the validator
enforces therefore needs a counterpart here, or it becomes an error the
extraction cannot avoid and the eval charges 0.1 for.

The narrower lesson is about how the last fix was scoped. barwise-826
closed this for constraint _arity_ and left a comment stating the
general rule -- "any rule the validator enforces on arity has to be
enforced here too, or the pipeline produces models it knows are
invalid." The code handled one instance of a principle the comment
stated broadly. A reader would have believed the class was closed.

## What was measured

The first clean train sweep, immediately after the arity and
sample-population fixes:

```
[ 3/7] clinic-appointments  run 1/1  0.633  31.8s  7220/8192 out  6029 cached
  must_validate: 1 validation error(s): Frequency constraint in fact type
  "Appointment has FollowUpNote" has min 0, which must be at least 1.
```

`InferredConstraint` carries `min` and `max` for frequency constraints.
The validator rejects `min < 1` and a `max` below its `min`.
Conformance checked _arity_ for frequency constraints -- exactly one
role -- and never looked at the bounds.

## Why remove rather than repair

Consistent with barwise-826, and easier to defend here. A frequency
constraint of "at least 0" is not a weak constraint; it is no
constraint at all, since every population satisfies it. Clamping `min`
up to 1 would invent a rule the extraction never stated, which is the
failure mode barwise-827 was about. Removing charges 0.02 as a
conformance correction instead of 0.1 as a validation error, which is
the right relative price for dropping something malformed rather than
shipping something invalid.

## Scope

In scope:

- When a frequency constraint declares a minimum below 1, or a maximum
  below its minimum, conformance shall remove it and record a bounds
  correction.
- A frequency constraint with usable bounds, including an unbounded
  maximum, shall survive untouched.
- The agreement shall be asserted end to end, as for arity.

Out of scope, deferred and named:

- **The audit this argues for.** Three instances found by three live
  runs is a process failure, not three coincidences. Enumerating every
  rule in `constraintConsistency`, classifying each as structural or
  semantic, and confirming conformance mirrors every structural one is
  barwise-831. Doing it reactively here would fix a fourth instance and
  leave the fifth.
- **Making the correspondence mechanical.** A generator that feeds
  deliberately-malformed constraints of every type through conformance
  and asserts the model validates clean would catch the next gap
  without a live run. It needs a notion of "malformed" per constraint
  type, which is real work and belongs with the audit.

## Inventory

| Area                                      | Current state              | Verdict   |
| ----------------------------------------- | -------------------------- | --------- |
| `llm/src/ExtractionConformance.ts`        | Arity checked, bounds not  | modify    |
| `core/.../rules/constraintConsistency.ts` | Rejects min < 1, max < min | untouched |
| `llm/tests/ConstraintArity.test.ts`       | Covers arity only          | extend    |

## Risks and testing

- **Over-eager removal would delete usable constraints.** A frequency
  of 1..5, and one with an unbounded maximum, are both tested to
  survive.
- **A module-local test re-pins one side of a disagreement.** As for
  arity, the invariant is a property of the pair: whatever survives
  conformance must not trip the validator's frequency rules. Asserted
  end to end through `ValidationEngine`, the entry point
  `scoreExtraction` uses.
- Full gate: `npm run build`, `test`, `lint`.

## Non-goals

- No prompt change. The extraction is asked for valid constraints; this
  is about what the pipeline does when it does not get them.
- No change to the validator, and no new correction categories beyond
  the one this needs.
