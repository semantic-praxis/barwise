# A law over two drawn models is only as strong as the pairs that differ

Status: WS1 implemented; WS2 open and may not be built (see Open
decisions and Implementation notes)
Created: 2026-09-09
Last-updated: 2026-09-09
Tracking: barwise-985 (this spec). Extends
`docs/specs/generator-coverage-floors.spec.md` (barwise-968) from
single-draw laws to the two-draw ones it did not reach.

In one sentence: `merge.law.test.ts` holds the suite's only
two-argument properties, each clause discriminates only when the two
drawn models actually differ in that dimension, the objectification
clause has both sides empty in 127 pairs of 250 -- so the pairs get
measured floors, the same resolution barwise-968 gave the mapper.

## Principle

**Explicit over implicit**, applied to a test's own premises -- the
same reading barwise-968 took, one draw further out.

A law stated over `(existing, incoming)` is a claim about how merge
treats two models. Every clause of "accepting every delta yields the
incoming model" compares a projection of the merged model against the
same projection of `incoming`. Where `existing` and `incoming` agree in
that projection, the comparison holds no matter what merge did: it is
`x toEqual x`, and the clause certifies nothing. The law is still true;
its evidence is just thinner than the `numRuns: 250` on the line
suggests, and nothing on the page says by how much.

`sample.law.test.ts` already names this failure in so many words --
"the law compares two empty lists 250 times" -- and guards against it
with a `describe("coverage: the law is not vacuous")` block. So does
`mapper.law.test.ts`, `serialization.law.test.ts` and
`counterexample.law.test.ts`. `merge.law.test.ts` is the only law file
in the package with no coverage assertions at all, and it is the only
one whose properties take two draws, which is where the premise is
hardest to eyeball.

## What the numbers are (resolved: measured before writing this)

Measured at the file's own `SEED` over `RUNS = 250` pairs, the count
that differ in each dimension the two laws assert on:

| Dimension the law asserts on | Pairs that differ | Both sides empty | Floor |
| ---------------------------- | ----------------- | ---------------- | ----- |
| object type names            | 181               | 0                | 90    |
| fact type names              | 184               | 0                | 90    |
| definition terms             | 231               | 0                | 120   |
| subtype pairs                | 159               | 88               | 80    |
| objectification pairs        | 120               | 127              | 60    |
| population keys              | 218               | 30               | 110   |
| residual deltas (second law) | 224               | n/a              | 120   |

The objectification clause is the thin one, and it is thin for a
reason that traces straight back to the predecessor spec. barwise-968
recorded an objectified fact type in 70 models of 250; a pair needs at
least one side non-empty for the clause to say anything, and
`(180/250)^2 = 0.52` predicts 130 both-empty pairs against the 127
measured. The pair rate is the single-model rate squared, which is
what makes a dimension that looks adequately covered per model
inadequate per pair.

That clause is not decoration. The comment above it records why the
four kinds are there at all: until the diff learned them in WS2 and
WS3, `mergeModels` carried them from the EXISTING model whatever a
reviewer accepted, "which is why it is stated over all six now". The
clause guarding the regression that shipped is the one asserting
`[] toEqual []` more often than not.

The last row is a different shape and worth stating separately. The
second law iterates `for (const delta of residual)` and asserts inside
the loop. In 26 pairs of 250 the residual is empty, the body never
runs, and the test passes having executed no assertion -- the
`it()`-shaped version of a check that cannot fail.

**The sampling was verified, not assumed.** The floors read pairs from
`fc.sample(fc.tuple(arbOrmModel(), arbOrmModel()), { seed, numRuns })`,
which is a different call than the `fc.property(a, b, ...)` the laws
use, so "it draws the same pairs" is a claim. Counting collisions from
inside the property itself returned 69 identical object-type name sets,
and the sampled pairs return 250 - 181 = 69. Same seed, same pairs.

## Should the floors be per-dimension or one aggregate? (resolved: per-dimension)

Per-dimension. An aggregate floor -- "the pair differs somewhere" --
holds for 249 pairs of 250 and would pass comfortably while the
objectification clause sat at zero. That is precisely the
`toBeGreaterThan(0)` mistake barwise-968 fixed, reintroduced one level
up: a number too coarse to distinguish a healthy generator from a
collapsed one.

The floors sit near half the measured counts, following the rule the
predecessor set -- well under the measurement so ordinary generator
churn does not trip them, well over one so a collapse does. The mapper
floors run 31% to 71% of measured; these are large, stable counts that
follow from the generator's shape distribution rather than from a rare
coincidence, so the lower end of that band is right.

## Scope

