# Code analysis: business rule extraction from code

Status: Partial -- TypeScript/Java/Kotlin importers registered on
every surface (registerCodeFormats), LSP sessions and guiding-model
context shipped. The Calcite sidecar was reconsidered and replaced
(owner decision, 2026-07-26): the goal is high-fidelity structural SQL
parsing across dialects, and a sqlglot sidecar (Python) achieves it
with far less weight than a JVM -- sqlglot's dialect coverage is the
widest available, the sidecar is a short-lived subprocess owned by
@barwise/formats (core stays pure; the purity gate hardened after the
original Calcite placement was written), and the cascade degrades to
the regex tier when Python or sqlglot is absent, exactly the
degradation the Calcite design promised. Alternatives weighed: pure-JS
parsers (node-sql-parser, sql-parser-cst -- lighter but narrower
dialects), libpg_query WASM (exact but Postgres-only), DuckDB
json_serialize_sql (heavy, one dialect), extending the regex cascade
(cannot parse nesting), LLM-only fallback (non-deterministic).
Calcite re-earns a seat only if schema-aware validation or
relational-algebra reasoning becomes a goal. Implemented 2026-07-26:
the sqlglot tier (parseLevel "sqlglot") in @barwise/formats with
regex fallback.
Created: 2026-03-26
Last-updated: 2026-07-26

## Problem

Barwise currently extracts ORM models from two kinds of sources:

1. **Transcripts** -- human conversations processed by the LLM pipeline.
2. **Static schemas** -- dbt YAML, DDL, OpenAPI, NORMA XML parsed
   deterministically.

Both miss business rules encoded in **code**. SQL transformations,
application validation logic, state machine guards, and type
definitions all carry constraints that never appear in schema files or
meeting transcripts. The dbt importer, for example, reads only YAML
and ignores SQL files entirely -- losing joins, CASE branches, WHERE
filters, and type casts that encode real domain rules.

There is no structured way to bridge from code to ORM constraints
today. Users must manually read code and create constraints by hand.

## Goals

1. Extract ORM-relevant business rules from codebases using the
   standard format import interface (`ImportFormat`).
2. Work from **Claude Code and the CLI**, not only VS Code. LSP-based
   importers must be standalone Node.js capabilities that can spin up
   language servers, query them, and shut them down without an editor.
3. Track provenance from every extracted constraint back to specific
   file paths and line numbers in the source code.
4. Report ambiguity and confidence at the same granularity as the
   existing transcript extraction pipeline.
5. New code formats integrate with the existing import/merge flow so
   extracted rules can enrich models produced from transcripts or
   schema imports.

## Non-goals

- Replacing the transcript or schema import pipelines. Code analysis
  is a complementary source, not a replacement.
- Full program analysis or formal verification. We extract what is
  statically observable through LSP queries and LLM interpretation,
  not runtime behavior.
- Supporting every language from day one. Start with TypeScript,
  Java/Kotlin, and SQL; expand based on demand.

## Architecture

### Everything is a format importer

The existing `FormatDescriptor` + `ImportFormat` system is the single
entry point for all sources of ORM models. Users run
`barwise import <format> <path>` and the format registry handles
discovery. This spec adds new formats rather than a separate pipeline:

| Format       | Package            | What it imports                                  |
| ------------ | ------------------ | ------------------------------------------------ |
| `ddl`        | core               | SQL CREATE TABLE statements (existing)           |
| `openapi`    | core               | OpenAPI 3.x specs (existing)                     |
| `dbt`        | core               | dbt YAML + SQL models (upgrade from export-only) |
| `sql`        | core               | Raw SQL files (DDL, migrations, queries)         |
| `typescript` | code-analysis      | TypeScript projects via LSP + LLM                |
| `java`       | code-analysis      | Java projects via LSP + LLM                      |
| `kotlin`     | code-analysis      | Kotlin projects via LSP + LLM                    |
| `avro`       | core (export only) | Avro schema export (existing)                    |

Tool surfaces discover all importers through `listImporters()` and
invoke them uniformly. No special-case code paths for "code analysis."

### ImportFormat interface evolution

The current `ImportFormat.parse()` takes a single string. Directory-
based formats (dbt projects, TypeScript codebases) need a path and
async operations (spawning LSP servers, running `dbt compile`). The
interface evolves:

```typescript
interface ImportFormat {
  readonly name: string;
  readonly description: string;

  /** What kind of input this format expects. */
  readonly inputKind: "text" | "directory";

  /**
   * Phase 1: Deterministic parse (synchronous, text-based formats).
   * Required for text formats. Directory formats may omit this and
   * provide only parseAsync.
   */
  parse?(input: string, options?: ImportOptions): ImportResult;

  /**
   * Phase 1a: Async parse (directory-based or I/O-heavy formats).
   * Required for directory formats. Text formats may also provide
   * this if they need I/O (e.g., Calcite sidecar for SQL).
   */
  parseAsync?(input: string, options?: ImportOptions): Promise<ImportResult>;

  /**
   * Phase 2: LLM enrichment (optional).
   * Same as before -- takes the draft model and improves it.
   */
  enrich?(
    draft: ImportResult,
    input: string,
    llm: unknown,
    options?: ImportOptions,
  ): Promise<ImportResult>;
}
```

For `inputKind: "text"`, the `input` parameter is file content (as
today). For `inputKind: "directory"`, the `input` parameter is a
directory path. The `ImportOptions` index signature carries format-
specific options (dialect, scope globs, guiding model path, LSP
command override, etc.).

