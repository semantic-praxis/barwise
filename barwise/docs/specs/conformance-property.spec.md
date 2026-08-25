# A generative property for the conformance/validator correspondence

Status: Draft for review (design only -- no implementation in this PR)
Created: 2026-08-25
Last-updated: 2026-08-25
Tracking: follow-up to `constraint-conformance-audit.spec.md` (its
barwise-840 postscript) and to
`test-suite-assertion-audit-2026-08-25.md`, whose Pass 2 is the method
this spec turns into a standing test.

In one sentence: generate adversarial extraction responses -- biased
toward the name collisions the hand-written probes never contained --
and assert the conformance-parse-validate pipeline yields no
`constraint/*` validation error, so the next correspondence gap fails
a seeded property test instead of a paid eval sweep.

## Principle

Determinism, and a correspondence invariant stated once. The pair
`enforceConformance` / `constraintConsistency` must agree: every
structural rule the validator charges as an error, conformance repairs
or removes first. The whole pipeline is pure -- no LLM, no I/O, no
clock -- which is exactly the precondition property-based testing
needs and rarely gets.

The invariant has been broken three times (arity, barwise-826;
frequency bounds, barwise-830; ring player identity, barwise-831), and
twice the discovery was a paid live run. The cost is not only money:
an unavoidable validation error charges 0.1 against the eval score, so
a correspondence gap silently deflates the longitudinal history that
is this project's only evidence about whether prompts improve.

`ConstraintCorrespondence.test.ts` already asserts the invariant as a
sweep over the constraint vocabulary -- but with hand-authored probes.
Its own barwise-840 postscript records the limit of that design: every
probe used distinct, cleanly resolving names, so the sweep "asserted
the check existed and never that its arithmetic was right," and three
partial-resolution shapes (`["Incident", "Incident"]`,
`["Incident", "Customer"]`, `["originates from", "Incident"]`) carried
an arity disagreement into fifteen dev runs. Hand-picked examples
cover the malformations someone thought of; the bug lived in the
interaction zone nobody did.

## Can a generator reach the zone the sweep missed? (resolved: yes, by biasing the name pools)

Yes, and the bias is the design. A naive generator drawing role hints
from random strings exercises only the "does not resolve, constraint
skipped" path -- structurally safe and already covered. All three
barwise-840 shapes live in the _partial-resolution_ zone: hints that
resolve to fewer roles than they name. A generator reaches that zone
when every name-shaped field draws from one weighted pool built from
the response's own skeleton: this fact type's player names (with
repetition), its role names, player names from _other_ fact types
(the global-name-set trap), and a small share of junk. All three
recorded shapes are then ordinary draws, along with every neighbour
nobody has recorded yet.

Seeded, the property stays deterministic: same seed, same cases, same
verdict, which keeps CI's "a failing test is never a flake" posture
intact. The generator is a fixture factory with a bigger imagination,
not a source of nondeterminism.

## Scope

In scope:

- When the property test runs, the system shall generate extraction
  responses whose object types, fact types, and inferred constraints
  are drawn from arbitraries biased toward partially-resolving role
  hints, and shall assert that
  `parseDraftModel(enforceConformance(r).response, ...)` produces a
  model for which `ValidationEngine` reports zero diagnostics with
  severity `error` and a `ruleId` starting `constraint/`.
- When a generated case fails, the test output shall include the
  fast-check seed and the shrunk counterexample, so the failure is
  reproducible with one recorded value.
- When CI runs the suite, the property shall run with a fixed seed and
  a fixed run count, so the suite stays deterministic.
- The arbitraries shall live under `packages/llm/tests/` (test code
  only -- no production module may exist solely for tests, per the
  offline-rehearsal precedent).

Out of scope, deliberately:

- A full `OrmModel` arbitrary in `core` (serialization round-trips,
  merge/diff laws, verbalizer totality). Different input type,
  different package, much larger invariant surface; a separate spec if
  pursued. This property needs only an `ExtractionResponse` arbitrary.
- Replacing `ConstraintCorrespondence.test.ts`. The sweep stays: it
  pins correction categories and scorer-facing behaviour (0.02 vs 0.1)
  that the property deliberately does not assert, and its named cases
  are the readable record of what has actually gone wrong.
- Property coverage of subtypes, objectifications, and populations
  beyond what workstream 2 grounds.

## Inventory

| Module                                       | Current state                                       | Verdict                              |
| -------------------------------------------- | --------------------------------------------------- | ------------------------------------ |
| `llm/src/ExtractionConformance.ts`           | the check under test                                | untouched                            |
| `llm/src/DraftModelParser.ts`                | pipeline stage between check and validator          | untouched                            |
| `core` validation (`constraintConsistency`)  | the other half of the invariant                     | untouched                            |
| `llm/tests/ConstraintCorrespondence.test.ts` | enumerative sweep, hand-authored probes             | stays; property complements it       |
| `llm/tests/arbitraries/extraction.ts`        | does not exist                                      | new (workstream 1)                   |
| `llm/tests/ConformanceProperty.test.ts`      | does not exist                                      | new (workstream 1)                   |
| `llm/package.json`                           | devDependencies: vitest, coverage, @barwise/diagram | adds `fast-check` as a devDependency |

Nothing in `promptlab` or the surfaces changes: the property tests the
pair in `llm`, where both `enforceConformance` and `parseDraftModel`
live and where the existing sweep already imports `ValidationEngine`
from `core`.

## Target architecture

