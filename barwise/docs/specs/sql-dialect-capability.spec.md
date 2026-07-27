# SQL dialect capability: dbt SQL mining, targeted DDL export, normalization

Status: Ratified by the owner 2026-07-26 (follow-ups to the sqlglot
sidecar, #277); not yet implemented. Re-ground against source before
building -- the sidecar (`formats/src/sql/SqlglotBridge.ts`) and the
`ConstraintSpec` export channel (`core/src/export/types.ts`) are the
two seams everything below plugs into.
Created: 2026-07-27
Last-updated: 2026-07-27
Tracking: code-analysis spec (sqlglot decision recorded in its status);
REPO_REVIEW-2026-07-26 standing follow-ups

## Principle

The conceptual model is dialect-free: `.orm.yaml` records what is true
about the domain, never what an engine can enforce (the same superset
reasoning as NORMA export). Dialect capability is a format-adapter
concern at the two edges, and the two directions carry it differently:

- **Import is monotone.** A constraint-poor dialect cannot fail to
  import a constraint it never expressed; its rules migrate into query
  logic and dbt tests instead. So import needs no capability table --
  it needs the union of sources: DDL patterns + query mining + dbt
  YAML tests. The dbt leg below completes that union.
- **Export owns the capability judgment, explicitly.** Each adapter
  decides per constraint: native clause, informational clause, or the
  existing `ConstraintSpec` spillway (FORML verbalization + pseudocode
  - example), so degradation is visible output, never silent dropping.

Boundary: sqlglot handles syntax (parsing, transpilation), never
semantics of enforceability. The capability judgment stays in the
adapter, beside the `ConstraintSpec` channel.

## Workstreams (each independently shippable, in priority order)

### 1. dbt SQL mining

The dbt importer reads only YAML today; model `.sql` files carry the
joins, WHERE guards, and CASE branches that encode rules on
warehouses without enforced constraints -- exactly dbt's home turf.
Point the dbt importer's directory scan at `parseSqlWithSqlglot`
(regex-cascade fallback as everywhere) and merge the mined patterns
into the same stream its YAML tests produce. `@barwise/dbt` already
owns fs + subprocess I/O, so no dependency-graph change; it gains the
same optional-python posture as `@barwise/formats`.

### 2. Dialect-targeted DDL export

`barwise export --format ddl --dialect <name>`: a per-dialect
capability profile in the DDL adapter routes each constraint three
ways -- native clause (Postgres/MySQL enforced CHECK/FK),
informational clause (Snowflake/BigQuery `NOT ENFORCED`), or
`ConstraintSpec` + SQL comment (absent). sqlglot's `transpile()` may
rewrite syntax after rendering; the profile decides expressibility
first. Core's renderer stays dialect-free; the profile and any
transpile call live in the formats adapter.

### 3. sourceText normalization

Format extracted `sourceText` canonically (sqlglot's generator, when
available) so re-analysis diffs do not churn on whitespace. Nearly
free once WS1 lands; degrade to raw text without python.

## Open decisions (for review)

- Where the capability profile lives: a declarative table in the DDL
  adapter (recommended -- explicit over implicit) vs deriving from
  sqlglot dialect metadata (couples judgment to a dependency).
- Whether WS2's `--dialect` also gates type rendering (VARCHAR vs
  STRING) or only constraints in the first pass. Recommend constraints
  only; types follow demand.

## Non-goals

No schema-aware validation or relational-algebra reasoning (the
Calcite line -- reopens only if that becomes a goal); no change to
core's renderers or the pure regex cascade; no required Python.