This is backward-compatible. Existing text-based importers (`ddl`,
`openapi`) continue to implement `parse()` with `inputKind: "text"`.
New directory-based importers (`typescript`, `java`, `kotlin`, `dbt`)
implement `parseAsync()` with `inputKind: "directory"`. Formats that
need both (e.g., `sql` can take a single file or a directory) provide
both methods.

### Format registration

Core registers its built-in formats at startup. The code-analysis
package registers its formats separately. Tool surfaces call both:

```typescript
// CLI main, MCP init, VS Code activate
import { registerCodeFormats } from "@barwise/code-analysis";
import { registerBuiltinFormats } from "@barwise/core";

registerBuiltinFormats(); // ddl, openapi, dbt, sql, avro
registerCodeFormats(); // typescript, java, kotlin
```

After registration, `listImporters()` returns all seven importable
formats. The CLI's `barwise import` command auto-discovers them.

### Dependency graph

```
@barwise/core          (no internal deps; SQL analysis here)
  ^
  |--- @barwise/code-analysis  (core; LSP-based importers here)
  |--- @barwise/diagram        (core)
  |--- @barwise/llm            (core)
  |--- @barwise/cli            (core, diagram, llm, code-analysis)
  |--- @barwise/mcp            (core, diagram, llm, code-analysis)
  |--- barwise-vscode           (core, diagram, llm, mcp, code-analysis)
```

`@barwise/code-analysis` depends only on `@barwise/core` for model
types and the `ImportFormat` interface. It does **not** depend on
`@barwise/llm` -- the LLM client is injected via `enrich()`, same
pattern as other formats. This keeps the package testable without LLM
calls and allows the caller to choose the provider.

### Why a separate package for LSP-based importers

Core's dependency rule is strict: zero platform dependencies beyond
`yaml` and `ajv`. LSP-based importers need `node:child_process` for
spawning language servers and a JSON-RPC transport layer. These are
legitimate Node.js APIs but represent a different category of
dependency than pure parsing.

The format registry is just a registry -- any package can call
`registerFormat()`. Keeping LSP infrastructure out of core while
still using the unified discovery mechanism is the cleanest split.

SQL analysis stays in core because the Calcite sidecar is invoked
through the same `node:child_process` API but is optional (degrades
to LLM fallback). The dbt and sql importers work without a JDK; they
just lose structural parsing precision.

## LSP-based format importers (TypeScript, Java/Kotlin)

### Internal pipeline

Each LSP-based importer follows the same internal pipeline. This is
an implementation detail hidden behind `ImportFormat.parseAsync()`:

```
workspace root
   |
   v
[1] LSP Client -- start server, query types/symbols/references
   |
   v
[2] Context Assembler -- collect LSP results + source code into CodeContext
   |
   v
[3] Return ImportResult with draft model (deterministic pass)
   |
   v
[4] enrich() -- send CodeContext to LLM for semantic interpretation
   |
   v
[5] Return enriched ImportResult with provenance + ambiguities
```

Steps 1-3 are the `parseAsync()` implementation. Step 4 is `enrich()`,
called by the tool surface when an LLM client is available. The
deterministic pass (steps 1-3) extracts what can be determined from
code structure alone: type definitions, annotation-to-ORM mappings,
enum values. The LLM pass adds interpretation of validation logic,
guard clauses, and state machine patterns.

### LSP client layer

The LSP client starts language servers as child processes using
`node:child_process.spawn()`, communicates via JSON-RPC over
stdio, and exposes a high-level query API.

```typescript
interface LspManager {
  /** Start a language server for the given workspace. */
  start(config: LspConfig): Promise<LspSession>;

  /** Stop all running sessions. */
  stopAll(): Promise<void>;
}

interface LspConfig {
  /** Language identifier (e.g., "typescript", "java"). */
  language: string;
  /** Workspace root path. */
  workspaceRoot: string;
  /** Server command and args (e.g., ["typescript-language-server", "--stdio"]). */
  command: string;
  args: string[];
  /** Initialization options passed to the server. */
  initOptions?: Record<string, unknown>;
}

interface LspSession {
  /** Query: get all symbols in a file. */
  documentSymbols(uri: string): Promise<DocumentSymbol[]>;

  /** Query: get type definition at a position. */
  typeDefinition(
    uri: string,
    line: number,
    character: number,
  ): Promise<Location[]>;

  /** Query: find all references to a symbol. */
  references(uri: string, line: number, character: number): Promise<Location[]>;

  /** Query: get hover information (type signature, docs). */
  hover(
    uri: string,
    line: number,
    character: number,
  ): Promise<HoverResult | null>;

  /** Query: get call hierarchy (who calls this, what does it call). */
  callHierarchy(
    uri: string,
    line: number,
    character: number,
  ): Promise<CallHierarchyItem[]>;

  /** Query: get workspace symbols matching a pattern. */
  workspaceSymbols(query: string): Promise<SymbolInformation[]>;

  /** Shut down this session. */
  stop(): Promise<void>;
}
```

### Language server resolution

Users can provide explicit server commands via `ImportOptions`, or
the importer auto-detects:

| Format       | Default server                       | Install check           |
| ------------ | ------------------------------------ | ----------------------- |
| `typescript` | `typescript-language-server --stdio` | `npx --yes` or global   |
| `java`       | Eclipse JDT LS                       | check `jdtls` or bundle |
| `kotlin`     | `kotlin-language-server`             | check PATH              |

The `LspConfig` interface allows users to specify any server, so
additional languages work without code changes -- just configuration.

#### JVM language servers

**Eclipse JDT LS** (Java) is the most mature Java language server,
used by VS Code's "Extension Pack for Java." It provides full type
resolution, call hierarchy, and workspace symbol search. It requires
a JDK (11+) and a workspace with a build file (Maven `pom.xml` or
Gradle `build.gradle`). Startup is slow (15-45 seconds for large
projects) but type resolution quality is excellent.

