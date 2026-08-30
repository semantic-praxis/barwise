# Ask the constraint whether it rejects the population

Status: Workstream 1 implemented; 2 pending, 3 deferred
Created: 2026-08-30
Last-updated: 2026-08-30
Tracking: barwise-904

## Principle

**Deep modules, and defining errors out of existence.** `forbids_population`
asks one question -- does THIS constraint reject THIS population -- and core
offers no way to ask it. The only available surface is
`ValidationEngine.validate(model)`, a flat model-wide `Diagnostic[]` in which
the answer is mixed with every other rule firing at once, so the caller must
reconstruct it.

`@barwise/learn` reconstructs it in three layers, all shipped by barwise-894
for one indirect measurement: a map from constraint kind to the population
rule ids that count (`REJECTING_RULES`), an attribution step deciding whether
a diagnostic names the right fact type (`namesTheCarrier`), and a
before/after multiset delta separating caused errors from pre-existing ones.
Each layer exists because the question was asked of the wrong interface.

Core already asserts the pairing this wants, in `Counterexample`'s own
docstring -- "feeding the forbidden populations back through
`populationValidationRules` reports a violation of the very constraint this
counterexample was generated for." Nothing can execute that sentence. It is a
prose invariant with no API, which is the shape the 2026-08-29 rubric audit
kept finding.

**Determinism in core is preserved, not strained.** The predicate is pure:
model in, boolean out, no I/O and no clock. It belongs in core by the same
rule that puts validation there.

## Should core expose a per-constraint predicate? (resolved: yes)

Yes, and the evidence is that the logic is already written per-constraint --
only the entry point is model-wide. `checkMandatoryViolations` is
representative:

```ts
export function checkMandatoryViolations(model: OrmModel): Diagnostic[] {
  const universe = buildObjectUniverse(model);       // model-wide context
  for (const ft of model.factTypes) {
    for (const c of ft.constraints) {
      if (!isMandatoryRole(c)) continue;             // <- the per-constraint
      ...                                            //    body already exists
```

The loop body is the predicate. Extracting it costs no new logic; it names
something that is already there.

### The complication worth pricing: not every rule is per-constraint

There are 21 population check functions, and they do not divide evenly:

| Group                                     | Examples                                                                                              | Predicate fit                       |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Per-constraint, one fact type             | mandatory, uniqueness, frequency, value constraint, ring, cardinality                                 | natural                             |
| Constraint-driven but spanning fact types | disjunctive mandatory, external uniqueness, subset/equality/exclusion, join path, the four spanning\* | works, but "its fact type" is a set |
| Not constraint-driven at all              | `checkDanglingPopulationFactType`, `checkIncompleteInstances`                                         | meaningless -- no constraint        |

A predicate keyed on a constraint is right for the first two groups and has
no referent in the third. That is not an obstacle here, because
`forbids_population` only ever asks about five constraint kinds --
`internal_uniqueness`, `mandatory`, `value`, `frequency`, `ring` -- all of
which sit in the first two groups. The spec scopes the predicate to
constraint-driven rules and says so, rather than pretending the third group
fits.

**The predicate takes the model.** `buildObjectUniverse(model)` is
closed-world over every population, so enforcement is not decidable from the
constraint and its fact type alone. The signature must carry the model; a
"local" predicate would be a lie about ORM's semantics.

## Scope

In scope:

- When a caller asks whether a constraint rejects the model's population,
  the system shall answer from the constraint itself, without the caller
  inspecting `Diagnostic[]`.
- When the constraint is of a kind no population rule enforces, the system
  shall say so distinguishably rather than returning "not violated" --
  "nothing enforces this" and "this is satisfied" are different answers, and
  collapsing them is how a check with no reachable failure path is born
  (barwise-902).
- When `forbids_population` evaluates a candidate, it shall call the
  predicate rather than `REJECTING_RULES` plus attribution.
- When the predicate ships, `REJECTING_RULES`, `namesTheCarrier`, the
  kind-to-rule mapping and `tests/rejectingRulesDrift.test.ts` shall be
  deleted, not left beside it.

Out of scope:

- **Correspondence stays.** Which candidate constraint answers to a reference
  constraint is irreducible: the candidate is a different model with
  different ids. `correspondingFactTypes` and its tiers are untouched. This
  narrows the indirection; it does not remove the hard part.
- Changing any validation rule's behaviour, severity, or message.
- The before/after multiset delta in `forbids_population` -- it becomes
  unnecessary for attribution, but removing it is a consequence of
  workstream 2, not a separate goal.

## Inventory

| Module                                           | Current state                                               | Verdict                          |
| ------------------------------------------------ | ----------------------------------------------------------- | -------------------------------- |
| `core/src/validation/rules/population/*.ts`      | 21 model-wide `(model) => Diagnostic[]` functions           | gain per-constraint entry points |
| `core` public exports                            | `ValidationEngine`, rule functions                          | gains the predicate              |
| `learn/src/evaluate/checks/forbidsPopulation.ts` | `REJECTING_RULES`, `namesTheCarrier`, `attributable`, delta | calls the predicate; those go    |
| `learn/tests/rejectingRulesDrift.test.ts`        | guards the kind-to-rule map against core                    | deleted with the map it guards   |
| `learn/src/evaluate/populationMapping.ts`        | `correspondingFactTypes`, tiers                             | untouched                        |
| `core` `Diagnostic.elementId`                    | `c.id ?? ft.id` -- lossy by construction                    | see Open decisions               |