In scope, stated as requirements:

- When the merge law suite runs, the system shall sample pairs at the
  file's `SEED` and `RUNS` and assert, for each dimension the laws
  compare, that at least the floor number of pairs differ in that
  dimension.
- When the merge law suite runs, the system shall assert that at least
  the floor number of pairs produce a non-empty residual delta list, so
  the second law's loop body is known to execute.
- When a floor assertion fails, the message shall name the measured
  count, so a reviewer reads the drift rather than re-deriving it.

Out of scope:

- Changing the arbitrary. Raising the single-model objectification rate
  is the obvious way to lift the thinnest row, and it perturbs the five
  mapper floors barwise-968 measured. Carried to Open decisions.
- The other law files. Their coverage blocks exist; whether their
  floors are well chosen is a separate question and a separate sweep.
- Any change to `mergeModels`, `diffModels` or the laws themselves. The
  laws are correct and stay exactly as written.

## Inventory

| File                                 | Current state                                               | Verdict                 |
| ------------------------------------ | ----------------------------------------------------------- | ----------------------- |
| `core/tests/laws/merge.law.test.ts`  | five properties, two of them two-draw; no coverage block    | gains a coverage block  |
| `core/tests/arbitraries/model.ts`    | tuned by barwise-968; exports `arbOrmModel`, `SEED`, `RUNS` | untouched               |
| `core/tests/laws/mapper.law.test.ts` | five measured floors over single draws                      | untouched; the template |
| `core/tests/laws/sample.law.test.ts` | `describe("coverage: the law is not vacuous")`              | untouched; the naming   |
| `core/src/diff/ModelMerge.ts`        | the code under law                                          | untouched               |

The helpers the coverage block needs -- `names`, `subtypePairs`,
`objectificationPairs`, `populationKeys`, `mergeAll` -- already exist in
`merge.law.test.ts` as module-level functions, below the describes that
use them. The block reuses them rather than restating the projections,
which is what keeps the floors measuring the same dimensions the laws
assert on; a second copy of `objectificationPairs` would be a
must-agree copy with no check, and the floors would drift off the
clause they exist to defend.

## Target architecture

```ts
// merge.law.test.ts, after the two law describes.

describe("coverage: the laws are not vacuous", () => {
  // Same seed, same numRuns, same arbitrary as the properties above,
  // so these are the pairs the laws actually see -- verified by
  // counting collisions from inside the property and getting 69 both
  // ways (docs/specs/pair-coverage-floors.spec.md).
  const pairs = fc.sample(fc.tuple(arbOrmModel(), arbOrmModel()), {
    seed: SEED,
    numRuns: RUNS,
  });

  const differing = (project: (model: OrmModel) => string[]): number =>
    pairs.filter(([existing, incoming]) =>
      JSON.stringify(project(existing)) !== JSON.stringify(project(incoming))
    ).length;

  it("draws pairs whose objectifications differ", () => {
    // The thin one: 127 pairs of 250 have BOTH sides empty, so the
    // clause guarding the kinds mergeModels used to carry from the
    // existing model asserts [] toEqual [] more often than not.
    expect(differing(objectificationPairs)).toBeGreaterThanOrEqual(60);
  });

  // ... one per dimension, plus the residual-delta floor for the
  // second law, whose loop body runs in 224 pairs of 250.
});
```

## Alternatives considered

- **Filter the pair so the two models always differ.** A
  `fc.pre(existing !== incoming)` or a filtered arbitrary would make
  every run discriminate. It also narrows the law: two identical models
  are a legitimate input to merge -- arguably the most common one in
  practice, since a reviewer merges a model against its own
  near-duplicate -- and a law that no longer covers them is a weaker
  law bought with a stronger-looking number. Rejected: the fix is to
  measure the premise, not to delete the inputs that fail it.

- **Assert the laws fail under a deliberate argument swap.** Inline
  mutation: run each law with `mergeAll(incoming, existing)` and expect
  red. This measures the thing itself rather than a proxy for it, and
  it is what `scripts/mutate.mjs` is for -- from outside the file, on
  demand, not as a permanent test that must construct and swallow its
  own failure. Rejected here, but it is the right way to verify this
  workstream: see Risks and testing.

- **Raise the objectification rate in the arbitrary until the pair
  count is comfortable.** The direct fix for the thinnest row, and the
  lever barwise-968 already reached for. It changes the five numbers
  that spec recorded, so it is a decision with a blast radius rather
  than a detail. Carried to Open decisions rather than taken.