**kotlin-language-server** provides comparable capabilities for
Kotlin. It understands Gradle/Maven projects and resolves Kotlin
types, including interop with Java types in the same project.

Both JVM servers support the same LSP methods our `LspSession`
interface uses (documentSymbols, references, hover, callHierarchy),
so no adapter code is needed beyond startup configuration.

### VS Code reuse

When running inside VS Code, the extension already has LSP sessions
for open files. The `LspManager` accepts an optional adapter that
delegates to VS Code's `vscode.languages` API instead of spawning
child processes. This avoids duplicate servers.

```typescript
interface LspSessionProvider {
  /** Return an existing session if available, or null to spawn. */
  getSession(config: LspConfig): LspSession | null;
}
```

The VS Code extension passes its provider; CLI and MCP pass nothing
and get the child-process implementation.

### Context assembler

The assembler takes LSP query results and source code and builds a
structured document. This is the bridge between structural analysis
(LSP) and semantic interpretation (LLM).

#### What it collects

For each file/module in scope:

1. **Type definitions** -- enums, interfaces, type aliases, class
   shapes. These often encode value constraints and entity
   attributes directly.

2. **Validation functions** -- functions whose names or signatures
   suggest validation (e.g., `validate*`, `check*`, `is*`,
   `assert*`). The function body is included for LLM interpretation.

3. **State transitions** -- switch/case or if/else chains that
   operate on status/state fields. These encode allowed value
   sequences and exclusion constraints.

4. **Guard clauses** -- early returns or thrown exceptions that
   enforce invariants.

5. **Bean Validation / annotation constraints** (Java/Kotlin) --
   `@NotNull`, `@Size`, `@Pattern`, `@Min`, `@Max`, `@Email`,
   `@Column(nullable = false, unique = true)`, and custom
   constraint annotations. These map directly to ORM constraints:
   `@NotNull` to mandatory, `@Size` to frequency or value range,
   `@Column(unique = true)` to uniqueness. JPA/Hibernate
   annotations (`@Entity`, `@ManyToOne`, `@OneToMany`,
   `@Enumerated`) encode entity types, relationships, and value
   constraints.

6. **Domain model classes** (Java/Kotlin) -- classes annotated with
   `@Entity`, `@Table`, `@Embeddable`, or following DDD patterns
   (aggregates, value objects). Field types, especially enums and
   sealed classes/interfaces, encode value constraints and subtype
   hierarchies.

7. **Call hierarchy context** -- for each validation function, where
   it is called from (to understand scope of enforcement).

#### Scoping

Analyzing an entire codebase is expensive. The assembler accepts
scope directives via `ImportOptions`:

```typescript
// ImportOptions for directory-based formats
interface CodeImportOptions extends ImportOptions {
  /** Glob patterns to include. */
  scope?: string[];
  /** Glob patterns to exclude. */
  exclude?: string[];
  /** Maximum files to analyze (guard against huge repos). */
  maxFiles?: number;
  /** Path to existing ORM model to guide analysis. */
  guidingModel?: string;
  /** Override LSP server command. */
  lspCommand?: string;
}
```

The `guidingModel` option is important: if the user already has a
model from a transcript or schema import, the assembler can focus LSP
queries on code related to known entities. For example, if the model
contains `Order` and `Customer`, search for those types in code and
trace their validation logic.

#### Output: CodeContext

```typescript
interface CodeContext {
  /** Workspace root. */
  root: string;
  /** Language analyzed. */
  language: string;
  /** Type definitions found. */
  types: TypeDefinitionContext[];
  /** Validation/guard logic found. */
  validations: ValidationContext[];
  /** State machine / transition logic found. */
  stateTransitions: StateTransitionContext[];
  /** Annotation-based constraints (Java/Kotlin). */
  annotations: AnnotationConstraintContext[];
  /** Files analyzed. */
  filesAnalyzed: string[];
}

interface TypeDefinitionContext {
  name: string;
  kind: "enum" | "interface" | "type_alias" | "class";
  filePath: string;
  startLine: number;
  endLine: number;
  sourceText: string;
  /** Symbols that reference this type (from LSP find-references). */
  referencedBy: SymbolReference[];
}

interface ValidationContext {
  functionName: string;
  filePath: string;
  startLine: number;
  endLine: number;
  sourceText: string;
  /** What entity/type this validation applies to (from LSP type info). */
  targetType?: string;
  /** Where this validation is called from (from call hierarchy). */
  calledFrom: SymbolReference[];
}

interface StateTransitionContext {
  stateField: string;
  filePath: string;
  startLine: number;
  endLine: number;
  sourceText: string;
  /** Allowed transitions extracted from code structure. */
  transitions?: { from: string; to: string; }[];
}

interface AnnotationConstraintContext {
  /** Class or field the annotation applies to. */
  targetName: string;
  targetKind: "class" | "field" | "method" | "parameter";
  /** Enclosing class name. */
  className: string;
  /** Annotation name (e.g., "NotNull", "Size", "ManyToOne"). */
  annotation: string;
  /** Annotation parameters (e.g., { min: 1, max: 100 }). */
  parameters: Record<string, unknown>;
  filePath: string;
  line: number;
  sourceText: string;
}

interface SymbolReference {
  filePath: string;
  line: number;
  symbolName: string;
}
```

## SQL format importers (dbt, sql)

SQL analysis lives in `@barwise/core` as two format importers: `dbt`
(project-aware) and `sql` (raw files). Both use the Calcite cascade
internally.

