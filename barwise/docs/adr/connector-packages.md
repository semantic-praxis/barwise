# Connector packages

Scope: architecture
Date: 2026-11-06
Tracking: barwise-ubc, barwise-2uz, barwise-5zi, barwise-5f9,
docs/specs/archive/connector-io-migration.spec.md,
docs/specs/ossie-ontology-format.spec.md,
docs/specs/archive/code-analysis.spec.md, docs/specs/norma-export.spec.md,
docs/specs/format-renderers-to-connectors.spec.md
Enforced-by: npm run purity (connector-owns-io),
tests (core-no-interop, format-in-its-connector, explicit-registration),
none (barwise-ym8.iyw: connector-owns-io), none (barwise-ym8.x9w: format-in-its-connector),
none (barwise-ym8.2n3: explicit-registration)

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

1. **Core ships no interop format.**{#core-no-interop} `@barwise/core` holds the
   `FormatDescriptor` registry, the `ImportFormat` and
   `ExportFormatAdapter` interfaces, and the native `.orm.yaml`
   serializer with its JSON Schema. Every other import or export format
   is a descriptor registered from outside core.
2. **A format lives in a connector package, which owns whatever I/O the
   format needs.**{#connector-owns-io} A connector package here is one that registers
   formats, through one `register*Formats()` function: `@barwise/formats`
   (DDL, OpenAPI, Avro, NORMA, SQL, Ossie; the SQL importer scans
   directories and runs the sqlglot subprocess), `@barwise/dbt` (its
   file-system and `dbt compile` I/O; the sqlglot subprocess that parses
   its models' SQL is formats', reached through `parseSqlPatterns`), and `@barwise/code-analysis`
   (TypeScript, Java and Kotlin, with LSP sessions and repository
   scanning).
3. **A format's rendering and parsing live in its connector.**{#format-in-its-connector}
   A format's descriptor and the code that writes or reads its text sit
   in one package: the DDL, OpenAPI and Avro renderers and the
   population renderers are `@barwise/formats`', and the dbt renderer
   and its export annotator are `@barwise/dbt`'s. Core keeps the
   relational mapping (`RelationalMapper`, which ORM, a relational
   technology, owns) and the SQL dialect types and value predicates its
   own mapping uses; a format reaches them from its connector. A format
   whose input embeds another format composes that format's connector
   rather than copying its code: dbt parses its models' SQL through
   `@barwise/formats`' `parseSqlPatterns`, and depends on formats to do so.
4. **Registration is explicit and by name.**{#explicit-registration} Each tool surface calls the
   `register*Formats()` functions it needs; the registry discovers
   nothing on its own, and a format no one registered fails as an
   unknown format.

## Consequences

- `npm run purity` (ci.yml, `if: steps.changes.outputs.docs_only !=
  'true'`) refuses static file-system, subprocess and network imports
  and environment access in core, so the I/O half of `connector-packages.md#connector-owns-io` and the
  "no discovery" half of `connector-packages.md#explicit-registration`
  have a backstop
  (`architecture-scenarios.md` S-EXPL-5). It misses dynamic imports,
  `process.cwd()` and global `fetch` (barwise-fzd), and a `require`
  call, which no issue tracks yet (barwise-fzd's list is measured and
  does not include it).
- `npm run depcruise` (ci.yml, `if: steps.changes.outputs.docs_only !=
  'true'`) fails when core's source imports another internal package's
  source, so core cannot reach a connector; tests and external
  libraries are outside it.
- `connector-packages.md#core-no-interop` and
  `connector-packages.md#format-in-its-connector` are held by
  `core/tests/public/exports.test.ts`: it pins every runtime name core
  and its subpath exports export to a reviewed list (`exports.json`), so
  an exported renderer cannot come back into core unseen, and it fails on
  code in `core/src` that declares a value as an `ImportFormat`,
  `ExportFormatAdapter` or `FormatDescriptor` (`implements`, `satisfies`,
  `as`, or a type annotation) or registers a format outside the
  registry's own file (barwise-2uz). Not seen: a renderer core keeps
  unexported and calls from an exported function, a type-only export,
  and an untyped literal that only matches an interface's shape.
- `connector-packages.md#format-in-its-connector` has no known
  violation since `format-renderers-to-connectors.spec.md` WS3: the SQL
  parser cascade is formats', and dbt composes it through
  `parseSqlPatterns`. Nothing checks that a format's code sits in its own
  connector rather than another one (barwise-ym8.x9w).
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
  the registry". `connector-packages.md#explicit-registration` says how formats get registered, not whether
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
