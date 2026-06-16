# Model-feature review program

Status: Draft for review (plan only -- no code or fix specs in this PR)
Tracking: follow-up to the sensemaking program; complements the
structural audit in `docs/REPO_REVIEW-2026-06.md`

## Principle

The model features are the deterministic heart of `@barwise/core`, and
they grew fast across the phasing plan with uneven spec and review rigor:
some areas (relational mapping, serialization) carry dense round-trip
suites and old specs, while the newest layer (counterexamples, anchors,
external uniqueness, the reasoning trail) shipped in a rapid arc whose
specs were written under time pressure and, in one case, after the code.
`REPO_REVIEW-2026-06.md` audits the monorepo's _structure_ -- layering,
CI, testing posture, docs -- but explicitly not whether each model
feature is _correct, principled, and accurately specced_. This program
fills that gap: a per-area audit against three lenses, each area emitting
its own fix spec for what it finds.

## The three lenses

Every area is read against all three; a finding names which lens caught
it.

- **Correctness / round-trip.** Behavior bugs, unhandled edge cases, and
  completeness of the guarantees the area claims -- above all the
  counterexample round-trip (a generated counterexample must, fed back
  through population validation, trip the rule it was generated for) and
  serialization round-trip (lossless save/load). Includes the known
  skip behaviors: external uniqueness skips an un-inferable join, the
  spanning checks skip the local case.
- **Principle adherence.** Determinism in core (same input, same output;
  no clock, network, or randomness), orthogonality, composability, and
  explicit-over-implicit. A pure-core area that reaches for I/O or
  non-determinism is a finding.
- **Spec & doc accuracy.** Does the area's spec and the package
  `CLAUDE.md` still describe the shipped code? Drift between stated
  intent and implementation is a finding even when the code is correct.

## Method

Per area: read the source and its spec/`CLAUDE.md`; run the area's
existing vitest suite plus the `test-plan/` harness where it exercises
the area; for the validation, counterexample, and serialization areas,
generate a fresh adversarial fixture and confirm the round-trip both
ways. Record findings, then write a fix spec (`docs/specs/<area>.spec.md`)
for any area with actionable issues, or a one-line "reviewed, clean" note
in this plan's tracking table for an area that needs none.

## Scope

In scope: every model-related area of `core` (the metamodel,
serialization and the JSON schemas, validation, verbalization,
counterexamples, the query DSL, relational mapping and the export
formats, diff/merge, projects and context mapping) plus the
model-derived artifacts in `llm` (the reasoning trail and candidate
framing). The model-adjacent areas (`lineage`, `describe`, `annotation`,
`import`) are reviewed last and only against correctness and doc
accuracy.

Out of scope: diagram layout and rendering, the VS Code UI, the LLM
extraction prompts and provider plumbing, and the CI/tooling/process
items already cataloged in `REPO_REVIEW-2026-06.md`. Surface plumbing
(CLI/MCP wiring) is covered only as cross-area parity, not per area.

## Inventory

Ordered by review priority: highest-uncertainty (newest, thinnest spec
history) first.

| Area                       | Source                                  | Primary risk                                    |
| -------------------------- | --------------------------------------- | ----------------------------------------------- |
| Counterexamples            | `counterexample/`, `externalUniqueness` | Round-trip completeness across all constraints  |
| External uniqueness        | `externalUniqueness.ts`, `validation/`  | Join inference; broader-shape skip is correct   |
| Verbalization              | `verbalization/`                        | External-uniqueness role resolution (see seed)  |
| Anchors + reasoning trail  | `query/`, `llm/ReasoningTrail.ts`       | Determinism of anchors; trail/fallback          |
| Validation engine          | `validation/` (8 files)                 | Rule coverage, spanning vs local, skips         |
| Metamodel invariants       | `model/` (18 files)                     | Constructor invariants, subtype/objectification |
| Serialization + schemas    | `serialization/`, `schemas/`            | Lossless round-trip; schema/serializer sync     |
| Relational mapping         | `mapping/`, `export/`, `format/`, `sql` | Rmap correctness; per-format fidelity           |
| Diff / merge               | `diff/`                                 | Rename detection, three-way merge edge cases    |
| Projects + context mapping | `project/`, context-mapping schema      | Cross-domain reference resolution               |
| Model-adjacent (last)      | `lineage/`, `describe/`, `annotation/`  | Doc accuracy; correctness only                  |