### dbt format upgrade

The dbt format currently has export only. This work adds a
`DbtImportFormat` that wraps the existing YAML importer and adds SQL
analysis:

```typescript
export const dbtFormat: FormatDescriptor = {
  name: "dbt",
  description: "dbt project (schema YAML + SQL models)",
  importer: new DbtImportFormat(), // NEW
  exporter: new DbtExportFormat(), // existing
};
```

`DbtImportFormat` implements `parseAsync()` with
`inputKind: "directory"`. Given a dbt project root, it:

1. Reads all schema YAML files (delegating to existing
   `parseDbtSchema()` and `mapDbtToOrm()`).
2. Detects the SQL dialect from `dbt_project.yml`.
3. Compiles Jinja-templated SQL via `dbt compile` or stub rendering.
4. Parses compiled SQL through the Calcite cascade.
5. Merges YAML-derived and SQL-derived constraints into one model.

### sql format (new)

A new format for raw SQL files outside dbt context:

```typescript
export const sqlFormat: FormatDescriptor = {
  name: "sql",
  description: "Raw SQL files (DDL, migrations, queries)",
  importer: new SqlImportFormat(),
};
```

`SqlImportFormat` provides both `parse()` (single SQL string) and
`parseAsync()` (directory of SQL files). It uses the Calcite cascade
with dialect detection from explicit flags, file hints, or syntax
probing.

### Cascade: core Calcite -> Babel -> LLM

```
SQL input
   |
   v
[1] Calcite core parser (ANSI SQL, strict)
   |--- success: full SqlNode AST, high-confidence patterns
   |--- failure (parse error):
   v
[2] Calcite Babel parser (multi-dialect, lenient)
   |--- success: SqlNode AST, high-confidence patterns
   |--- failure (unsupported syntax):
   v
[3] LLM interpretation (raw SQL text)
   |--- best-effort extraction, medium/low confidence
```

**Level 1 -- Core Calcite parser.** Handles standard ANSI SQL cleanly.
Uses the default `Lex.ORACLE` lexer and `SqlConformanceEnum.DEFAULT`.
Best for migrations, DDL, and simple queries. When it succeeds, we get
a full AST and can extract JOINs, WHERE predicates, CASE branches,
CHECK constraints, and UNIQUE constraints deterministically.

**Level 2 -- Calcite Babel parser.** Calcite's experimental
multi-dialect module. Uses `Lex.BIG_QUERY`, `Lex.MYSQL`, or dialect-
specific lexer settings. Handles vendor-specific syntax like
Snowflake's `QUALIFY`, BigQuery's `EXCEPT()` column exclusion,
Postgres `ON CONFLICT`, etc. The Babel parser accepts a wider range of
syntax at the cost of less precise error messages. When it succeeds,
the AST quality is equivalent to the core parser.

**Level 3 -- LLM fallback.** When neither Calcite parser can handle
the SQL (heavily templated residue, proprietary function syntax, or
edge-case dialect features), the raw SQL text is included for LLM
interpretation. The LLM extracts patterns with medium or low
confidence, and every extracted constraint is tagged `inferred`
rather than `structural` or `explicit`.

The cascade runs per-file (or per-statement, for files with multiple
statements). A file that partially parses at level 1 but fails on one
statement will use level 2 for the failing statement and level 1 for
the rest. The `SqlPatternContext` records which cascade level produced
each pattern:

```typescript
interface SqlPatternContext {
  kind: "join" | "where" | "case" | "check" | "unique" | "group_by";
  filePath: string;
  startLine: number;
  endLine: number;
  sourceText: string;
  /** Tables/columns involved. */
  tables?: string[];
  columns?: string[];
  /** Which cascade level produced this pattern. */
  parseLevel: "calcite-core" | "calcite-babel" | "llm";
}
```

### Calcite sidecar

Calcite is a JVM library. Integration uses a thin JVM sidecar process
that accepts SQL on stdin and emits a JSON AST on stdout:

```
Node.js process                    JVM sidecar
     |                                  |
     |-- stdin: { sql, dialect } ------>|
     |                                  |-- parse with core
     |                                  |-- if fail, parse with Babel
     |<-- stdout: { ast, level,  ------|
     |              errors }            |
```

The sidecar is a single-class Java program (~200 lines) bundled as a
fat JAR in the package. It requires a JDK already on the system (the
same JDK needed for Eclipse JDT LS). If no JDK is available, levels 1
and 2 are skipped and all SQL goes to the LLM (level 3).

The sidecar accepts a `dialect` parameter that configures the Calcite
lexer (`Lex`) and conformance level (`SqlConformance`):

| Dialect      | Lex setting | SqlConformance           |
| ------------ | ----------- | ------------------------ |
| `ansi`       | `ORACLE`    | `DEFAULT`                |
| `snowflake`  | `ORACLE`    | `DEFAULT` + custom funcs |
| `bigquery`   | `BIG_QUERY` | `BIG_QUERY`              |
| `postgres`   | `JAVA`      | `DEFAULT`                |
| `mysql`      | `MYSQL`     | `MYSQL_5`                |
| `redshift`   | `JAVA`      | `DEFAULT`                |
| `databricks` | `JAVA`      | `DEFAULT`                |

### Dialect detection from dbt project config

When analyzing a dbt project, the dialect is read automatically from
the project configuration. dbt projects specify their target database
through profiles, and the adapter name maps directly to a SQL dialect:

```
dbt_project.yml
   |
   profile: <profile_name>
   |
   v
profiles.yml (or env vars)
   |
   target -> outputs -> <target_name> -> type: snowflake|bigquery|postgres|...
```