`Counterexample`'s docstring becomes executable rather than aspirational; no
other core consumer changes, because the predicate is additive.

## Target architecture

```ts
// @barwise/core -- the question, asked directly.
export type EnforcementVerdict =
  | {
    readonly enforced: true;
    readonly rejects: boolean;
    readonly diagnostics: readonly Diagnostic[];
  }
  | { readonly enforced: false; }; // no population rule covers this kind

export function evaluateConstraintEnforcement(
  model: OrmModel,
  factType: FactType,
  constraint: Constraint,
): EnforcementVerdict;
```

`enforced: false` is the point of the discriminated union: a caller cannot
mistake "no rule covers this" for "satisfied", which is the mistake
`REJECTING_RULES[kind] === undefined` currently invites.

```ts
// @barwise/learn -- forbids_population, after
const verdict = evaluateConstraintEnforcement(candidateModel, ft, constraint);
if (!verdict.enforced) return miss("no population rule enforces this kind");
return verdict.rejects ? pass() : miss(...);
```

## Alternatives considered

- **Keep the diagnostic path and add a structured `constraintId` to
  `Diagnostic`.** Cheaper, and it does fix attribution exactly -- but it
  leaves the caller filtering a model-wide array by rule id, so
  `REJECTING_RULES` survives and so does its drift test. It treats the
  symptom the audit found rather than the interface that caused it. Worth
  doing anyway for other diagnostic consumers; see Open decisions.
- **Give every rule a per-constraint form and derive the model-wide pass
  from it.** The cleanest end state, and much larger: 21 functions
  rewritten, including the three that have no constraint to key on. Rejected
  for this spec as a change whose blast radius exceeds its motivation;
  nothing stops a later spec doing it if a second consumer appears.
- **Put the predicate in `@barwise/learn`.** It would need to reimplement
  population semantics that core owns, which is the duplication CLAUDE.md
  forbids and the determinism rule places in core. Rejected.

## Workstreams (each independently shippable)

### 1. The predicate in core, with no consumer

Add `evaluateConstraintEnforcement` covering the five kinds
`forbids_population` asks about, by extracting the loop bodies the rules
already contain. The model-wide functions keep their behaviour and their
tests; the extraction must leave `validate(model)` byte-identical in output,
which is the acceptance test. Ships alone, changes nothing.

### 2. `forbids_population` calls it; the compensation layers go

Switch the check, then delete `REJECTING_RULES`, `namesTheCarrier`, the
kind-to-rule map and `rejectingRulesDrift.test.ts`. The gate is
`npm run audit:rubric -- --check`: **43/43 `forbids_population` checks must
still discriminate**, and `rubric-baseline.json` must not gain a row. A
suite bump is expected to be unnecessary -- the answers should not move, only
how they are computed -- and if any score does move, that is a finding to
report before bumping, not a bump to apply quietly.

### 3. Structured `constraintId` on `Diagnostic` (provisional: not yet grounded)

Independent of 1 and 2, and only if Open decision 2 says yes.

## API and migration impact

- `@barwise/core` gains one exported function and one exported type. No
  existing export changes signature, so no downstream package is forced to
  update; `learn` opts in during workstream 2.
- Core changes reach every downstream package by the one-way graph, so
  workstream 1 runs the full monorepo build and test per CLAUDE.md, not just
  core's.

## Open decisions (resolved as recommended)

- **Does the predicate return a boolean or the diagnostics?**
  Resolved: the discriminated union above, carrying `diagnostics` on the
  `enforced: true` arm. `forbids_population` needs only `rejects`, but the
  gym's miss-card wants to say _what_ was violated, and a boolean would send
  it straight back to the model-wide array this spec exists to avoid. The
  cost is a wider return type than the immediate caller needs.
- **Does `constraintId` land here or separately?**
  Resolved: separately, and only if a consumer needs it. Workstreams 1
  and 2 remove the only caller that currently has to disambiguate
  `c.id ?? ft.id`, so the lossiness may stop mattering. Deciding now would
  price a fix for a problem this spec might delete.
- **Five kinds or all constraint-driven kinds?**
  Resolved: the five, plus the two spanning forms
  (`external_uniqueness`, `disjunctive_mandatory`). `learn` looks up the
  _candidate's_ corresponding constraint, not the reference's, which is why
  `REJECTING_RULES` already accepted two rule ids per kind: a candidate may
  express as external uniqueness what the answer key expressed as internal.
  Covering five would have made those candidates unanswerable. The
  remaining kinds stay out, on the reasoning below. Building the
  rest speculatively adds surface with no caller to prove it right --
  precisely the shape of `buildCodeExtractionPrompt` (barwise-811), which
  has had no call site for two years.

## Risks and testing

- **The extraction must not change `validate(model)`.** The strongest guard
  is differential: for every reference model in `promptlab/evals` and every
  example under `examples/`, the diagnostics before and after must be
  identical. Cheaper and stricter than asserting the new predicate in
  isolation.
- **43/43 must survive.** `audit:rubric -- --check` is the acceptance gate
  for workstream 2, and `rubric-baseline.json` failing on a NEW row is what
  catches a regression that the check counts would hide.
- The gym's `forbids_population` miss cards are user-visible text; if the
  predicate changes their wording, that is a deliberate change to state, not
  a silent one.

## Non-goals

- No new validation rules, no severity or message changes.
- No removal of `correspondingFactTypes` or the correspondence tiers.
- No change to `ValidationEngine`'s existing API or to any surface's
  behaviour.