## Seed findings (verify first)

These are already on record from the sensemaking specs; confirm or close
each before hunting wider.

- **Verbalizer resolves external-uniqueness roles against the owner fact
  type.** `external-uniqueness.spec.md` notes this is wrong for the true
  cross-fact-type case. Confirm the symptom and scope the fix (a
  verbalization workstream finding).
- **External uniqueness skips broader shapes.** Validation and the
  counterexample handle only the binary-fact-type pattern and skip
  n-ary/ambiguous joins. Confirm the skip is silent and sound (no false
  positives), and decide whether broadening is in scope or deferred.
- **`Counterexample.forbidden` is an array.** Confirm every cross-fact-
  type generator populates one population per involved fact type and the
  round-trip holds for each constraint type.

## Workstreams (each independently shippable)

Each workstream audits one area and lands a fix spec (or a clean note).
They are independent and can be reordered or parallelized; the order
below is by uncertainty, highest first.

### 1. Counterexample round-trip audit

Confirm `generateCounterexamples` covers every constraint type with a
generator, and that each generated counterexample trips its rule on
feedback. Cross-check against the `verbalize --counterexamples` output in
the harness.

### 2. External-uniqueness audit

Verify `inferExternalUniquenessJoin` on the standard pattern, the
silent skip on ambiguous joins, and the violation/counterexample pair.
Decide broader-shape scope.

### 3. Verbalization audit

Confirm the seed finding on external-uniqueness role resolution; sweep
the other constraint verbalizations for owner-fact-type assumptions.

### 4. Anchors + reasoning-trail audit

Confirm `anchors` is deterministic and the trail's sidecar-vs-fallback
logic holds; check no non-determinism leaked into the core `anchors`
query.

### 5. Validation engine audit

Map every rule to a test; confirm the spanning-vs-local split and each
skip is intentional and documented.

### 6. Metamodel invariants audit

Check constructor invariants (entities require a reference mode, role
players exist) and the subtype/objectification rules.

### 7. Serialization + schema audit

Confirm round-trip is lossless for every field and the JSON schemas
match the serializers (the stated "keep them in sync" rule).

### 8. Mapping + export audit

Spot-check Rmap output and each export format (ddl, openapi, avro, dbt)
for fidelity against a constraint-rich model.

### 9. Diff/merge and projects audit

Rename detection, three-way merge conflicts, and cross-domain reference
resolution through context mappings.

### 10. Model-adjacent sweep

Correctness and doc accuracy only for `lineage`, `describe`,
`annotation`, `import`.

## Open decisions (for review)

- **Time-box or exhaustive?** Recommend time-boxing each workstream to a
  focused pass and filing a fix spec per area, rather than an open-ended
  audit. Depth follows the risk column.
- **Broader external-uniqueness shapes: in or out?** Recommend out --
  file as a deferred enhancement spec, not a fix, since the current skip
  is sound.
- **One fix spec per area, or fold clean areas into this plan?** Recommend
  a fix spec only where there are actionable findings; clean areas get a
  one-line note here, to avoid empty specs.

## Risks and testing

- The review must not regress the green suite: any fix that lands from a
  workstream keeps the full `build test lint` green and the
  counterexample/serialization round-trips intact.
- The `test-plan/` harness is the cross-surface check during the review;
  a finding that shows on one surface but not another is itself a
  finding.
- This plan changes no code; the risk is scope creep. The open decisions
  above bound it.

## Non-goals

- Not a rewrite or a redesign; the audit produces targeted fix specs, not
  architectural change.
- Not a re-audit of the structural items already in
  `REPO_REVIEW-2026-06.md`.
- Not a review of the non-model surfaces (diagram, VS Code UI, extraction
  prompts).