The dbt importer reads the `dbt_project.yml` to find the profile
name, then resolves the adapter type. Mapping:

| dbt adapter  | Calcite dialect |
| ------------ | --------------- |
| `snowflake`  | `snowflake`     |
| `bigquery`   | `bigquery`      |
| `postgres`   | `postgres`      |
| `redshift`   | `redshift`      |
| `mysql`      | `mysql`         |
| `databricks` | `databricks`    |
| `spark`      | `databricks`    |
| (unknown)    | `ansi`          |

If `profiles.yml` is not available (common -- it lives in
`~/.dbt/profiles.yml` and is gitignored), the pipeline can:

1. Check for a `DBT_TARGET_TYPE` or `DBT_ADAPTER` environment variable.
2. Infer from installed dbt packages (`dbt-snowflake`, `dbt-bigquery`)
   listed in `packages.yml` or `requirements.txt`.
3. Fall back to `ansi` and let the cascade handle dialect-specific
   syntax at the Babel level.

### Handling dbt Jinja templates

dbt SQL files contain Jinja (`{{ ref('x') }}`, `{% if %}`) that must
be resolved before parsing. The dbt importer compiles SQL before
sending it to the Calcite cascade:

**Preferred: `dbt compile`.** If dbt is installed and the project is
configured, run `dbt compile` to produce compiled SQL in
`target/compiled/`. These files are valid SQL with all Jinja resolved.

**Fallback: stub Jinja rendering.** If `dbt compile` is not available,
use a lightweight Jinja renderer with stub macros:

- `ref('model')` -> the model name as a table identifier
- `source('src', 'table')` -> `src.table`
- `config(...)` -> empty (stripped)
- `is_incremental()` -> `false` (shows full logic, not incremental path)

The stub approach produces syntactically valid SQL that may reference
non-existent tables, but is sufficient for structural analysis of
JOINs, WHERE clauses, and CASE branches.

### Raw SQL dialect detection (sql format)

When analyzing raw SQL files outside a dbt project, there is no
project config to read dialect from. The sql importer uses a layered
detection strategy:

1. **Explicit flag.** The user passes `--dialect snowflake` on the CLI
   or includes `dialect` in the MCP tool parameters. Highest priority.

2. **File-level hints.** Some SQL files contain dialect hints:
   - `-- dialect: snowflake` comment in the first 5 lines
   - `SET search_path` -> Postgres
   - `CREATE OR REPLACE STAGE` -> Snowflake
   - `CREATE TEMP FUNCTION` -> BigQuery

3. **Syntax probing.** Try the core Calcite parser first (ANSI). If it
   fails, try each Babel dialect configuration in order of likelihood.
   Track which dialect succeeds and use it for subsequent files in the
   same directory (dialect is usually consistent within a project).

4. **LLM fallback.** If no parser succeeds, the SQL goes to the LLM
   (cascade level 3). The LLM prompt includes the raw SQL and asks for
   both business rule extraction and dialect identification. The
   identified dialect is used to configure the parser for remaining
   files.

## LLM interpretation

### Prompt design

Code-based importers that support `enrich()` send assembled context
to an LLM for semantic interpretation. The prompt varies by format
but shares the same output schema (`ExtractionResponse`).

Key differences from the transcript extraction prompt:

- **Source references** point to file paths and line numbers, not
  transcript line ranges.
- **Confidence calibration** is different: a TypeScript enum is
  high-confidence for a value constraint; a guard clause that
  throws on `total < 0` is medium-confidence for a value range;
  a comment saying "orders should always have a customer" is
  low-confidence.
- **Ambiguity categories** include code-specific concerns:
  - **Dead code** -- validation exists but is never called.
  - **Inconsistency** -- two code paths enforce different rules for
    the same entity.
  - **Implicit vs. explicit** -- rule is implied by code structure
    but not enforced at runtime.
  - **Scope uncertainty** -- validation exists but unclear if it
    applies universally or only in a specific context.

### Reusing extraction types

The LLM returns the same `ExtractionResponse` type used by
transcript extraction. `SourceReference` already supports
file-path-based references (the `lines` field is a number pair,
`excerpt` is a string). We extend it with an optional `filePath`:

```typescript
interface SourceReference {
  lines: [number, number];
  excerpt: string;
  /** File path, when source is code rather than a transcript. */
  filePath?: string;
}
```

This is backward-compatible. Transcript extraction continues to omit
`filePath` (the source is the transcript itself). Code-based importers
populate it for every reference.

### Reusing model construction

After the LLM returns an `ExtractionResponse`, the `enrich()`
implementation calls the same `enforceConformance()` and
`parseDraftModel()` functions from `@barwise/llm`. No duplication
of model construction logic.

The caller (CLI/MCP/VS Code) imports these functions directly from
`@barwise/llm`. The format importers do not wrap or re-export them.

## Provenance and ambiguity

### Code provenance

Every extracted element carries `SourceReference` entries with
`filePath` and line numbers. This enables:

- The VS Code extension to offer "go to source" from a constraint
  back to the code that encodes it.
- The CLI to print file:line references in its output.
- The MCP server to return provenance metadata to Claude Code.

### Assumption tracking

When the LLM interprets code as an ORM constraint, it must
categorize the interpretation:

| Category     | Meaning                                            | Example                                           |
| ------------ | -------------------------------------------------- | ------------------------------------------------- |
| `explicit`   | Code directly enforces this rule                   | `CHECK (status IN ('active', 'suspended'))`       |
| `structural` | Code structure implies this rule                   | Enum type with 4 members implies value constraint |
| `annotated`  | Annotation declares this rule                      | `@NotNull` on a JPA field implies mandatory       |
| `inferred`   | LLM interprets code behavior as implying this rule | Guard clause `if (!customer)` implies mandatory   |
| `ambiguous`  | Code suggests a rule but intent is unclear         | Commented-out validation, conditional enforcement |