- **Leave it; the laws are true and 120 of 250 is plenty.** It is
  plenty today. The objection is that nothing says so on the page, and
  the count is one generator change from being 12 -- which is the
  argument barwise-968 already won, against a row that was sitting at
  5 and had been at 2 the cycle before.

## Workstreams (each independently shippable)

### 1. The coverage block

One `describe` added to `merge.law.test.ts` with seven floors, reusing
the projection helpers already in the file. No source change, no
generator change, no change to the laws. The whole workstream is test
code, so its blast radius is the core suite's runtime: the block adds
one 250-pair sample and 250 merges, which is the same work the two laws
already do, so roughly a third more time in this one file.

Acceptance: when the generator stops producing pairs that differ in a
dimension, the merge law suite fails naming that dimension and its
measured count.

### 2. The arbitrary's objectification rate (provisional: not yet grounded, and may not be built)

Only if Open decision 1 resolves toward raising it. Would re-measure
and update the five floors in `mapper.law.test.ts` and the table in
`generator-coverage-floors.spec.md` in the same commit, since those
numbers are the record of what the generator does.

## Open decisions (for review)

- **Raise the single-model objectification rate, or accept 120 of 250?**
  Options: (a) leave the generator alone, land WS1 only, and let the
  floor at 60 hold the line -- the objectification clause has real
  evidence in 120 pairs, which is more than the mapper's composite
  foreign key had at 18; (b) add a fourth lever to the arbitrary
  biasing toward objectification, then re-measure and update the five
  mapper floors and the predecessor spec's table. Recommended: (a).
  The clause is adequately covered today; what was missing was the
  statement of by how much, and WS1 supplies that. (b) spends a
  generator change and a spec revision to improve a row that is not the
  weakest evidence in the file.

- **Should the residual-delta floor be a floor, or should the loop
  become an assertion that cannot pass empty?** Options: (a) a floor at
  120, matching the other six and leaving the loop as written; (b)
  rewrite the second law to assert on the residual list as a whole
  (`expect(residual.map(describeDelta)).toEqual(...)`) so an empty
  residual is compared rather than skipped. Recommended: (a) for this
  spec, because (b) edits a law and this spec's whole claim is that the
  laws are correct as written. (b) is the better end state and belongs
  in its own change.

## Risks and testing

- **The floors must be verified red, not assumed.** A coverage
  assertion is exactly the kind of check barwise-906 keeps catching: it
  passes on arrival, and a green arrival is what a floor set below its
  own measurement looks like whether or not it can ever fail. Verify
  with `npm run mutate` -- raise one floor above its measured count,
  confirm the suite goes red naming that dimension, confirm the restore
  -- rather than by reading the numbers and believing them.
- **The sample must track the properties.** If a later change alters
  `SEED`, `RUNS`, or the arbitrary, the floors and the laws move
  together only because they read the same three symbols. They do; the
  block imports nothing of its own.
- **Behavior that must not change:** none. No source file is touched
  and the five existing properties are not edited, so the core suite's
  1562 tests stay green with seven added.
- **Node version.** The pinned runtime is 26.7.0 (`.nvmrc`); coverage
  thresholds are not portable across Node majors (CLAUDE.md). This
  workstream adds test code only, which moves coverage up if at all,
  but the reading that matters is CI's.

## Implementation notes (WS1)

Landed as specified: one `describe("coverage: the two-draw laws are not
vacuous")` in `merge.law.test.ts`, seven floors, reusing the file's
existing projection helpers. Twelve tests in the file, up from five.

Two things the draft did not anticipate:

- **The floors were verified against generator collapse, not against
  themselves.** The draft's Risks section proposed raising a floor above
  its measured count to watch it go red, which only proves
  `toBeGreaterThanOrEqual` works. The stronger reading was available for
  the same effort: `npm run mutate` zeroing `toObjectified(raw.objectified,
  ...)` to `toObjectified([], ...)` in the arbitrary, so the generator
  produces no objectifications at all. Result: `objectification pairs: 0
  of 250 pairs differ, floor is 60`, exit 0 (CAUGHT), restore verified.
- **All five laws stayed green under that mutation.** Deleting
  objectifications from the generator entirely does not fail a single
  law -- it silently removes the evidence for the clause that guards the
  kinds `mergeModels` used to carry from the existing model. That is the
  spec's claim demonstrated rather than argued, and it is the reason the
  floors are tests rather than a comment recording the measurement.

## Non-goals

- No new capability on any surface; the capability matrix is untouched.
- No change to `mergeModels`, `diffModels`, or the five laws.
- No sweep of the other law files' floors, and no claim that they are
  well chosen.
- No change to `arbOrmModel` in WS1.
