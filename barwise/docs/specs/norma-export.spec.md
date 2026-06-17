# NORMA XML Export and Round-Trip

Status: Draft for review (design only -- no implementation in this PR)
Created: 2026-06-17
Last-updated: 2026-06-17
Tracking: barwise-cb6 (norma CLI), barwise-e3g (diagram round-trip),
barwise-5t9 (conceptual coverage gaps), docs/NORMA_VS_ORM_YAML.md

## Principle

Composability and orthogonality (both primary) say a format is an
optional capability behind the `FormatDescriptor` registry, plugged in
from a connector package, never baked into core. `@barwise/formats`
already owns the NORMA _importer_ as exactly this shape; the registry
descriptor `normaFormat` has an `importer` and a conspicuously empty
`exporter` slot. Adding the exporter is filling in the other half of an
interface the architecture already defines, so an open-source project
can hand a model _back_ to a NORMA user rather than only consuming from
them. The exporter is pure (`OrmModel -> string`) and lives outside
core, preserving "determinism in core."

## Should NORMA export wait for the barwise-5t9 gaps? (resolved: no)

The exporter ships now; barwise-5t9 bounds round-trip fidelity for
_foreign_ NORMA files, not the exporter's correctness. The resolving
observation: **NORMA is a superset of barwise's metamodel.** Every
construct an `.orm.yaml` model can hold maps to a NORMA element, so the
`model -> NORMA` direction is lossless today for the entire representable
subset. The lossy direction is _import_ (`NORMA -> model`), where the
catalogued gaps (value ranges, derivation, deontic modality, cardinality,
independent types, join-path constraints, defaults, multi-role frequency)
silently drop constructs barwise cannot yet represent.

This separates two distinct round-trips:

- **RT-A, `model -> NORMA -> model`.** The correctness guard. Lossless
  now, because the model only contains representable constructs. This is
  the round-trip the test suite must pin.
- **RT-B, `NORMA -> model -> NORMA`.** Bounded by import. A foreign NORMA
  file loses un-importable constructs at the _import_ step; the exporter
  faithfully re-emits what survived. RT-B fidelity grows as barwise-5t9
  items land -- the exporter is not the blocker.

So barwise-5t9 is a fidelity ceiling on RT-B, not a prerequisite for the
exporter. Building it now is correct and immediately useful.

## Scope

In scope:

- A `NormaExportFormat` (`ExportFormatAdapter`) registered as the
  `exporter` on the existing `normaFormat` descriptor, so the CLI
  (`barwise export <src> --format norma`) and MCP wire up automatically
  through the registry.
- An `OrmModel -> NORMA .orm XML` writer covering the full representable
  conceptual subset (object types, reference schemes, fact types,
  readings, all Phase 1/2 constraints, subtypes, objectification,
  conceptual data types, enumerated value constraints).
- Reference-scheme re-expansion: emit the injected value type, the
  identifying fact, its internal uniqueness + mandatory, and the
  `PreferredIdentifier` link, plus the `_ReferenceMode` display attribute
  (NORMA persists the expanded predicate, not just the attribute).
- RT-A round-trip tests over the existing `tests/fixtures/*.orm` models.

Out of scope:

- **Diagram geometry** (ORMDiagram shapes/positions). A semantic-only
  `.orm` opens in NORMA with an empty diagram surface. Visual round-trip
  is workstream 2, gated on barwise-e3g and the diagram `PositionedGraph`.
- **Constructs barwise cannot represent** (barwise-5t9). The exporter
  gains each as its metamodel does; nothing here blocks on them.
- A dedicated `barwise import norma` / `export norma` subcommand
  (barwise-cb6) beyond the generic `--format norma` the registry already
  exposes.

## Inventory

| Module                                | Current state                   | Verdict                                   |
| ------------------------------------- | ------------------------------- | ----------------------------------------- |
| `formats/src/registration.ts`         | `normaFormat` has importer only | Add `exporter: new NormaExportFormat()`   |
| `formats/src/NormaExportFormat.ts`    | absent                          | New: adapter (validate, build, serialize) |
| `formats/src/NormaXmlWriter.ts`       | absent                          | New: `OrmModel -> NormaDocument`          |
| `formats/src/NormaXmlSerializer.ts`   | absent                          | New: `NormaDocument -> XML` (XMLBuilder)  |
| `formats/src/NormaXmlTypes.ts`        | intermediate types (import)     | Reused as the writer's target             |
| `formats/src/NormaToOrmMapper.ts`     | `NormaDocument -> OrmModel`     | Unchanged; writer is its inverse          |
| `formats/src/NormaXmlParser.ts`       | `XML -> NormaDocument`          | Unchanged; serializer is its inverse      |
| `packages/cli/src/commands/export.ts` | registry-driven (`getExporter`) | No change -- picks up the new exporter    |
| `@barwise/core`                       | export interfaces, registry     | No change                                 |

The two-stage symmetry is deliberate: import is `parser -> mapper`, so
export is `writer -> serializer`, sharing `NormaXmlTypes` as the seam.
fast-xml-parser already provides `XMLBuilder`, so no new dependency.

## Target architecture

