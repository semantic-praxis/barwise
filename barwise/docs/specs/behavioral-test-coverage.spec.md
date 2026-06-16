# Behavioral test coverage as a refactor safety net

Status: Draft for review (plan only -- no tests in this PR)
Tracking: testing track; precedes the architecture refactor discussed in
`docs/architecture-analysis.spec.md`

## Principle

Lock what the model features _do_ before the refactor moves code, so any
behavior drift fails a test rather than shipping. This serves
composability and determinism: the model features are pure and
deterministic, so their behavior can be pinned exactly. Two complementary
nets cover it -- characterization over the real example corpus (exact
outputs on real models) and property-based round-trip over generated
models (the core invariants on inputs no fixture thought to write).

## Finding: the committed golden outputs are stale

`examples/output/` holds `*.verbalizations.txt` and `*.diagnostics.txt`
goldens, but nothing regenerates or compares them, and they have drifted
on every axis: the `*.orm.yaml` model copies differ from the canonical
sources, the verbalizations do not match even their sibling model copy,
and the diagnostics use an old `[warning] <ruleId>: <msg>` format the
current CLI no longer prints. They give false confidence today. The
characterization net is built fresh rather than on top of them; cleaning
up the stale directory is a separate, noted follow-up.

## Scope

In scope: (1) live golden characterization over a fixed set of canonical
example models, with a regeneration script and a comparison test; (2)
seeded property-based round-trip tests for serialization and
counterexamples.

Out of scope: the architecture refactor itself; pixel-exact diagram SVG
snapshots (use structural invariants); repurposing or deleting the stale
`examples/output/` beyond noting it; the non-model surfaces.

## Approach

### Characterization (golden files, not inline snapshots)

Golden _files_ match the repo's existing practice and avoid the brittle
inline-snapshot style core's `CLAUDE.md` warns against. A regeneration
script writes, for each model in a fixed set, the current `verbalize` and
`validate` text output and a `ddl`/`openapi` export into a golden
directory under the test. A vitest test regenerates in-process and
asserts equality; a legitimate behavior change updates the goldens by
re-running the script, so the diff is reviewed deliberately. The model
set spans the constraint-rich and cross-fact-type cases (the
`test-plan/fixtures` models) plus two real transcripts, so the net covers
both exotic constraints and realistic shapes.

### Property-based round-trip (seeded, no new dependency)

A small seeded pseudo-random generator builds arbitrary valid
`OrmModel`s (object types, fact types, roles, a spread of constraints).
Determinism is preserved by seeding, so a failure reproduces from its
seed. Two properties run over many seeds:

- _Serialization is lossless._ Serialize then deserialize yields a
  structurally equal model.
- _Counterexamples round-trip._ Every counterexample
  `generateCounterexamples` returns trips its own rule when its forbidden
  populations are fed back through validation -- the model-wide guard
  (workstream 1 of the model-feature review) generalized from one curated
  model to generated ones.

## Workstreams (each independently shippable)

### 1. Characterization goldens + regeneration script

A regeneration script, the committed goldens, and a comparison test over
the fixed model set. Notes the stale `examples/output/` for separate
cleanup.

### 2. Property-based round-trip

The seeded model generator plus the serialization and counterexample
properties, in `core`.

## Open decisions (for review)

- **Add `fast-check`, or hand-roll the generator?** Recommend hand-roll a
  small seeded generator: it keeps determinism in core, avoids a new
  dependency (the project's "no trivial dependencies" rule), and the
  generator we need is modest. Revisit if the properties grow.
- **Where do goldens live, and what about `examples/output/`?** Recommend
  goldens under the test package as fixtures, and a separate follow-up to
  regenerate or delete the stale `examples/output/` so the repo carries
  one golden set, not two.
- **Diagram characterization depth.** Recommend structural invariants
  (well-formed SVG, expected node count) over pixel-exact snapshots,
  which are brittle and layout-sensitive.

## Risks and testing

- Goldens must change only by intentional regeneration; the script makes
  that a reviewed diff, and the comparison test fails on any unreviewed
  drift -- exactly the refactor safety net.
- Property tests are seeded, so a failure is reproducible; the generator
  only emits valid models so a failure means a real round-trip defect.
- No production code changes; both workstreams are test-only.

## Non-goals

- Not the architecture refactor, and not a constraint on it -- these
  tests exist to make it safe.
- Not performance benchmarking; not VS Code or diagram-rendering tests.
