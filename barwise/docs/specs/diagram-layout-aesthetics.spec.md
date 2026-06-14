# Diagram layout aesthetics: measurable and safe to tune

Status: Draft for review (design only -- no implementation in this PR)
Tracking: REPO_REVIEW-2026-06.md finding T5 (SVG / diagram visual
regression); follows the A1 ElkLayoutEngine decomposition
(`diagram-layout-decomposition.spec.md`)

## Principle

The diagram layout is deterministic, but its aesthetic quality rests on
about a dozen hand-tuned magic numbers with no regression guard. The ELK
stress parameters live inline in `EntityPlacement.ts` (three different
`desiredEdgeLength` / `nodeNode` triples), and `ARC_RADIUS`,
`ARC_ANGLE_RANGE`, `SPOKE_DISTANCE`, and `NUDGE_DISTANCE` live inline in
`PostAdjustments.ts`. Nothing protects the visible result: T5 records
that "nothing protects layout behavior," so any change to these numbers
ships blind.

This is the payoff the A1 decomposition set up. Tuning these levers was
risky while they sat in a 1,812-line file mixing ELK interop, geometry,
and routing; now each lever lives in a single-responsibility module. But
isolation alone does not make tuning _safe_. Before changing an aesthetic
parameter, we need a guard that says what moved -- and a measure of
whether it moved in a good direction. This spec adds both, then takes one
tuning pass behind them. It serves determinism (the guard pins the
deterministic output) and explicit-over-implicit (named, documented
parameters replace inline magic numbers).

## Should we golden the rendered SVG? (resolved: yes, with quantization)

Real ELK layout is deterministic run-to-run: rendering
`examples/models/diagram-layout.orm.yaml` twice produces byte-identical
SVG. So golden files are viable. The one obstacle is that coordinates
flow into the SVG at full float precision (`viewBox="10 10
1125.0117692528574 1552.59..."`, node `x="771.9097335333806"`), and that
precision is where cross-platform floating-point drift would surface --
a golden generated on macOS could differ in low-order digits from one
checked on the CI ubuntu runner.

Quantizing coordinates to integer pixels in the rendered output removes
that exposure: sub-pixel FP noise rounds away, the golden becomes
platform-robust, and the SVG shrinks. Rounding to whole pixels is below
the threshold of visual difference for a diagram, so it costs no
fidelity. With quantization, an exact-match golden is a sound guard for
the deterministic pipeline.

Real ELK output still cannot be golden-pinned across an ELK _version_
bump (the algorithm may move nodes). That is what the layout metrics
(workstream 2) are for: aggregate measures with tolerances, robust to
small coordinate shifts.

## Scope

In scope:

- Coordinate quantization in the rendered SVG so golden files are stable.
- A golden-file regression guard over a small corpus of representative
  models -- the T5 deliverable.
- A small set of pure layout-quality metrics over `PositionedGraph`
  (overlap count, total edge length, bounding-box aspect ratio), asserted
  with tolerances on real-ELK output.
- Surfacing the inline magic numbers as named, documented layout
  parameters.
- One initial aesthetic tuning pass, its golden and metric deltas
  reviewed as intentional.

Out of scope:

- Webview screenshot diffing (a heavier path tied to T1's webview test
  gap; the SVG guard covers the layout). Named here so the boundary is
  explicit.
- Changing the ELK algorithm or adding a different layout engine.
- New diagram features, notation, or `.orm.yaml` changes.

## Inventory

The tunable levers, all currently inline literals:

| Lever                           | Module          | Value           | Governs                                      |
| ------------------------------- | --------------- | --------------- | -------------------------------------------- |
| `stress.desiredEdgeLength` (3x) | EntityPlacement | 350 / 450 / 600 | spacing of entities, clusters, sub-clusters  |
| `spacing.nodeNode` (3x)         | EntityPlacement | 200 / 300 / 250 | minimum entity separation                    |
| `stress.iterationLimit`         | EntityPlacement | 300             | convergence vs. runtime                      |
| `NUDGE_DISTANCE`                | EntityPlacement | 40              | boundary-entity pull toward neighbor cluster |
| `ARC_RADIUS`                    | PostAdjustments | 180             | subtype fan distance from supertype          |
| `ARC_ANGLE_RANGE`               | PostAdjustments | 135 deg         | subtype fan spread                           |
| `SPOKE_DISTANCE`                | PostAdjustments | 200             | leaf value-type distance from hub            |

The `render/theme.ts` dimension constants (box sizes, bar offsets) are
_not_ in scope: they are render geometry, already centralized, and the
golden files pin them for free. This spec is about the placement levers.

## Target architecture

