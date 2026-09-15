# The layout's invariants, asserted over generated models rather than drawn

Status: Implemented. WS1 shipped; two things the draft had wrong are recorded
in Implementation notes below

Created: 2026-09-15
Last-updated: 2026-09-15
Tracking: barwise-1023 (no agent can see the UI it renders) and barwise-1024
(property tests exist only in `core`). One spec because the two findings turn
out to name the same work from opposite ends: 1024's own text proposes the
diagram layout invariants as its first candidate outside `core`, and those
invariants are exactly the defects 1023 wants a renderer to catch.

In one sentence: the layout already computes whether its nodes overlap and
nothing asserts the answer is zero, so the cheapest way for an agent to
self-validate a layout change is a law suite over `PositionedGraph` -- no
browser, no rasteriser, no golden image.

## Principle

**Look at the shadow, ratchet on the property**, and **determinism in the
core** -- which together decide that this is geometry rather than pixels.

CLAUDE.md's shadow paragraph names the pattern: a cheap observable correlates
with the thing you care about through some mechanism, and diverges exactly
where the mechanism is bypassed. barwise-1023 states the divergence precisely:
a golden SVG string proves the serialisation did not change, correlating with
"the diagram is legible" through "the renderer is deterministic", and diverging
where the SVG is valid, byte-stable and visually wrong.

The move the issue proposes is to add a renderer. The cheaper move, and the one
that catches the defects it actually names, is to assert the property directly.
"Overlapping roleboxes" and "a predicate reading off-canvas" are not facts about
pixels; they are facts about rectangles, and `PositionedGraph` carries every
rectangle as `x`, `y`, `width`, `height`. A raster can only rediscover them by
drawing first.

That matters beyond cost. Layout is deterministic and pure -- same model, same
`PositionedGraph` -- so a geometric law is a law, reproducible on any machine
with no browser, no font, and no golden file to regenerate. A screenshot
assertion is none of those things, and the repository already knows what that
costs: `.nvmrc` is pinned because v8 coverage numbers are not portable across
Node versions.

## What this does NOT catch, stated up front

A geometric law cannot see anything that depends on how text is measured: a
label clipped because the real font is wider than the layout's estimate, a
predicate reading overflowing its role box, a glyph that renders as tofu. Those
are precisely the defects a rasteriser would find and this will not.

So barwise-1023 is **narrowed, not closed**, by this spec. The share it closes
is the share its own acceptance criterion emphasises -- "a layout defect that
leaves the SVG well-formed" -- and the text-metric remainder stays open with
this spec named as what already covers the geometry. Whether that remainder is
worth a rasteriser is a separate decision with its own cost, and it is better
made once the cheap half is in place and it is clear what still escapes.

## The reading (resolved: all three invariants already hold, exactly)

Measured before writing any property, over all thirteen `.orm.yaml` models in
the repository -- ten promptlab reference models and three diagram-ui golden
fixtures -- by laying each one out and inspecting the `PositionedGraph`:

| Invariant                                         | Result                             |
| ------------------------------------------------- | ---------------------------------- |
| No two node rectangles overlap                    | 0 overlapping pairs, all 13 models |
| Every node lies inside the declared viewBox       | true, all 13 models                |
| Every edge endpoint references a node that exists | 0 dangling, all 13 models          |
| Every edge's first/last point lies on its node    | exact -- worst tolerance **0px**   |

Node counts ranged 6 to 26, edge counts 2 to 24. The fourth row is the one that
justifies asserting equality rather than a fudge factor: edge endpoints are not
merely close to their node boundaries, they are on them.

This matters because a property nobody measured first is a guess, and a guessed
property that turns out to be false wastes a reviewer's time arguing about the
tolerance instead of the design.

## Should this reuse `core`'s arbitrary? (resolved: no)

`core/tests/arbitraries/model.ts` is 1003 lines and exports `arbOrmModel()`. It
is not reused, and the reason is measured rather than architectural:

**It names every object type `T0`, `T1`, ... and every fact type `F0`, `F1`.**
Fixed, uniform, two characters. Node width in a layout is derived from its
text, so name length is the single strongest lever on whether two rectangles
collide -- and an arbitrary that holds it constant produces uniformly sized
boxes that the placement engine spaces out comfortably every time. Feeding that
to these laws would be the degenerate corpus
`pair-coverage-floors.spec.md` warns about: 250 runs over inputs that cannot
discriminate is one trial repeated. Core holds names uniform correctly, because
nothing it tests depends on them.

DRY is secondary here by the repository's own rule, so a focused arbitrary in
`diagram` is parallel code rather than a must-agree copy: neither has to match
the other for either to be correct.

