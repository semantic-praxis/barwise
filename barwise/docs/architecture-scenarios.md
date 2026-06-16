# Architecture scenarios: the principle-to-scenario catalog

Status: living document. This is WS1 of the architecture-analysis
program (`docs/specs/architecture-analysis.spec.md`). It is the input to
every Phase A deep assessment and the source list for the Phase B
fitness functions.

Each of the five design pillars in the root `CLAUDE.md` is translated
here into testable modifiability scenarios in EARS phrasing. Every
scenario carries a _guard_ that says how the project defends it:

- **fitness function** -- the scenario is mechanically checkable, so it
  becomes (or already is) an automated CI gate. These are the Phase B
  backlog.
- **review** -- the scenario turns on human judgment that resists
  mechanical checking, so it stays in the periodic Phase A assessment.

The split _is_ the point. The structural pillars (orthogonality,
determinism) reduce almost entirely to fitness functions; the judgment
pillars (composability trade-offs, DRY-vs-coupling) do not, and trying
to automate them would produce noisy gates that erode trust. A scenario
marked _review_ is not a weaker scenario -- it is one we have decided a
human, not CI, should answer.

## How to read a scenario

- The EARS sentence is the testable claim: "When `<trigger>`, the system
  shall `<response>`."
- _Guard_ names the defense: a fitness function (with the check that
  implements it, and whether it exists yet) or a review (with what the
  reviewer looks at).
- IDs are stable (`S-<PILLAR>-<n>`) so a finding, a bd issue, or a
  fitness-function PR can cite the exact scenario it serves.

## Summary

| Pillar                        | Scenarios | Fitness function | Review |
| ----------------------------- | --------- | ---------------- | ------ |
| Orthogonality (primary)       | 5         | 4                | 1      |
| Composability (primary)       | 4         | 1                | 3      |
| Determinism in core (primary) | 5         | 4                | 1      |
| Explicit over implicit        | 5         | 4                | 1      |
| DRY (secondary)               | 2         | 0                | 2      |
| Total                         | 21        | 13               | 8      |

Thirteen of the twenty-one scenarios are mechanically checkable. The six
structural ones (S-ORTH-1..4, S-DET-1..3) are now gated by the Phase B
fitness functions: `dependency-cruiser` (`.dependency-cruiser.cjs`) owns
direction and cycles, and `scripts/check-core-purity.mjs` owns core
determinism. The schema-version and validation scenarios are gated by
their test suites; the rest stay advisory.

## Orthogonality (primary)

The package graph is one-way and each component owns one concern. This
pillar is the most fully automatable: direction and acyclicity are
graph properties a tool reads straight from the imports.

### S-ORTH-1 -- core depends on nothing internal

When `@barwise/core` is built, it shall import no other `@barwise/*`
package.

Guard: fitness function, _gated_ by `.dependency-cruiser.cjs` (rule
`layer-core`): core's src may not import any other package's src.

### S-ORTH-2 -- connectors depend only on core

When a connector package (`diagram`, `llm`, `code-analysis`, `dbt`,
`formats`) is built, it shall import only `@barwise/core`; `diagram-ui`
shall import only `@barwise/diagram`.

Guard: fitness function, _gated_ by `.dependency-cruiser.cjs` (the
per-package `layer-<pkg>` rules generated from the intended graph).

### S-ORTH-3 -- no connector depends on another connector

When one connector package changes, no other connector package shall
need to import from it.

Guard: fitness function, _gated_. The complement of S-ORTH-2: the
`layer-<pkg>` rules forbid connector-to-connector edges, so this falls
out of the same `.dependency-cruiser.cjs` config.

### S-ORTH-4 -- no import cycles

When any package is built, its internal modules shall contain no import
cycles.

Guard: fitness function, _gated_ by `.dependency-cruiser.cjs` (the
`no-circular` rule). This replaced the former `madge --circular` check,
so one tool now owns both direction and cycles.

### S-ORTH-5 -- one concern per module

