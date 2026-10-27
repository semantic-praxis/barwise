# Connector packages

Scope: architecture
Date: 2026-10-24
Tracking: barwise-ubc, barwise-2uz, barwise-5zi, barwise-5f9,
docs/specs/archive/connector-io-migration.spec.md,
docs/specs/ossie-ontology-format.spec.md,
docs/specs/archive/code-analysis.spec.md, docs/specs/norma-export.spec.md

## Context

Import and export formats used to be split between "builtins" in
`@barwise/core` and connector packages outside it, and some of the
builtins scanned directories, read the environment and spawned
`dbt compile` from core. Core's own work -- metamodel, validation,
verbalization, mapping and the native `.orm.yaml` -- needs no interop
format, so every format can plug in from outside it the same way.
`@barwise/code-analysis` was the template; the connector-io-migration
spec moved dbt to `@barwise/dbt` and the standard formats to
`@barwise/formats` (its resolved section "Should all formats be
pluggable?" holds the reasoning), NORMA's writer has lived outside core
since `norma-export.spec.md`. The formats package `CLAUDE.md` wrote that
precedent as the rule for any format core has no renderer for on
2026-10-24, when Ossie followed it (`ossie-ontology-format.spec.md`). Where
non-deterministic code may live is decided in
`docs/adr/determinism-in-core.md`, and which package may import which
in `docs/adr/package-graph-authority.md`; this ADR decides where a
format lives and how it reaches the surfaces.

## Decision

1. **Core ships no interop format.** `@barwise/core` holds the
   `FormatDescriptor` registry, the `ImportFormat` and
   `ExportFormatAdapter` interfaces, and the native `.orm.yaml`
   serializer with its JSON Schema. Every other import or export format
   is a descriptor registered from outside core.
2. **A format lives in a connector package, which owns whatever I/O the
   format needs.** A connector package here is one that registers
   formats, through one `register*Formats()` function: `@barwise/formats`
   (DDL, OpenAPI, Avro, NORMA, SQL, Ossie; the SQL importer scans
   directories and runs the sqlglot subprocess), `@barwise/dbt` (its
   file-system and `dbt compile` I/O), and `@barwise/code-analysis`
   (TypeScript, Java and Kotlin, with LSP sessions and repository
   scanning).
3. **A descriptor wraps core's capability where core has one.** The
   mapping and rendering logic stays in core -- `RelationalMapper`,
   `renderDdl`, `renderOpenApi`, `renderAvro`, `renderDbt` -- and the
   DDL, OpenAPI, Avro and dbt exporters are thin shells over it; the SQL
   and dbt importers call core's `parseSqlFile`. A format core has no
   renderer for keeps its writer in the connector, as NORMA and Ossie
   do.
4. **Registration is explicit and by name.** Each tool surface calls the
   `register*Formats()` functions it needs; the registry discovers
   nothing on its own, and a format no one registered fails as an
   unknown format.

## Consequences

- `npm run purity` (ci.yml, `if: steps.changes.outputs.docs_only !=
  'true'`) refuses static file-system, subprocess and network imports
  and environment access in core, so the I/O half of decision 2 and the
  "no discovery" half of decision 4 have a backstop
  (`architecture-scenarios.md` S-EXPL-5). It misses dynamic imports,
  `process.cwd()` and global `fetch` (barwise-fzd), and a `require`
  call, which no issue tracks yet (barwise-fzd's list is measured and
  does not include it).
- `npm run depcruise` (ci.yml, `if: steps.changes.outputs.docs_only !=
  'true'`) fails when core's source imports another internal package's
  source, so core cannot reach a connector; tests and external
  libraries are outside it.
- Decision 1 has no gate of its own: a pure, text-in text-out
  `ImportFormat` or `ExportFormatAdapter` under `core/src` -- a class, an
  object literal, or a `formatRegistry.register` call -- passes every
  gate. None exists
  today (barwise-2uz).
- Decision 3 has no gate; whether code is domain logic or descriptor is
  a review judgment, and no check is proposed for it.
- That each surface registers what it needs is review-only (S-EXPL-5).
  A missing registration fails loudly ("not registered", "Unknown
  format") when a test or a user asks for that format. One copy is
  checked: `vscode/tests/unit/formatEnums.test.ts` holds the VS Code
  tool enums to the registry, but it registers the formats itself, so it
  cannot see the extension forgetting one. Open: the VS Code pickers
  offer a subset of the registered formats (barwise-i22), MCP
  `generate_diagram` points at an unregistered `svg` exporter
  (barwise-0wa.ymj), and `docs/IMPORT_EXPORT.md` is wrong about which
  formats exist (barwise-4hh).
- VS Code's `ImportDbtCommand` calls `importDbtProject` from
  `@barwise/dbt` directly. The connector-io-migration spec (workstream
  4) re-pointed that import to `@barwise/dbt` and named it "the only
  tool-layer code that imports a dbt symbol directly rather than through
  the registry". Decision 4 says how formats get registered, not whether
  a surface may also call a connector's functions directly, which
  surfaces do in other places too; that is open (barwise-5zi).
- Core cannot import or export on its own until a connector registers,
  a cost the connector-io-migration spec accepts in "Should all formats
  be pluggable?".
- `architecture-scenarios.md` S-ORTH-2 and S-ORTH-3 use "connector
  package" for `diagram` and `llm` too, which register no format, and
  S-COMP-1's guard still reads "Not yet gated" although depcruise now
  gates the direction (barwise-5f9).
- Until they are replaced with links (barwise-5h3; the root `CLAUDE.md` states
  the rule in one line with a link since architecture-index WS5), these places
  also state this rule: the root `CLAUDE.md`'s Composability principle
  and package list; the `formats`, `dbt` and
  `code-analysis` package `CLAUDE.md` files; `architecture-scenarios.md`
  S-COMP-1 and S-EXPL-5; and the headers of `formats/src/registration.ts`,
  `dbt/src/registration.ts` and core's `format/registry.ts`.