The `annotated` category deserves special treatment. Bean Validation
and JPA annotations are **declarative constraints** -- they are the
closest thing to ORM constraints that exists in application code.
The mapping is often mechanical:

| Annotation                                 | ORM constraint              |
| ------------------------------------------ | --------------------------- |
| `@NotNull`                                 | Mandatory role              |
| `@Column(unique = true)`                   | Internal uniqueness         |
| `@Size(min = 1, max = 100)`                | Value constraint (range)    |
| `@Pattern(regexp = "...")`                 | Value constraint (pattern)  |
| `@Enumerated` + Java/Kotlin enum           | Value constraint (enum)     |
| `@ManyToOne`                               | Binary fact type            |
| `@OneToMany`                               | Binary fact type (inverse)  |
| `@ManyToMany` + `@JoinTable`               | Ternary or objectified fact |
| `@Min(0) @Max(150)`                        | Value constraint (range)    |
| Kotlin `sealed class` / `sealed interface` | Subtype hierarchy           |

These mappings are applied **deterministically** by the
`AnnotationCollector` during `parseAsync()` without LLM
interpretation. The `enrich()` pass incorporates them alongside
less structured patterns. This gives the LLM a solid foundation of
high-confidence constraints to build on.

This maps to the existing `confidence` field on
`InferredConstraint`: `explicit` = high, `annotated` = high,
`structural` = high, `inferred` = medium, `ambiguous` = low.

### Ambiguity report

The extraction returns an `ambiguities` array (same as transcript
extraction). Code-specific ambiguity examples:

- "Function `validateOrder()` checks `status !== 'deleted'` but
  `processOrder()` does not. Unclear if the constraint is universal."
- "Type `OrderStatus` defines 6 values but the database CHECK
  constraint only lists 4. The type and database may be out of sync."
- "The `customer_id` field is marked `NOT NULL` in SQL but the
  TypeScript interface declares it as `string | undefined`."

## Entry points

All code-based formats use the same `barwise import` command as
schema formats. The format name determines behavior:

### CLI

```bash
# Import from a dbt project (YAML + SQL, dialect auto-detected)
barwise import dbt ./my-dbt-project \
  --output domain.orm.yaml

# Import raw SQL files with explicit dialect
barwise import sql ./migrations \
  --dialect snowflake \
  --output domain.orm.yaml

# Import TypeScript project via LSP
barwise import typescript ./src \
  --scope "src/models/**,src/validators/**" \
  --guide existing-model.orm.yaml \
  --output domain.orm.yaml

# Import Java project via LSP
barwise import java ./src/main/java \
  --output domain.orm.yaml

# Import Kotlin project via LSP
barwise import kotlin ./src/main/kotlin \
  --output domain.orm.yaml

# Override LSP server command
barwise import typescript ./src \
  --lsp-command "typescript-language-server --stdio" \
  --output domain.orm.yaml
```

The `--output` flag triggers merge with an existing model if the
file already exists. This is the same behavior as other formats.

### MCP server

The existing `import` tool gains new format options. No separate
`analyze_code` tool is needed:

```typescript
server.registerTool("import", {
  description: "Import an ORM model from a source format",
  inputSchema: {
    format: z.enum([
      "ddl",
      "openapi",
      "dbt",
      "sql",
      "typescript",
      "java",
      "kotlin",
    ]),
    /** File content (text formats) or directory path (directory formats). */
    input: z.string(),
    modelName: z.string().optional(),
    /** For SQL: explicit dialect. If omitted, auto-detected. */
    dialect: z.enum([
      "ansi",
      "snowflake",
      "bigquery",
      "postgres",
      "mysql",
      "redshift",
      "databricks",
    ]).optional(),
    /** Glob patterns to include (directory formats). */
    scope: z.array(z.string()).optional(),
    /** Path to existing .orm.yaml to guide analysis. */
    guidingModel: z.string().optional(),
    /** Override LSP server command. */
    lspCommand: z.string().optional(),
  },
});
```

This is the integration point for Claude Code. When a user asks
Claude Code to "extract business rules from this codebase," Claude
invokes the import tool with the appropriate format.

### VS Code

The existing "ORM: Import..." command already presents a format
picker. Adding new formats to the registry makes them appear
automatically. The command:

1. Lists importers via `listImporters()`.
2. User selects a format.
3. For directory formats: prompts for workspace root and scope.
4. Runs the importer with a progress indicator.
5. For LSP formats: reuses existing editor sessions if available.
6. Opens the merge UI if an existing model is found.

## Integration with existing models

All format importers produce the same `ImportResult`. The existing
merge flow (diff, delta review, merge) applies unchanged:

- **CLI**: `--output existing.orm.yaml` triggers merge.
- **MCP**: returns merged YAML or diff for the client to present.
- **VS Code**: opens the interactive delta review QuickPick.

The `guidingModel` option is the key enabler for incremental
enrichment. Workflow:

1. Import a transcript to get the initial model.
2. Import dbt to add structural details from YAML + SQL.
3. Import typescript/java to discover application-level business rules.

Each step enriches the model. The merge flow handles conflicts.

## Package layout

### Core additions (`@barwise/core`)

SQL analysis infrastructure, dbt importer upgrade, and sql importer:

```
packages/core/src/
  sql/                               # NEW -- shared SQL analysis infrastructure
    SqlCascadeParser.ts              # Core -> Babel -> LLM cascade orchestrator
    CalciteSidecar.ts                # Spawn/communicate with Calcite JVM sidecar
    SqlPatternExtractor.ts           # AST -> SqlPatternContext[] extraction
    types.ts                         # SqlDialect, CascadeResult, SqlPatternContext
    sidecar/
      CalciteSqlParser.java          # Thin JVM sidecar (~200 lines)
      pom.xml                        # Maven build for fat JAR
  import/
    DbtImportFormat.ts               # NEW -- ImportFormat wrapping existing importer + SQL
    DbtDialectDetector.ts            # NEW -- read dbt_project.yml -> dialect
    DbtSqlCompiler.ts                # NEW -- dbt compile or stub Jinja rendering
    SqlImportFormat.ts               # NEW -- ImportFormat for raw SQL files
    RawSqlDialectProber.ts           # NEW -- syntax probing for raw SQL
    DbtProjectImporter.ts            # existing (YAML-only, called by DbtImportFormat)
    DbtSchemaParser.ts               # existing
    DbtToOrmMapper.ts                # existing
    ...
  format/
    formats.ts                       # updated: dbtFormat gets importer, sqlFormat added
    types.ts                         # updated: ImportFormat gains inputKind, parseAsync

packages/core/tests/
  sql/
    SqlCascadeParser.test.ts
    CalciteSidecar.test.ts
  import/
    DbtImportFormat.test.ts
    DbtDialectDetector.test.ts
    DbtSqlCompiler.test.ts
    SqlImportFormat.test.ts
    RawSqlDialectProber.test.ts
    ...                              # existing tests
  fixtures/
    sql/
      ansi/                          # Standard ANSI SQL (DDL, migrations)
      snowflake/                     # Snowflake-specific syntax
      bigquery/                      # BigQuery-specific syntax
      dbt/                           # dbt SQL files (pre- and post-compile)
```

### Code analysis package (`@barwise/code-analysis`)

LSP infrastructure and language-specific format importers:

```
packages/code-analysis/
  src/
    index.ts                   # Public API: registerCodeFormats(), format classes
    formats/
      TypeScriptImportFormat.ts  # ImportFormat for TypeScript projects
      JavaImportFormat.ts        # ImportFormat for Java projects
      KotlinImportFormat.ts      # ImportFormat for Kotlin projects
      registration.ts            # registerCodeFormats() -- registers all three
    lsp/
      LspManager.ts            # Start/stop language servers
      LspSession.ts            # Query interface
      LspJsonRpc.ts            # JSON-RPC over stdio
      servers/
        typescript.ts           # TS server defaults and quirks
        java.ts                 # Eclipse JDT LS defaults and init options
        kotlin.ts               # kotlin-language-server defaults
    context/
      ContextAssembler.ts       # LSP results -> CodeContext
      TypeCollector.ts          # Collect type definitions
      ValidationCollector.ts    # Collect validation functions
      AnnotationCollector.ts    # Collect JPA/Bean Validation annotations
      StateTransitionCollector.ts
    prompt/
      CodeExtractionPrompt.ts   # System prompt for code-to-ORM extraction
    types.ts                    # CodeContext, CodeImportOptions, etc.
  tests/
    formats/
      TypeScriptImportFormat.test.ts
      JavaImportFormat.test.ts
    lsp/
      LspManager.test.ts
      LspSession.test.ts
    context/
      ContextAssembler.test.ts
      TypeCollector.test.ts
      AnnotationCollector.test.ts
    prompt/
      CodeExtractionPrompt.test.ts
    fixtures/
      typescript/               # Sample TS projects for testing
      java/                     # Sample Java projects for testing
      kotlin/                   # Sample Kotlin projects for testing
  CLAUDE.md
  package.json
  tsconfig.json
```

## Testing strategy

### Unit tests (no LSP, no LLM)

- **Context assembler** -- given mock LSP results and source text,
  produces correct `CodeContext`.
- **Collectors** -- given AST-like structures, identify correct
  patterns (validations, state transitions, annotations).
- **Prompt construction** -- given a `CodeContext`, produces a prompt
  with correct structure and all context included.
- **SQL cascade** -- given SQL strings and mock sidecar responses,
  produces correct `SqlPatternContext[]` with `parseLevel`.
- **Dialect detection** -- given `dbt_project.yml` content, resolves
  correct Calcite dialect. Given raw SQL, probes correct dialect.
- **Type definitions** -- all interfaces and types compile and are
  consistent.

### Integration tests (LSP or Calcite, no LLM)

- **LSP client** -- start `typescript-language-server` against a
  fixture project, query symbols, verify results. These tests
  require the server to be installed (CI installs it).
- **End-to-end context assembly** -- given a fixture TypeScript
  project, produce a `CodeContext` and verify it contains expected
  types, validations, and patterns.
- **Calcite sidecar** -- given SQL strings, verify the sidecar
  produces expected AST JSON. Requires JDK in CI.
- **Cascade fallback** -- verify that Snowflake-specific SQL falls
  through core to Babel and produces correct patterns.

### Fixture-based extraction tests (no live LLM)

- Recorded LLM responses for known `CodeContext` inputs.
- Verify that `parseDraftModel()` produces expected constraints.
- Same pattern as `@barwise/llm` fixture tests.

### Live extraction tests (manual, requires API key)

- `tests/live/` directory, excluded from CI.
- Run against real codebases with real LLM calls.
- Used during prompt engineering iteration.

## Implementation phases

### Phase 1: ImportFormat interface evolution and dbt importer upgrade

**Goal**: Evolve the `ImportFormat` interface to support directory-
based async imports. Upgrade the dbt format from export-only to
bidirectional (YAML import, wrapped in the new interface).

