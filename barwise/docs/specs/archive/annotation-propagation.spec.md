# Propagate annotations to downstream artifacts

Status: Implemented -- all five legs wired. Exporters collect
annotations internally; the diagram and verbalization legs are fed by
production callers as of 2026-07-25: `collectAnnotationMap` /
`collectOpenQuestionAnnotations` (core annotation subpath) wire the CLI
diagram and verbalize commands (`--no-annotate` to opt out), the MCP
generate_diagram and verbalize_model tools (`annotate` parameter), and
the VS Code DiagramSession (annotations passed as input data, keeping
the diagram package free of core's annotation module). Open questions
are curated: todo severity only, column-level description nags dropped,
deduplicated. Follow-up (minor): the collector's message wording is
still dbt-flavored ("or edit the dbt YAML") on non-dbt surfaces.
Created: 2026-03-08
Last-updated: 2026-07-25

## Problem

Ambiguity annotations, low-confidence flags, and structural gap notes
are injected into the `.orm.yaml` file and dbt export, but the four
remaining downstream formats -- DDL, OpenAPI, Avro, and diagrams --
silently discard this information. A modeler who exports DDL or
generates a diagram sees a clean artifact with no indication that parts
of the model are uncertain or incomplete.

Both DDL and OpenAPI export formats already contain placeholder
comments ("annotations and constraintSpecs will be added in Stage
B/C") anticipating this work.

Verbalization output also does not surface ambiguities, though it is
the most natural place to present them as natural-language questions.

## Solution

Propagate annotations to all downstream artifacts using format-
appropriate mechanisms:

| Format        | Mechanism                                        |
| ------------- | ------------------------------------------------ |
| DDL           | SQL comments above affected tables/columns       |
| OpenAPI       | `x-barwise-annotations` extension fields         |
| Avro          | `doc` field annotations on affected fields       |
| Diagram (SVG) | Visual markers (dashed borders, annotation icon) |
| Verbalization | Appended section listing open questions          |

## Design decisions

### Annotation source

Annotations come from two sources depending on context:

1. **Import-time** (transcript extraction): `TranscriptProvenance`
   containing ambiguities, constraint provenance, and structural gaps.
   This data is available in the VS Code import command and CLI import
   flow.

2. **Export-time** (model analysis): `collectAnnotations()` analyzing
   the `OrmModel` and `RelationalSchema` for structural issues. This
   is what the dbt annotator already does and is always available
   regardless of how the model was created.

All export formats should use export-time analysis at minimum. Import-
time provenance is additive when available.

### Shared annotation collection

Extract a format-agnostic `ExportAnnotationCollector` that produces
`ExportAnnotation[]` from an ORM model and relational schema. The dbt
annotator already has this logic in `DbtExportAnnotator.collectAnnotations()`.
Generalize it so DDL, OpenAPI, and Avro annotators can reuse it.

### Package boundaries

All annotation logic stays in `@barwise/core`. The diagram package
(`@barwise/diagram`) receives annotations as input data, not by
importing core's annotation module directly -- the graph builder in
core adds annotation metadata to `GraphTypes`, and the diagram
package renders it.

## Format-specific design

### DDL

Insert SQL comments above `CREATE TABLE` and column definitions:

```sql
-- TODO(barwise): Ask: How do you uniquely identify a Customer?
-- NOTE(barwise): Applied with medium confidence: "Each Order must have a Customer"
CREATE TABLE customer (
  -- TODO(barwise): Data type defaulted to TEXT. Add a data type to the ORM value type.
  customer_name TEXT NOT NULL,
  ...
);
```

Implementation: extend `renderDdl()` in the DDL export format to
accept `ExportAnnotation[]` and inject comments at the table and
column level, matching the pattern used by `DbtExportAnnotator`.

### OpenAPI

Use OpenAPI extension fields (`x-` prefix) on schema objects:

```yaml
components:
  schemas:
    Customer:
      x-barwise-annotations:
        - severity: todo
          message: "Ask: How do you uniquely identify a Customer?"
      properties:
        customer_name:
          type: string
          x-barwise-annotations:
            - severity: note
              message: "Data type defaulted to string."
```

This preserves valid OpenAPI while making annotations machine-readable
for downstream tooling.

### Avro

Append annotation text to the `doc` field on affected record and
field definitions:

```json
{
  "name": "Customer",
  "type": "record",
  "doc": "A person who places orders. [TODO(barwise): Ask: How do you uniquely identify a Customer?]",
  "fields": [...]
}
```

Avro has no extension mechanism, so annotations are embedded in the
documentation string with a `[TODO(barwise): ...]` bracket convention
that can be parsed back out if needed.

### Diagram (SVG)

Add visual indicators to the graph and SVG rendering:

1. **Graph model**: Add optional `annotations?: readonly string[]`
   field to `ObjectTypeNode` and `FactTypeNode` in `GraphTypes.ts`.
   The `ModelToGraph` converter populates this from export-time
   annotation collection.

2. **SVG rendering**: Elements with annotations get:
   - A dashed border (vs solid for clean elements)
   - A small warning icon or asterisk marker
   - A `<title>` element containing the annotation text (shows on
     hover in browsers/VS Code webview)

This is a minimal visual signal that does not clutter the diagram but
alerts the modeler that an element needs attention.

### Verbalization

Append an "Open questions" section after the constraint verbalizations:

```
== Open questions ==

- How do you uniquely identify a Customer?
- Is the relationship between Project and TeamMember one-to-many or
  many-to-many?
- "Account" is used in multiple contexts. Do these refer to the same
  concept?
```

Implementation: the `Verbalizer` accepts an optional
`ExportAnnotation[]` and appends TODO-severity annotations as
questions in a final section.

## Files

### New files

- `packages/core/src/annotation/ExportAnnotationCollector.ts` --
  generalized annotation collection from ORM model + relational schema
- `packages/core/tests/annotation/ExportAnnotationCollector.test.ts`

### Modified files

- `packages/core/src/export/DdlExportFormat.ts` -- inject SQL comments
  from annotations
- `packages/core/src/export/OpenApiExportFormat.ts` -- add
  `x-barwise-annotations` extension fields
- `packages/core/src/mapping/renderers/avro.ts` -- append to `doc`
  fields
- `packages/core/src/mapping/renderers/DbtExportAnnotator.ts` --
  refactor to use shared `ExportAnnotationCollector`
- `packages/core/src/verbalization/Verbalizer.ts` -- add open
  questions section
- `packages/diagram/src/graph/GraphTypes.ts` -- add `annotations?`
  field to node types
- `packages/diagram/src/graph/ModelToGraph.ts` -- populate annotations
  from model analysis
- `packages/diagram/src/svg/SvgRenderer.ts` -- render dashed borders
  and title elements
- `packages/core/src/index.ts` -- export new collector

### Test files

- `packages/core/tests/export/DdlExportFormat.test.ts` -- annotation
  injection tests
- `packages/core/tests/export/OpenApiExportFormat.test.ts` --
  extension field tests
- `packages/core/tests/mapping/renderers/avro.test.ts` -- doc field
  annotation tests
- `packages/core/tests/verbalization/Verbalizer.test.ts` -- open
  questions section tests
- `packages/diagram/tests/graph/ModelToGraph.test.ts` -- annotation
  population tests
- `packages/diagram/tests/svg/SvgRenderer.test.ts` -- visual marker
  tests

## Implementation order

1. Extract `ExportAnnotationCollector` from dbt annotator (no behavior
   change, refactor only)
2. DDL annotations (simplest format, SQL comments)
3. Verbalization open questions section
4. Diagram annotations (graph model + SVG rendering)
5. OpenAPI extension fields
6. Avro doc field annotations

Steps 2-6 are independent once step 1 is complete.

## Test coverage

Per format:

- Annotations appear in output for a model with known structural gaps
- Annotations are absent for a clean model with no issues
- Annotation placement is correct (right table/column/element)
- Severity levels are preserved (TODO vs NOTE)
- Existing tests continue to pass (no regression in format output)

Cross-cutting:

- `ExportAnnotationCollector` produces identical results to current
  `DbtExportAnnotator.collectAnnotations()` for the same inputs
- Round-trip: annotations do not corrupt the format (DDL still parses,
  OpenAPI still validates, Avro schemas still compile)

## Success criteria

- All 6 downstream formats include annotation information when the
  model has structural gaps or extraction provenance
- The dbt annotator is refactored to share collection logic without
  behavior change
- Diagram elements with annotations are visually distinguishable
- No regressions in existing export or diagram tests
