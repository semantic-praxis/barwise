# A sample population is positive evidence only

Status: Implemented
Created: 2026-08-22
Last-updated: 2026-08-22
Tracking: barwise-827. Found on the dev split after the arity fix
(barwise-826) removed the errors that were masking it.

## Principle

Explicit over implicit, applied to a distinction the metamodel was
making silently. Populations arrive from two very different places and
were treated identically:

- A **hand-authored** population is _significant_. The modeller chose
  those tuples to check a rule against, so a gap in them is a finding.
- An **extracted** population is whatever a transcript happened to
  mention. A gap in it is a transcript being a transcript.

Judging the second as the first is not a bug in either module; it is a
missing declaration. Nothing in the model said which kind it held, so
the validator assumed the stricter one.

## What was measured

`incident-response` on the dev split, after the arity fix:

```
[ 3/3] incident-response  run 1/1  0.000  58.9s  9940/31700 out  COLLAPSE
  must_validate: 6 validation error(s): Mandatory constraint on role ...
  in fact type "Incident has Severity" is violated: "INC-003" appears in
  the model but does not play this mandatory role.
```

Six such errors, at 0.1 each, is the whole score. The same shape sank
`vendor-onboarding` to 0.003.

The decisive evidence was the seed suite: **all seven recorded answer
keys produce zero population-rule errors.** The pattern does not exist
in the train split at all. Short transcripts name few entities and the
extraction covers them; a 13-17 KB transcript names many, and a sample
cannot populate every mandatory role for every one. It is a scaling
artifact, invisible until a held-out split of realistic length exposed
it -- which is exactly what the split is for.

It is also not only an eval problem. `processTranscript` feeds the same
validator, so anyone importing a long transcript in the editor saw the
same wall of violations on their draft.

## Semantics

One sentence, and everything follows from it:

> A sample population is **positive evidence only**. It can satisfy a
> constraint but never creates the obligation that one be satisfied.

Concretely: sample instances are excluded from the object universe, and
included in `valuesPlayedInRole`. A sample can discharge an obligation
raised by a significant population; it can never raise one.

## Why this seam

`buildObjectUniverse` is the single place the rules ask what exists,
and the rules that use it are exactly the family that fails on _absent_
data -- mandatory, disjunctive mandatory, cardinality, spanning, join
paths. Everything else (uniqueness, exclusion, value and ring
constraints, structural checks) reads the populations directly and
fails on data that is _present_.

So one guard in one function separates the two families correctly,
without a per-rule table that would go stale as rules are added. That
the split falls out this cleanly is evidence the distinction is real
rather than invented: a check that can only fail because something is
missing is precisely the check a sample cannot support.

## Scope

In scope:

- A population shall declare whether it is a sample, defaulting to
  significant so every existing model behaves exactly as before.
- The flag shall round-trip, and shall be absent from the YAML when
  false so existing files do not gain a line on first save.
- Sample instances shall be excluded from the object universe and
  included when checking who plays a role.
- Extraction shall mark the populations it produces as samples.

Out of scope, deferred and named:

- **A per-fact-type notion of completeness.** A population could in
  principle be complete for one fact type and partial for another. No
  caller needs that, and the flag can gain a shape later without
  breaking the boolean.
- **Surfacing the distinction in the editor.** A user might reasonably
  want "check this draft as if the population were complete". That is a
  UI affordance over a field that now exists.
- **Prompting the extraction to populate mandatory roles fully.** It
  cannot: the transcript does not contain the data.

## Inventory

| Area                                        | Current state                    | Verdict |
| ------------------------------------------- | -------------------------------- | ------- |
| `core/src/model/Population.ts`              | No completeness notion           | modify  |
| `core/src/serialization/yaml/population.ts` | No field to carry                | modify  |
| `core/schemas/orm-model.schema.json`        | `additionalProperties: false`    | modify  |
| `core/.../population/shared.ts`             | Universe spans every population  | modify  |
| `llm/src/parse/populations.ts`              | Produces significant populations | modify  |
| `core/tests/helpers/ModelBuilder.ts`        | Cannot build a sample            | modify  |

## Risks and testing

- **Weakening the check for hand-authored models** would be the serious
  regression: population checking exists for exactly that case, and a
  significant population with an unplayed mandatory role is a real
  finding. Tested directly -- the same model reports 1 violation as
  significant and 0 as a sample.
- **"Sample" must not come to mean "unchecked."** A sample cannot be
  incomplete in a way that manufactures a duplicate, so uniqueness must
  still fire on it. Tested.
- **The asymmetry is easy to get wrong in the obvious direction.** If
  samples were excluded from `valuesPlayedInRole` as well as from the
  universe, a sample instance playing a mandatory role would stop
  discharging the obligation and the rule would punish evidence for
  existing. Tested.
- **Serialization must not dirty existing files.** The key is written
  only when true; asserted on the YAML text, not just the round-trip.
- Full gate: `npm run build`, `test`, `lint`.

## Non-goals

- No change to any rule's logic, only to what counts as existing.
- No prompt change.
- No new severity levels or diagnostic categories.