```ts
// llm/tests/arbitraries/extraction.ts (test-only)

/** Names drawn from a pool built out of the response's own skeleton:
 *  this fact type's players (repeatable), its role names, players from
 *  other fact types, and a little junk. The weighting is the point --
 *  see the resolved section above. */
export function arbExtractionResponse(): fc.Arbitrary<ExtractionResponse>;

// llm/tests/ConformanceProperty.test.ts

it("nothing surviving conformance produces a constraint error, for generated responses", () => {
  fc.assert(
    fc.property(arbExtractionResponse(), (r) => {
      const { response } = enforceConformance(r);
      const { model } = parseDraftModel(response, "Property");
      const errors = new ValidationEngine().validate(model)
        .filter((d) =>
          d.severity === "error" && d.ruleId?.startsWith("constraint/")
        );
      expect(errors.map((d) => `${d.ruleId}: ${d.message}`)).toEqual([]);
    }),
    { seed: SEED, numRuns: RUNS }, // fixed in CI; see Open decisions
  );
});
```

The assertion is byte-for-byte the sweep's assertion -- severity
`error`, `ruleId` prefix `constraint/`, advisories excluded for the
documented reason. Only the input source changes: generated instead of
authored.

## Alternatives considered

- **Extend the enumerative sweep with more malformation rows.** The
  barwise-840 postscript is the refutation: the sweep's rows are
  bounded by what an author anticipates, and the escapes were exactly
  the unanticipated interactions. Rows added after each escape recreate
  the "each fix closed one instance" pattern the sweep was built to
  end.
- **Exhaustive mutation testing (Stryker) over the pair.** A different
  axis: mutation testing scores the tests, this property tests the
  code. Both are worth having; neither substitutes. Mutation of
  `enforceConformance` is already partly covered ("disabling it fails
  9 tests"), and the assertion-audit skill carries the manual method.
- **Build the `core` `OrmModel` arbitrary first and derive responses
  from models.** Generates only well-formed inputs by construction --
  the opposite of what this property needs, at several times the cost.
  The conformance property wants malformed responses; a model-first
  generator would have to un-normalize them back in.

## Workstreams (each independently shippable)

### 1. The extraction-response arbitrary and the constraint property

Add `fast-check` to `llm` devDependencies. Build
`arbExtractionResponse` (skeleton of object types and fact types with
resolvable readings; constraints of every `InferredConstraintType`,
fields drawn from the biased name pool; bounds and ring types drawn
from valid and invalid ranges). Add the property test with a fixed
seed. Acceptance, in EARS form: when the three barwise-840 arity fixes
are individually reverted, the property shall fail within the fixed
run count -- the generator is not accepted until it reproduces the
recorded escapes. That check is this spec's own mutation kill,
per the assertion-audit skill.

### 2. Parser totality over generated responses (provisional: not yet grounded)

Same arbitrary, second property: `parseDraftModel` never throws on any
generated response -- malformed input becomes skips and warnings, not
exceptions. Grounding needed before implementation: whether the parser
already holds this (the `Failed to create ...` catch blocks suggest
yes) and whether subtype/objectification/population arbitraries are
needed to make it meaningful. If it holds trivially, this workstream
is a cheap regression net; if it does not, that is a finding on its
own.

## API and migration impact

- No public API changes in any package. All new code is test-only.
- One new devDependency, `fast-check`, in `llm` only. Under the
  no-trivial-dependencies rule it qualifies as ajv/yaml do: a
  high-quality library solving a real problem (generation, shrinking,
  seed management) that Node core does not provide.
- No CI changes: the property runs inside `npx vitest run` like every
  other test.

## Open decisions (for review)

- **Seed policy.** Fixed seed in CI (deterministic, explores the same
  cases every run) versus fresh seed per run (more exploration, but a
  red CI that a re-run turns green -- exactly the flake posture this
  repo rejects). Recommend: fixed seed and `numRuns` in CI, with the
  seed a named constant so a developer can override locally for
  soak-style exploration. New ground is then covered when the seed or
  the generator changes, not when CI feels lucky.
- **Run count.** Recommend starting at 250: the pipeline per case is
  parse-plus-validate over a small model, and the existing llm suite
  budget (about 5s) has room. Tune downward only if measured, not
  preemptively.
- **Where the arbitraries live.** Recommend
  `llm/tests/arbitraries/extraction.ts` as specced. The alternative --
  a shared test-utils package -- buys nothing until a second package
  wants them, and couples packages through test code.

## Risks and testing

- The property must not weaken the sweep's guarantees: the sweep, the
  arity pins, and the correction-category assertions all stay and must
  stay green through both workstreams.
- Generator bugs fail silent, in both directions: an over-constrained
  arbitrary quietly tests nothing new, which is the decorative-test
  failure mode this line of work exists to kill. The workstream 1
  acceptance criterion (regenerate the three recorded escapes under
  reverted fixes) is the guard -- the generator earns trust by
  catching known bugs before it is trusted on unknown ones.
- Shrinking pathology: a slow shrink on failure is a CI stall.
  Bounding collection sizes in the arbitrary (few object types, few
  fact types, few constraints) keeps both generation and shrinking
  fast; the escapes all reproduce in tiny responses.
- Land as one PR per workstream, full monorepo build and test after
  each (the property imports across the llm/core boundary, so the
  stale-dist trap applies).

## Non-goals

- No change to `enforceConformance`, the parser, or any validator --
  if the property finds a gap, the fix is its own change with this
  test already red.
- No property testing of LLM output quality; the scorer and evals are
  untouched.
- No general PBT adoption mandate. This is one property with an
  unusually strong evidence trail; the core arbitrary question stays
  open until someone brings a property that earns it.