When a module is read, its responsibilities shall map to a single
concern named by its package's `CLAUDE.md`.

Guard: review, with a warn-only file-size signal
(`scripts/check-file-size.mjs`). "One concern" is a semantic judgment a
tool cannot make, so size never gates; the warn list plus the WS2 hotspot
triage rank the candidates for the god-file work (REPO_REVIEW A1).

## Composability (primary)

Capabilities are built from small pieces that combine cleanly. This
pillar is mostly _review_: that a piece composes well is a design
judgment, not a graph property. The one automatable corner is the
boundary that composition depends on -- core must not reach _into_ the
pieces that register with it.

### S-COMP-1 -- formats compose through the registry

When a new import/export format is added, `@barwise/core` shall not
import it; the format shall reach core only by registering a
`FormatDescriptor`.

Guard: fitness function. Forbid `core` from importing any connector
format module (a direction rule, subset of S-ORTH-1). The _quality_ of
the registry seam stays a review. Not yet gated -- Phase B WS4.

### S-COMP-2 -- the three surfaces delegate, never reimplement

When a capability is exposed in the CLI, MCP server, and VS Code
extension, each surface shall obtain it by delegating to `@barwise/core`
(or a connector), not by reimplementing the logic.

Guard: review. Verified in the deep assessment by spot-checking that
surface code calls into core rather than duplicating algorithms. The
REPO_REVIEW found this holds today; the scenario keeps it honest.

### S-COMP-3 -- providers slot in through the factory

When a new LLM provider is added, calling code shall obtain it through
the provider factory, not by constructing a concrete provider.

Guard: review (with a partial fitness-function backstop). A lint that
forbids importing concrete provider classes outside the factory would
catch the worst regressions; whether the factory abstraction still fits
a new provider cleanly is a judgment. Backstop deferred; not in the WS4
scope.

### S-COMP-4 -- narrow primitives over wide options

When a new capability is designed, it shall be expressed as small
primitives that combine, rather than one wide entry point with many
flags.

Guard: review. A pure design-review scenario; assessed per change in the
spec review, not in CI.

## Determinism in core (primary)

Validation, verbalization, mapping, diff, and query are pure and
deterministic. Non-determinism (I/O, clocks, randomness, LLM, network)
lives one layer out. This pillar is the one REPO_REVIEW #2 showed
regresses without a gate. Because some of it is code patterns
(`process.env`, `Date.now`) rather than imports, dependency-cruiser
cannot see it; the gate is `scripts/check-core-purity.mjs`, which owns
all three scenarios below.

### S-DET-1 -- no I/O in core

When `@barwise/core` source is compiled, it shall import none of
`node:fs`, `node:child_process`, `node:os`, or any network module.

Guard: fitness function, _gated_ by `scripts/check-core-purity.mjs`.
(REPO_REVIEW #2 fixed the leftovers by hand; this makes the fix
non-regressable.)

### S-DET-2 -- no ambient randomness in core

When core code needs a unique identifier, it shall import `randomUUID`
from `node:crypto`; it shall not call the global `crypto.*` or
`Math.random`.

Guard: fitness function, _gated_ by `scripts/check-core-purity.mjs`
(forbids global `crypto.` and `Math.random`; the `node:crypto` import is
the one allowed source). This is exactly the inconsistency REPO_REVIEW A5
fixed in `FactType.ts`.

### S-DET-3 -- no clock or environment reads in core

When core code runs, it shall not read wall-clock time (`Date.now`,
`new Date()`) or `process.env`.

Guard: fitness function, _gated_ by `scripts/check-core-purity.mjs`
(forbids `Date.now`, `new Date()`, and `process.env` in `core/src`).

### S-DET-4 -- repeatable output

When the same model is validated, verbalized, mapped, diffed, or
queried twice with identical input, the output shall be identical.

Guard: fitness function. The existing round-trip suites assert this;
the property-based round-trip tests (REPO_REVIEW T4) would strengthen
it. Partially gated today via the round-trip tests.