```
@barwise/formats
  src/
    NormaXmlTypes.ts        shared intermediate (NormaDocument) -- exists
    NormaXmlParser.ts       XML        -> NormaDocument          (import, exists)
    NormaToOrmMapper.ts     NormaDocument -> OrmModel            (import, exists)
    NormaXmlWriter.ts       OrmModel   -> NormaDocument          (export, NEW)
    NormaXmlSerializer.ts   NormaDocument -> XML string          (export, NEW)
    NormaExportFormat.ts    ExportFormatAdapter: validate -> write -> serialize (NEW)
    registration.ts         normaFormat = { importer, exporter }  (one line changed)
  tests/
    NormaExportFormat.test.ts   unit + RT-A round-trip over fixtures/*.orm

Flow:  OrmModel --writer--> NormaDocument --serializer--> .orm XML
Inverse already exists:  .orm XML --parser--> NormaDocument --mapper--> OrmModel
RT-A guard:  model == mapper(parser(serializer(writer(model))))
```

## Workstreams (each independently shippable)

### 1. Semantic exporter + RT-A round-trip

The whole exporter for the representable subset, registered and wired,
with the `model -> NORMA -> model` round-trip as its correctness guard.
Smallest blast radius: one new adapter, two new pure modules, one changed
line in `registration.ts`; no core change, no other package touched.

Covers: entity/value types, reference-scheme expansion, fact types with
roles and all reading orders, internal/external uniqueness (+ preferred
identifier), mandatory and disjunctive mandatory, exclusion/exclusive-or,
subset/equality, ring (all seven), single-role frequency, enumerated
value constraints, subtypes (with exclusive/exhaustive), objectification,
and conceptual data types (inverse of the importer's 20+ type
normalization).

Deliberately does _not_ emit NORMA's implied constraints: NORMA
regenerates implied mandatory/uniqueness on load, and the importer
already filters them, so emitting only user-asserted constraints keeps
RT-A clean.

When a model is exported and re-imported, the system shall produce a
model equal to the original under the diff engine's model equality
(RT-A). When a model has no diagram layout, the system shall emit a
semantically complete `.orm` with no ORMDiagram elements.

### 2. Diagram geometry emission (provisional: gated on barwise-e3g)

Emit ORMDiagram shapes and positions so an exported model opens in NORMA
laid out, not blank. Depends on the diagram `PositionedGraph` and the
coordinate mapping tracked in barwise-e3g. Separable because RT-A (the
semantic guard) does not depend on geometry, and the diagram package
sits above formats in the graph.

### 3. RT-B fidelity as barwise-5t9 lands (provisional: not yet grounded)

As each barwise-5t9 construct becomes representable (value ranges first),
extend the writer to emit it and add a `NORMA -> model -> NORMA` fixture
that exercises it. Each is a small follow-on to the metamodel PR that
adds the construct, not a standalone effort.

## API and migration impact

- New public export from `@barwise/formats`: `NormaExportFormat` (and the
  `normaFormat` descriptor now carries an `exporter`). No existing export
  changes signature.
- No `@barwise/core` change. The export interfaces, registry, and
  `getExporter`/`listExporters` already accommodate a new exporter.
- CLI and MCP need no code change: `export.ts` resolves exporters by name
  from the registry after `registerStandardFormats()`, so `--format
  norma` and the MCP export tool light up once the descriptor gains its
  exporter. `barwise export --format norma` moves from "unknown format"
  to functional.
- `listExporters()` output gains `norma`; any test asserting the exact
  exporter set updates (one fixture-level change).

## Open decisions (for review)

- **Reference-scheme expansion vs attribute-only.** Recommend full
  expansion: emit the injected value type, identifying fact, internal
  uniqueness, mandatory, and `PreferredIdentifier`, plus `_ReferenceMode`.
  The real fixture (`personCountryDemo.orm`) persists the expanded
  predicate, and an entity with only a `_ReferenceMode` string and no
  identifying fact is an incomplete model NORMA flags on load. Cost: the
  writer reconstructs what the importer collapsed. Verify against a NORMA
  load before WS1 lands.
- **id strategy.** Recommend deterministic passthrough: emit NORMA ids as
  `_<model-uuid>` rather than minting fresh GUIDs. Determinism in core is
  a pillar; passthrough makes export a pure function of the model, keeps
  diffs stable, and makes RT-A id-preserving. NORMA accepts any unique id
  token, not only canonical GUIDs.
- **Empty-diagram acceptability.** Recommend shipping WS1 semantic-only
  and treating an empty diagram surface in NORMA as acceptable for
  interchange, with geometry as WS2. If a blank canvas is judged too
  rough for the "plays well with others" goal, WS1 and WS2 couple and the
  first shippable unit grows. Reviewer's call on that bar.

## Risks and testing

- **RT-A is the load-bearing guard.** A new `NormaExportFormat.test.ts`
  round-trips every `tests/fixtures/*.orm` through
  `writer -> serializer -> parser -> mapper` and asserts model equality.
  Reusing the importer's own fixtures means any asymmetry surfaces
  immediately.
- **NORMA must actually open the output.** Automated tests cannot launch
  Visual Studio, so at least one exported fixture is opened in NORMA by
  hand once and recorded in the manual test plan; the reference-scheme
  decision above is the likeliest failure point.
- **No behavior change on import.** The parser and mapper are untouched;
  the existing NORMA import suite stays green unchanged.
- **End-to-end.** `scripts/validate-examples.sh` and a CLI smoke
  (`barwise export simple.orm --format norma`) confirm the wiring.
- Land WS1 alone; WS2 and WS3 follow as their gates (barwise-e3g,
  barwise-5t9) clear.

## Non-goals

- No NORMA extension, OIAL, or relational-bridge emission -- barwise
  recomputes mapping and DDL deterministically and does not persist them.
- No new metamodel capability: this serializes what the model already
  holds. Constructs barwise cannot represent stay out until barwise-5t9
  adds them.
- No change to the native `.orm.yaml` serializer, the registry, or any
  core interface.