**The draft gave a different first reason and it was wrong.** It said reuse
would require either reaching into another package's `tests/`, "which
`depcruise` exists to prevent", or promoting the arbitrary to `core`'s public
API. Neither holds: three existing diagram tests already import
`../../../core/tests/helpers/ModelBuilder.js` across exactly that boundary, and
the package's own CLAUDE.md documents the practice. The conclusion survives on
the name-length reading alone, which is the stronger argument anyway; the
architectural objection was invented and would have misled a reviewer into
thinking the option was closed when it was merely wrong.

The risk this accepts is the one `pair-coverage-floors.spec.md` names -- 250
runs over inputs that cannot discriminate is one trial repeated. The
countermeasure is in Risks below and is non-negotiable: the arbitrary is only
accepted once a planted layout defect makes the laws fail.

## Scope

In scope:

- When a model is laid out, the system shall produce a `PositionedGraph` in
  which no two node rectangles intersect with positive area.
- When a model is laid out, the system shall produce a `PositionedGraph` in
  which every node lies within the declared viewBox.
- When a model is laid out, the system shall produce a `PositionedGraph` in
  which every edge's `sourceNodeId` and `targetNodeId` name nodes present in
  the graph.
- When a model is laid out, the system shall produce a `PositionedGraph` in
  which every edge's first and last points lie on the rectangles of its source
  and target nodes.
- The arbitrary shall vary object-type count, fact-type count and arity,
  connectivity, subtyping, objectification, and **name length**, and shall
  generate only models `core` accepts as valid.

Out of scope:

- Text-metric defects (clipping, overflow, font substitution). Named above;
  stays on barwise-1023.
- The React canvas and the VS Code webview. This spec covers the layout that
  feeds both, which is where a layout defect originates.
- Aesthetic quality -- edge crossings, symmetry, cluster balance. Those are
  preferences with no true answer, and `computeLayoutMetrics` already reports
  them for a human to read.
- Property suites for `formats` and `learn`, barwise-1024's other two
  candidates. This closes its diagram half; the issue stays open for them.

## Inventory

| Module                                           | Current state                                        | Verdict                      |
| ------------------------------------------------ | ---------------------------------------------------- | ---------------------------- |
| `packages/diagram/src/layout/metrics.ts`         | computes `nodeOverlapCount`; nothing asserts it is 0 | untouched -- the laws use it |
| `packages/diagram/tests/layout/metrics.test.ts`  | tests the metric function on hand-built graphs       | untouched                    |
| `packages/diagram/tests/arbitraries/layout.ts`   | does not exist                                       | new: the focused arbitrary   |
| `packages/diagram/tests/laws/layout.law.test.ts` | does not exist                                       | new: the four laws           |
| `packages/diagram/package.json`                  | no `fast-check`                                      | gains it as a devDependency  |
| `packages/core/tests/arbitraries/model.ts`       | 1003 lines, test-local                               | untouched, not imported      |

`metrics.ts` is the load-bearing "untouched": the overlap predicate already
exists and is already tested, so the laws consume it rather than restating what
an overlap is. That is the difference between adding a law and adding a second
definition of the same geometry.

## Target architecture

```
packages/diagram/tests/arbitraries/layout.ts
  arbLayoutModel(): fc.Arbitrary<OrmModel>
      object types     1..8, entity and value, names 1..40 chars
      fact types       0..6, arity 1..3, players drawn from the object types
      subtypes         0..3 pairs, acyclic by construction
      objectification  some fact types objectified
      SEED / RUNS      pinned, as core's law suites pin them

packages/diagram/tests/laws/layout.law.test.ts
  for each generated model, layoutGraph(modelToGraph(model)) then:
      no two nodes overlap          (computeLayoutMetrics().nodeOverlapCount)
      every node inside the viewBox
      every edge endpoint resolves to a node
      every edge terminates on its endpoints' rectangles
```

## Alternatives considered

- **A headless rasteriser over the existing SVG.** Catches the text-metric
  defects geometry cannot. Costs a native dependency and a golden corpus that
  must be regenerated on every deliberate layout change -- and a golden image
  is the same shadow as a golden string, one representation further along.
  Recorded as the remaining half of barwise-1023 rather than rejected.
- **Playwright over the React canvas.** Closest to what a user sees and the
  only option that covers interaction. Heaviest to run, and it would catch
  these four invariants only indirectly, by drawing them.
- **Assert the metrics in the existing golden tests.** Cheapest of all: add
  `expect(metrics.nodeOverlapCount).toBe(0)` to the three golden fixtures.
  Rejected as insufficient rather than wrong -- it is three models, chosen by a
  human, which is the condition that let the invariant go unasserted while the
  metric to check it sat in the same directory. It is worth doing anyway and
  costs nothing, but it is not what barwise-1024 asks for.

## Workstreams (each independently shippable)

### 1. The arbitrary and the four laws