**Deliverables**:

- `ImportFormat` updated with `inputKind` and `parseAsync()`
- `DbtImportFormat` wrapping existing `importDbtProject()`
- Updated `formats.ts` with dbt importer registration
- CLI `barwise import dbt <dir>` working end-to-end
- Updated `FormatDescriptor` documentation
- All existing tests passing (backward-compatible change)

### Phase 2: SQL analysis infrastructure (Calcite cascade)

**Goal**: Build the SQL parsing cascade and integrate it into both
the dbt and sql format importers.

**Deliverables**:

- Calcite sidecar JAR (core + Babel parser, JSON AST output)
- `SqlCascadeParser` orchestrating per-statement cascade
- `SqlPatternExtractor` (JOIN, WHERE, CASE, CHECK, UNIQUE, GROUP BY)
  with `parseLevel` tracking
- `DbtDialectDetector` reading `dbt_project.yml` for dialect
- `DbtSqlCompiler` running `dbt compile` or stub Jinja rendering
- `SqlImportFormat` for raw SQL files with `RawSqlDialectProber`
- `sqlFormat` registered in `formats.ts`
- CLI flags: `--dialect` for sql format
- Integration tests: cascade fallback, dialect detection
- SQL test fixtures (ANSI, Snowflake, BigQuery, dbt)

### Phase 3: LSP infrastructure and TypeScript importer

**Goal**: Build the standalone LSP client and deliver the first
LSP-based format importer (TypeScript).

**Deliverables**:

- `LspManager`, `LspSession`, JSON-RPC transport
- Server defaults for TypeScript
- `TypeCollector`, `ValidationCollector`, `StateTransitionCollector`
- `ContextAssembler` for TypeScript
- `TypeScriptImportFormat` implementing `parseAsync()`
- `registerCodeFormats()` registering the TypeScript format
- CLI `barwise import typescript <dir>` working end-to-end
- Integration tests with TypeScript fixture project

### Phase 4: Java/Kotlin importers and LLM enrichment

**Goal**: Add Java and Kotlin format importers. Implement the
`enrich()` path for all code-based formats.

**Deliverables**:

- Server defaults for Java (Eclipse JDT LS) and Kotlin
- `AnnotationCollector` for Bean Validation/JPA/Hibernate
- `JavaImportFormat`, `KotlinImportFormat`
- `CodeExtractionPrompt` with code-specific system prompt
- `enrich()` implementation for all code-based formats
- `SourceReference.filePath` extension
- Assumption tracking (explicit/structural/annotated/inferred/ambiguous)
- MCP import tool updated with new format options
- Fixture-based extraction tests (recorded LLM responses)

### Phase 5: Guiding model, merge integration, VS Code polish

**Goal**: Use an existing ORM model to focus analysis on known
entities. Integrate all formats with the merge flow. Polish VS Code
experience with LSP session reuse.

**Deliverables**:

- `guidingModel` support in all directory-based importers
- Entity-focused LSP queries (search for known type names)
- VS Code "ORM: Import..." format picker updated automatically
- `LspSessionProvider` adapter for VS Code (reuse editor sessions)
- Progress reporting and cancellation support
- Performance optimization (avoid duplicate server startup)

## Resolved design decisions

These items were originally open questions, now resolved:

1. **SQL parsing approach.** Resolved: use the Calcite core -> Babel
   -> LLM cascade. No SQL LSP is needed. Calcite provides structural
   parsing; the LLM handles what Calcite cannot. The cascade runs
   per-statement so partial failures are isolated.

2. **dbt Jinja templates.** Resolved: prefer `dbt compile` for full
   Jinja resolution; fall back to stub Jinja rendering when dbt is
   not installed. The compiled SQL feeds into the Calcite cascade.

3. **SQL dialect handling.** Resolved: dialect is auto-detected from
   `dbt_project.yml` for dbt projects, or provided via `--dialect`
   flag for raw SQL. Syntax probing provides a third path when
   neither is available.

4. **Code analysis architecture.** Resolved: all code-based sources
   are format importers in the unified registry, not a separate
   pipeline. The `ImportFormat` interface evolves to support
   directory-based async imports. LSP infrastructure lives in
   `@barwise/code-analysis` for dependency isolation, but registers
   formats through the same `registerFormat()` mechanism.

## Open questions

1. **Context window limits.** A large codebase can produce more
   context than fits in an LLM context window. Should the assembler
   chunk context and make multiple LLM calls, or should it
   prioritize and truncate? Chunking risks losing cross-file
   relationships.

2. **LSP startup cost.** TypeScript language server initialization
   for a large project can take 10-30 seconds. Should the CLI keep
   the server warm across multiple commands, or accept the startup
   cost each time?

3. **JDT LS initialization cost.** Eclipse JDT LS needs to build a
   project index on first start, which can take 30-60 seconds for
   large Java projects. Subsequent queries are fast. Should we
   persist the workspace index between runs (adds a cache directory),
   or accept the cold-start cost? For Kotlin, the language server
   has similar characteristics.

4. **Scope of "business rule."** How aggressively should the LLM
   interpret code? A type annotation like `age: number` implies a
   numeric value type, but should a guard like
   `if (age < 0 || age > 150) throw` be interpreted as a frequency
   constraint `{0..150}`? Where is the line between useful
   extraction and over-interpretation?

5. **Calcite sidecar packaging.** Should the fat JAR be committed to
   the repo, built during `npm run build`, or downloaded on first
   use? Committing avoids a build step but adds a binary artifact
   to git. Building requires Maven on the developer's machine.
   Downloading adds a network dependency.
