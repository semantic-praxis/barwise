# Import and Export

Barwise converts between ORM 2 models (`.orm.yaml`) and external
formats. Imports produce draft models from existing artifacts. Exports
generate downstream artifacts from validated models.

All formats are available through the CLI (`barwise`), MCP server
(`barwise-mcp`), VS Code extension (`@barwise`), and programmatic API.

---

## Exports

All export formats share these options:

- `--no-annotate` -- omit TODO/NOTE comments that flag missing
  definitions, default data types, and expressible constraints
- `--strict` -- refuse to export if the model has validation errors
- `--no-examples` -- exclude population example data from output

Every export runs the validation engine first. In default (non-strict)
mode, validation diagnostics appear as comments in the output.

### DDL (SQL)

**Format name**: `ddl`

**What it produces**: ANSI-compatible `CREATE TABLE` statements with
primary keys, foreign keys, `NOT NULL` constraints, and `UNIQUE`
constraints. Population data renders as `INSERT INTO` statements.

**When to use it**:

- Creating a relational database from an ORM model
- Reviewing the physical schema implied by a conceptual model
- Generating a migration script for a new domain
- Sharing schema definitions with a DBA or database team

**Example**:

```sh
barwise export clinic.orm.yaml --format ddl
barwise export clinic.orm.yaml --format ddl --output schema.sql
barwise export clinic.orm.yaml --format ddl --strict --no-annotate
```

```
@barwise /export this model as DDL
```

**What you get**:

```sql
-- Table: patient
-- Source: EntityType "Patient" (Patient_id)
-- Definition: A person receiving medical care.
CREATE TABLE patient (
  patient_id VARCHAR NOT NULL,
  patient_name VARCHAR NOT NULL,
  PRIMARY KEY (patient_id)
);

-- Table: appointment
-- Source: EntityType "Appointment" (appointment_nr)
CREATE TABLE appointment (
  appointment_nr VARCHAR NOT NULL,
  patient_id VARCHAR NOT NULL,
  appointment_date DATE NOT NULL,
  PRIMARY KEY (appointment_nr),
  FOREIGN KEY (patient_id) REFERENCES patient (patient_id)
);

INSERT INTO patient (patient_id, patient_name) VALUES ('P001', 'Alice');
```

**Annotations**: When enabled (default), SQL comments document:

- Which ORM entity or fact type produced each table
- Entity definitions from the model
- Constraints the DDL cannot express natively (frequency, ring, etc.)

**Constraints that DDL cannot express**: Frequency constraints, ring
constraints (acyclic, intransitive, etc.), and complex multi-role
uniqueness constraints are documented as SQL comments with the FORML
verbalization and pseudocode predicate.

---

### OpenAPI

**Format name**: `openapi`

**What it produces**: An OpenAPI 3.0.0 specification in JSON. Each
entity becomes a schema component, each relationship becomes a
reference. Includes request/response schemas suitable for REST API
generation.

**When to use it**:

- Generating an API specification from a domain model
- Bootstrapping a REST API that conforms to the conceptual model
- Sharing domain structure with frontend or API teams
- Generating client SDKs from the specification

**Example**:

```sh
barwise export clinic.orm.yaml --format openapi
barwise export clinic.orm.yaml --format openapi --output api-spec.json
```

```
@barwise /export this model as openapi
```

**Format-specific options**:

- `title` -- OpenAPI spec title (defaults to model name)
- `version` -- API version string (defaults to `"1.0.0"`)
- `basePath` -- API base path prefix

---

### dbt

**Format name**: `dbt`

**What it produces**: A multi-file dbt project structure:

- One SQL model file per entity (with `SELECT` from `source()`)
- A consolidated `models/schema.yml` with column descriptions,
  data types, and tests (not_null, unique, relationships)
- Seed CSV files when population data exists

**When to use it**:

- Generating a dbt project from a conceptual model
- Creating a data transformation layer that matches the domain model
- Bootstrapping dbt models with correct column types and tests
- Ensuring dbt models align with documented business rules

**Example**:

```sh
barwise export clinic.orm.yaml --format dbt --output dbt_project/
```

```
@barwise /export this model as dbt
```

**Format-specific options**:

- `sourceName` -- dbt source name in `schema.yml` (defaults to `"raw"`)
- `generateRelationshipTests` -- include dbt relationship tests
  (defaults to `true`)

**What you get**:

```
dbt_project/
  models/
    schema.yml          -- column definitions, tests, descriptions
    patient.sql         -- SELECT ... FROM {{ source('raw', 'patient') }}
    appointment.sql     -- SELECT ... FROM {{ source('raw', 'appointment') }}
  seeds/
    patient_seed.csv    -- population data (when available)
```

**Annotations**: When enabled, `schema.yml` includes `# TODO:` and
`# NOTE:` comments for missing descriptions, default data types, and
constraints that need manual test implementation.

---

### Avro

**Format name**: `avro`

**What it produces**: Apache Avro schema definition files (`.avsc`),
one per entity/table. Each file is valid Avro JSON with field names,
types, and documentation.

**When to use it**:

- Defining Avro schemas for Kafka topics or message serialization
- Generating schema registry entries from a domain model
- Ensuring message formats align with the conceptual model
- Creating type-safe serialization schemas for event-driven systems

**Example**:

```sh
barwise export clinic.orm.yaml --format avro --output schemas/
```

```
@barwise /export this model as avro
```

**Format-specific options**:

- `namespace` -- Avro namespace for generated schemas

**What you get**:

```
schemas/
  patient.avsc
  appointment.avsc
```

Each `.avsc` file contains a standard Avro record schema:

```json
{
  "type": "record",
  "name": "patient",
  "namespace": "com.example",
  "fields": [
    { "name": "patient_id", "type": "string", "doc": "..." },
    { "name": "patient_name", "type": "string" }
  ]
}
```

---

## Imports

Import formats produce draft ORM models from existing artifacts. The
resulting `.orm.yaml` is structurally valid but may need semantic
refinement -- entity definitions, better role names, additional
constraints.

Each import reports a confidence level (`high`, `medium`, or `low`) and
a list of warnings about assumptions made during parsing.

### DDL (SQL)

**Format name**: `ddl`

**What it consumes**: SQL `CREATE TABLE` statements with column
definitions, `PRIMARY KEY`, `FOREIGN KEY`, `NOT NULL`, and `UNIQUE`
constraints.

**When to use it**:

- Reverse-engineering an ORM model from an existing database schema
- Starting a conceptual model from DDL scripts
- Understanding the domain structure implied by a legacy database
- Migrating from a physical-first to conceptual-first approach

**Example**:

```sh
barwise import model schema.sql --format ddl
barwise import model schema.sql --format ddl --output clinic.orm.yaml
barwise import model schema.sql --format ddl --name "Clinic Model"
```

```
@barwise /import-model this DDL as format ddl
```

**What it infers**:

| SQL construct | ORM concept                   |
| ------------- | ----------------------------- |
| Table         | Entity type                   |
| Column        | Binary fact type (has-a)      |
| PRIMARY KEY   | Preferred identifier          |
| FOREIGN KEY   | Relationship between entities |
| NOT NULL      | Mandatory constraint          |
| UNIQUE        | Uniqueness constraint         |

**Confidence**: `medium` -- structural mapping is deterministic but
naming uses heuristics (e.g. `patient_name` becomes a fact type
"Patient has patient-name"). Entity definitions and reading patterns
are not available from DDL alone.

**Limitations**:

- CHECK constraints are not parsed
- Views, triggers, and stored procedures are ignored
- Column comments/descriptions are not extracted
- Verb inference is heuristic (foreign key columns map to generic
  "has" readings)

---

### OpenAPI

**Format name**: `openapi`

**What it consumes**: OpenAPI 3.0 or 3.1 specifications in JSON or
YAML format.

**When to use it**:

- Extracting a domain model from an existing API specification
- Understanding the entity structure behind a REST API
- Creating an ORM model that matches an existing API contract
- Bridging API-first and model-first development

**Example**:

```sh
barwise import model api-spec.json --format openapi
barwise import model api-spec.yaml --format openapi --output clinic.orm.yaml
```

```
@barwise /import-model this OpenAPI spec as format openapi
```

**What it infers**:

| OpenAPI construct      | ORM concept                       |
| ---------------------- | --------------------------------- |
| Schema (object)        | Entity type                       |
| Property (scalar)      | Binary fact type (has-a)          |
| $ref to another schema | Relationship between entities     |
| required array         | Mandatory constraint              |
| enum                   | Value constraint                  |
| minLength/maxLength    | Value constraint (where possible) |
| Array of $ref          | Many-to-many indicator            |

**Confidence**: `medium` -- good structural mapping but semantic gaps
remain. Reference modes are inferred from `id`-suffixed properties.