### S-DET-5 -- non-deterministic capability goes one layer out

When a proposed core capability cannot preserve determinism, it shall be
placed in `llm`, `cli`, `mcp`, or `vscode`, not in core.

Guard: review. The placement decision is a design judgment made in the
spec review; S-DET-1..3 catch a violation only after the fact, so this
scenario guards the choice up front.

## Explicit over implicit

Cross-domain references, composed domains, schema versions, and format
registration are declared, not inferred. Several of these are already
enforced by the schema and validation engine; the catalog records them
so a future change cannot quietly relax them.

### S-EXPL-1 -- every model declares its schema version

When a `.orm.yaml` is serialized, it shall carry a `schemaVersion`
stamped with `CURRENT_ORM_VERSION`.

Guard: fitness function, partially gated. The serializer stamps it and
the JSON Schema requires it; a serialization test asserts it. Phase B
can add an examples-level check that no committed model omits it.

### S-EXPL-2 -- unknown versions are rejected, not guessed

When a model with an unsupported `schemaVersion` is read, the system
shall reject it with a clear message rather than infer compatibility.

Guard: fitness function, _gated_ by the schema-version tests
(`serialization/schemaVersion.ts`; REPO_REVIEW A2). Listed so the
behavior is treated as an architectural invariant, not an incidental
test.

### S-EXPL-3 -- cross-domain references go through a context mapping

When an element in one domain references an element in another, the
reference shall resolve through a declared context mapping.

Guard: fitness function. The validation engine flags an undeclared
cross-domain reference. Gated by the validation suite; recorded here as
a pillar invariant.

### S-EXPL-4 -- data products declare their domains

When a data product composes domains, it shall declare each domain it
composes.

Guard: fitness function. Validation rule; gated by the validation suite.

### S-EXPL-5 -- formats register by name, not by discovery

When a format is added, it shall be registered by name through a
`FormatDescriptor`, and the registry shall not auto-discover formats
from the filesystem.

Guard: review (with a fitness-function backstop). That registration is
_named_ is verified by the absence of filesystem globbing in the
registry; that a new descriptor is wired in explicitly is a review
check. The connector packages (`registerStandardFormats()`,
`registerDbtFormats()`, `registerCodeFormats()`) are the reference.

## DRY (secondary)

Duplication is removed only when it does not compromise orthogonality or
composability; otherwise the duplication stays. This pillar has no
_gating_ fitness function by design -- a blocking duplication gate would
push toward exactly the coupling the pillar forbids. A duplication scan
(`jscpd`) runs _warn-only_ as an advisory signal the reviewer weighs; it
never fails CI. Both scenarios stay _review_.

### S-DRY-1 -- duplication removed only without new coupling

When duplication is found across packages, it shall be removed only if
the shared abstraction does not introduce a dependency-graph edge that
S-ORTH-1..3 forbid.

Guard: review, with a warn-only `jscpd` signal. The scan surfaces
duplication candidates; the reviewer weighs each against the coupling its
removal would create and removes only those that introduce no forbidden
edge. The signal never gates -- gating it would optimize the secondary
pillar at the primary pillars' expense.

### S-DRY-2 -- no abstraction that forces an interface to bend

When a shared abstraction is proposed to remove duplication, the
reviewer shall confirm it does not force either package to bend its
interface to fit.

Guard: review. The CLI `loadModel` vs MCP `resolveSource` tolerance
(REPO_REVIEW "What Is Working Well") is the worked example: parallel
code kept on purpose because unifying it would couple two surfaces.

## Using this catalog

- In a Phase A assessment: walk every scenario, record pass / risk /
  violation with evidence, and convert each violation to a bd issue
  citing the scenario ID.
- In Phase B: each _fitness function_ scenario not yet gated is a
  candidate CI check; implement it report-only first, then gating, and
  reference the scenario ID in the check's config comment.
- When a scenario's guard changes (a review scenario becomes
  automatable, or a new pillar invariant appears), update this document
  -- it is the single list both phases read from.