One workstream: the laws without the arbitrary are the golden-fixture
alternative above, and the arbitrary without the laws generates nothing.

Accepted only when a planted layout defect makes the laws fail -- see Risks.

## API and migration impact

- No public API changes. Both new files are under `tests/`.
- `fast-check` becomes a devDependency of `@barwise/diagram`. It is already a
  devDependency of `core`, at `^4.9.0`; the same range is used so the workspace
  resolves one copy.
- `@barwise/diagram`'s test time grows by the law suite. `RUNS` is pinned and
  chosen against measured runtime rather than copied from `core`, because a
  layout is orders of magnitude more expensive per case than a mapper call.

## Open decisions (all three resolved by WS1; recorded as asked)

- **How many runs.** `core` pins `RUNS = 250`. A layout invokes ELK and is far
  slower, so the same number may not be affordable. Recommend measuring and
  pinning the largest number that keeps the diagram suite under roughly ten
  seconds, and stating the measured figure in the file -- an unexplained
  `numRuns` is the thing `pair-coverage-floors.spec.md` warns about.
- **Whether to assert edge termination exactly or with a tolerance.** Measured
  worst case is 0px across 13 models, which argues for exact. A tolerance of a
  fraction of a pixel would be defensible insurance against a future
  floating-point change in ELK, at the cost of a law that no longer says what it
  means. Recommend exact, and revisit if it ever fires for that reason.
- **Whether barwise-1023 should stay open.** Recommend yes, narrowed to the
  text-metric half with this spec named. Closing it would record a coverage
  claim broader than what landed.

**Resolved.** Runs: 60, measured at roughly 25ms per model through ELK,
which keeps the law suite near two seconds -- the recommendation asked for
the largest number under ten, and the pre-commit hook's budget is the
tighter constraint. Tolerance: exact, as recommended, on the measured 0px.
barwise-1023: stays open, narrowed to the text-metric half.

## Risks and testing

- **The arbitrary must be shown to discriminate, and this is the gate on the
  whole workstream.** A generator that never produces a crowded layout would
  pass all four laws against a layout engine that had been deleted. Acceptance
  is a planted defect -- disabling `CollisionResolver`, or removing the
  viewBox-fitting adjustment -- making the corresponding law fail, verified
  through `npm run mutate` and read as a test COUNT, not just a verdict
  (barwise-1019, met twice this month).
- **A law that fires on a real model is a bug report, not a law to weaken.**
  All four were measured true on all thirteen committed models before being
  written down. If one fires during implementation on a generated model, the
  first question is whether the layout is wrong, not whether the property is
  too strict.
- **Runtime.** The diagram suite is in the critical path of `npm test` and the
  pre-commit hook. Measure before pinning `RUNS`.

## Implementation notes (deviations from the draft)

**One of the four laws as drafted was a tautology, and reading the code is what
showed it.** The draft's second law was "every node lies inside the declared
viewBox". `computeBounds` takes the min and max over the node rectangles (plus
edge routes) and adds padding -- so the box is DERIVED from the nodes, and the
law could not fail. That is a check with no reachable failure path, the thing
`audit:rubric` exists to flag, shipped in the very suite meant to add coverage.

Restated over ALL drawn geometry, it is reachable and mutation-verified:
negating the padding shrinks the box below its content and exactly that law
fires. Constraint edges are included and are the one input `computeBounds`
genuinely omits -- but this arbitrary does not generate constraints, so that
clause is correct and currently unexercised. Said in the test rather than
counted as coverage.

**The arbitrary discriminates, which was the gate on the whole workstream.**
Four mutations, each failing the law it should:

| Planted defect                     | Laws that fired                      |
| ---------------------------------- | ------------------------------------ |
| collision resolution skipped       | overlap, edge termination            |
| viewBox padding negated            | every drawn point inside the viewBox |
| an edge's source id made to dangle | endpoints resolve                    |
| coordinate normalization skipped   | none -- see below                    |

The fourth is worth recording as a NON-finding: skipping `normalizeCoordinates`
leaves the layout internally consistent (nodes at negative coordinates, a box
computed to match), so no law fires and none should. A generator that made it
fire would be asserting a preference, not an invariant.

**`RUNS` is 60, not core's 250, and the number is measured.** A layout invokes
ELK at roughly 25ms per generated model against well under 1ms for a `core` law
case; 60 keeps the suite at ~2.1s, which is what a suite in the pre-commit
hook's path can afford. An unexplained `numRuns` is what
`pair-coverage-floors.spec.md` warns about, so the measurement is the comment.

## Non-goals

- No renderer, no browser, no golden images, no new runtime dependency.
- No changes to the layout engine itself. If a law fires, that is a finding to
  file, not a fix to smuggle into this spec.
- No property suites for `formats` or `learn`.