```
@barwise/diagram
  src/layout/
    layoutParams.ts       NEW: named placement constants (the inline
                          literals above), each with a rationale comment
    EntityPlacement.ts    reads stress/spacing/nudge from layoutParams
    PostAdjustments.ts    reads arc/spoke constants from layoutParams
    metrics.ts            NEW: pure PositionedGraph -> quality metrics
                          (overlap count, total edge length, aspect ratio)
  tests/layout/
    metrics.test.ts       metric assertions with tolerances, real ELK

@barwise/diagram-ui
  src/renderDiagramSvg.tsx  rounds coordinates to integer px (quantize)
  tests/golden/
    <model>.svg             pinned golden per corpus model
    golden.test.tsx         render -> compare; UPDATE=1 rewrites goldens
```

The corpus models are drawn from `examples/models/` plus a handful of
small fixtures that isolate one feature each (a subtype fan, a hub with
leaf value types, a cluster split), so a golden diff points at the lever
that moved.

## Workstreams (each independently shippable)

Ordered so the guard exists before anything it guards changes.

### 1. Coordinate quantization and the golden-file guard

Round coordinates to integer pixels in `renderDiagramSvg`, then add
`tests/golden/` in `@barwise/diagram-ui`: render each corpus model and
assert byte-equality against a checked-in `.svg`, with an `UPDATE=1`
escape hatch that rewrites the goldens (the dprint-fmt pattern). This is
the T5 deliverable and the safety net for every later workstream, so it
lands first and changes no placement behavior -- only the rounding.

### 2. Layout quality metrics

Add `metrics.ts` in `@barwise/diagram`: pure functions over
`PositionedGraph` returning node-overlap count, total edge length, and
bounding-box aspect ratio. Assert tolerance ranges on real-ELK output for
the corpus in `metrics.test.ts`. These guard `EntityPlacement`'s ELK
parameters, which the mocked-ELK unit tests and (across an ELK version
bump) the exact goldens cannot. Independent of workstream 1; either order
works, but both precede tuning.

### 3. Surface the placement parameters

Move the inline literals into `layoutParams.ts` as named constants with
rationale comments; `EntityPlacement` and `PostAdjustments` read from it.
Pure relocation -- no value changes -- so the workstream-1 goldens stay
byte-identical, proving no behavior moved. After this, a tuning change is
a one-line edit to a documented constant.

### 4. Initial aesthetic tuning pass

With the guard and metrics in place, adjust the levers (candidate: the
sample model lays out tall, ~1:1.4 portrait; the leaf spokes and edge
lengths are the levers for that). Each change is reviewed as a golden
diff plus a metric delta, accepted as intentional. Scope kept to one
pass; further tuning is follow-up against the same guard.

## API and migration impact

- No public API change. `layoutParams.ts` and `metrics.ts` are additive;
  `renderDiagramSvg` keeps its signature (only its output rounds).
- Blast radius is internal to `@barwise/diagram` and `@barwise/diagram-ui`.
  The CLI and MCP call `renderDiagramSvg` and get rounded coordinates --
  a strictly cosmetic change to their SVG output.
- The golden corpus and the quantization mean the `validate:examples` CI
  step keeps exercising real ELK end to end.

## Open decisions (for review)

- **Golden the SVG, or the `PositionedGraph` JSON?** Recommend the
  rendered SVG (in `@barwise/diagram-ui`): a reviewer opens before/after
  in a browser, which is the point of an _aesthetics_ guard. The
  alternative -- golden the coordinate JSON in `@barwise/diagram`, no
  diagram-ui dependency, more minimal -- is less reviewable for visual
  change. The metrics (workstream 2) already give the layout package a
  guard, so the SVG golden's home in diagram-ui is not a coverage gap.
- **Rounding granularity.** Recommend integer pixels: maximal FP-noise
  absorption, no visible cost. One decimal place is the fallback if any
  corpus diagram shows rounding artifacts at integer resolution.
- **Corpus membership.** Which `examples/models/` entries plus how many
  feature-isolating fixtures. Recommend three to five small fixtures over
  one large model, so a diff localizes to a lever.

## Risks and testing

- Quantization changes every rendered SVG once (the rounding). That diff
  is the workstream-1 PR itself; after it lands, goldens are stable.
- Cross-platform FP: integer rounding is the mitigation, but the
  canonical goldens are generated and checked on the CI ubuntu runner; a
  contributor on another platform regenerates with `UPDATE=1` and the CI
  confirms. Document this next to the golden test.
- Metric tolerances must be wide enough to survive an ELK patch release
  but tight enough to catch a real regression; start loose and tighten
  with evidence, the same discipline as the coverage floors.

## Non-goals

- No pixel-perfect cross-engine reproducibility; goldens are pinned to
  the CI platform, metrics carry the cross-version guarantee.
- No change to ORM 2 notation, the model format, or the public API.
- No automatic aesthetic optimization; the levers stay explicit constants
  a human tunes behind the guard.