**Limitations**:

- `oneOf`, `anyOf`, `allOf` composition is not supported
- Non-object schemas (plain strings, arrays) are skipped
- Inline object definitions without names are skipped
- Path/operation information is not used (schema-only)

---

### NORMA XML

**What it consumes**: NORMA `.orm` XML files produced by the NORMA
modeling tool (Natural ORM Architect).

**When to use it**:

- Migrating models from NORMA to barwise
- Converting an existing NORMA project to `.orm.yaml` format
- Preserving full-fidelity ORM models from a graphical editor
- Working with models from ORM 2 textbooks and academic resources

**Example**:

```sh
barwise import model hospital.orm --format norma
```

**What it preserves**:

- Entity types with reference modes and definitions
- Value types with data type information
- All fact types with role names and readings
- Full constraint set: uniqueness, mandatory, frequency, ring,
  subset, equality, exclusion, value constraints
- Subtype relationships
- Preferred identifiers (including external uniqueness)
- Role-level value constraints

**Confidence**: `high` -- NORMA XML is a native ORM format. The
mapping is nearly lossless.

**Limitations**:

- Diagram layout information is not preserved (barwise generates its
  own layouts)
- NORMA extensions and custom annotations are not imported
- Some rare constraint patterns may produce import warnings
- Value ranges and open-ended bounds are not yet imported (only
  enumerated values), tracked in `barwise-5t9.1`

For a full conceptual comparison of NORMA XML and `.orm.yaml` -- design
intent, a coverage matrix, and the known import gaps -- see
[NORMA XML vs `.orm.yaml`](NORMA_VS_ORM_YAML.md).

---

### Transcript (LLM)

**What it consumes**: Natural language text describing a business
domain. Meeting transcripts, requirements documents, domain expert
interviews, textbook descriptions, user stories.

**When to use it**:

- Extracting a formal ORM model from informal domain descriptions
- Bootstrapping a model from a stakeholder interview transcript
- Converting textbook examples into machine-readable models
- Rapidly prototyping a domain model from written requirements

**Example**:

```sh
barwise import transcript meeting-notes.md
barwise import transcript meeting-notes.md --output clinic.orm.yaml
barwise import transcript meeting-notes.md --model claude-sonnet-4-5-20250929
```

```
@barwise /import extract an ORM model from this transcript
```

**What it extracts**:

- Entity types with definitions and reference modes
- Value types with appropriate data types
- Fact types with natural-language readings
- Constraints (uniqueness, mandatory, value) inferred from context
- Subtype relationships when hierarchies are described
- Population examples when concrete data is mentioned

**LLM providers**:

| Provider  | Configuration                          |
| --------- | -------------------------------------- |
| Copilot   | Default in VS Code (no API key needed) |
| Anthropic | `ANTHROPIC_API_KEY` env var or setting |
| OpenAI    | `OPENAI_API_KEY` env var               |
| Ollama    | `OLLAMA_HOST` env var (local models)   |

**Confidence**: Variable -- depends on transcript clarity and LLM
quality. Every extracted element includes provenance tracing back to
the source text (line numbers, excerpts). Conformance validation
catches structural issues before the model is constructed.

**Post-extraction workflow**:

1. Review the generated `.orm.yaml` for accuracy
2. Run `@barwise /validate` to check structural rules
3. Run `@barwise /review` for semantic quality suggestions
4. Refine manually -- add missing constraints, fix readings
5. Export to downstream formats once the model is stable

---

## Format matrix

| Format     | Import | Export | Confidence | Multi-file |
| ---------- | ------ | ------ | ---------- | ---------- |
| DDL        | Yes    | Yes    | medium     | No         |
| OpenAPI    | Yes    | Yes    | medium     | No         |
| dbt        | --     | Yes    | --         | Yes        |
| Avro       | --     | Yes    | --         | Yes        |
| NORMA XML  | Yes    | --     | high       | No         |
| Transcript | Yes    | --     | variable   | No         |

---

## Lineage tracking

When exporting from the CLI, barwise maintains a lineage manifest
(`.orm-lineage.json`) adjacent to the source model. The manifest
records:

- Which model was exported and its content hash
- Which format and options were used
- Timestamp of the export
- Which ORM elements produced each output artifact

Use `@barwise /lineage` or `barwise lineage` to check whether exported
artifacts are stale (model changed since last export). Use
`@barwise /impact` or `barwise impact` to see which artifacts would be
affected by changing a specific model element.
