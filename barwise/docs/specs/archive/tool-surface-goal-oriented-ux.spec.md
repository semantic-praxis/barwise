# Tool Surface Redesign: Goal-Oriented UX

## Problem

The current tool surface is **model-centric**: every tool operates on
an ORM model (validate it, verbalize it, generate a schema from it).
This is fine for someone who already has a model and knows what
operation they want. But users don't start their day wanting an ORM
model. They have a goal -- a database schema, a dbt project, an API
spec, an understanding of how their domain works -- and the ORM model
is either a means to that end or persistent context that supports
ongoing work.

The tools should help users achieve their actual goals without
requiring them to think in terms of model operations. And once an ORM
model exists, it should function as living domain context that informs
all downstream work -- code generation, schema evolution, impact
analysis, onboarding -- without the user needing to explicitly invoke
model-specific tools.

Two problems to solve:

1. **Getting to the goal**: The path from "I have a domain" to "I have
   a dbt project" requires too many manual steps and too much knowledge
   of what tools exist and in what order to use them.

2. **Keeping the context alive**: Once an ORM model exists in the
   workspace, it's the most formal definition of the domain's concepts.
   It should be accessible as background context for any development
   task, not just when someone explicitly asks a model question.

## Personas and goals

### Data engineer

**Goal**: Generate physical artifacts (DDL, dbt models, Avro schemas)
from a domain understanding.

**Journey today**: Describe domain in a transcript -> `import_transcript`
-> manually validate -> `generate_schema` (DDL only) -> switch to CLI
for dbt/Avro/OpenAPI export. Multiple tools, multiple surfaces, format
gaps in VS Code and MCP.

**Ideal journey**: Describe domain -> get a validated model with
artifacts in the formats I need, all in one flow. When requirements
change later, the model helps me understand what schema changes are
safe.

### Data architect

**Goal**: Capture and communicate how the domain works so the team can
review it and agree on it.

**Journey today**: Build model manually or from transcript -> verbalize
(separate command) -> generate diagram (separate command) -> share
outputs individually.

**Ideal journey**: Build model -> get a comprehensive domain document
(verbalizations + diagram + constraint summary) in one step. The model
itself serves as the canonical reference the team points to.

### API designer

**Goal**: Generate an OpenAPI spec that accurately represents the
domain's entities and constraints.

**Journey today**: Build model -> switch to CLI for OpenAPI export (not
available as MCP tool or VS Code Language Model tool).

**Ideal journey**: Build model -> export as OpenAPI directly from
wherever I'm working.

### Developer or AI agent (consuming the model)

**Goal**: Have sufficient domain context to write correct code. This
applies equally to a human developer writing a migration and an AI
agent generating a dbt model or reviewing a PR. Both need answers to
the same questions: "what constraints apply to Order?", "is this
field mandatory?", "how do these entities relate?", "is it safe to
make this column nullable?"

The ORM model is the most precise source of truth for these answers.
The challenge is making that context accessible without requiring the
consumer -- human or agent -- to understand ORM 2 formalism or know
that the model exists.

**Journey today**: A human developer opens the .orm.yaml and reads it,
or runs verbalize and reads the output. An AI agent has no awareness
of the domain model unless the user explicitly attaches it via `#file`
or the agent happens to read the file. Neither has a way to ask
targeted questions against the model.

**Ideal journey**: The domain model is available as background context.
A human asks Copilot a domain question and gets an answer grounded in
the formal model. An AI agent generating code automatically pulls
relevant constraints, relationships, and definitions to inform its
output. Neither needs to think about the model as a separate artifact
-- it's the ambient domain knowledge that makes their work correct.

### Team lead / new team member

**Goal**: Onboard to the domain. Understand what data exists and how
it fits together.

**Journey today**: Read the .orm.yaml (dense), or run verbalize (wall
of text), or generate a diagram (visual but no detail).

**Ideal journey**: Ask questions and get explanations grounded in the
model. "What does the Patient entity represent?" "What are the key
relationships in this domain?" The model answers these without the
person needing to know ORM 2 formalism.

## Use cases

### UC-1: Greenfield domain capture

User has domain knowledge (in their head, in meeting notes, in
requirements docs) and wants to formalize it.

**Today**: Write a transcript file -> run `import_transcript` ->
validate -> iterate.

**Friction**: The user must know about the "transcript" concept. If
they just want to describe their domain to Copilot in chat, there's no
tool for that. `import_transcript` requires a file, not a
conversational input.

**Proposed**: `import_transcript` should also accept inline text, not
just file paths. (It already does via MCP's `transcript` parameter,
but the VS Code tool forces a file picker flow.) Additionally, the
`analyze-domain` MCP prompt already guides this flow -- but it's not
available to VS Code Language Model Tools.

### UC-2: Generate physical artifacts

User has an ORM model and needs output in a specific format.

**Today**: `generate_schema` produces DDL or JSON. For dbt, Avro,
OpenAPI: switch to CLI (`barwise export dbt|openapi`) or use VS Code
commands (dbt, Avro only). MCP tools have no export capability beyond
DDL/JSON.

**Friction**: Two problems.

First, format availability varies by surface. MCP and Language Model
Tools can't produce dbt, Avro, or OpenAPI output. A user talking to
Copilot Chat can't say "generate dbt models from this" and get a
result.

Second, adding a new format requires wiring it into every surface
individually (CLI command, MCP tool, VS Code Language Model Tool,
VS Code command). The four existing renderers have four different
function signatures, four different return types, and four different
serialization paths. There's no common interface.

**Proposed**: Define an `ExportFormat` interface in core that all
renderers implement. Each format takes an `OrmModel` and produces
output -- relational formats call `RelationalMapper` internally,
conceptual formats (diagrams, documentation) work from the model
directly. A format registry makes all formats discoverable. The
`export_model` tool (MCP, LM Tools) and `barwise export` (CLI)
dispatch to the registry by name. Adding a new format becomes a
single-file change: implement the interface, register it, done -- all
surfaces pick it up automatically.

```typescript
interface ExportResult {
  /** Primary output as text (for tools, stdout, single-file formats). */
  readonly text: string;
  /** Individual files (for multi-file formats like dbt, Avro). */
  readonly files?: ReadonlyArray<{ name: string; content: string; }>;
  /** Annotations injected into the output (for reporting). */
  readonly annotations?: readonly ExportAnnotation[];
  /** Constraints the format could not express natively (for implementation). */
  readonly constraintSpecs?: readonly ConstraintSpec[];
  /** Per-artifact lineage: which ORM elements produced each output. */
  readonly lineage?: readonly LineageEntry[];
}

interface ExportOptions {
  /** Include TODO/NOTE annotations in output (default: true). */
  readonly annotate?: boolean;
  /** Include population examples in output (default: true). */
  readonly includeExamples?: boolean;
  /** Format-specific options (dialect, namespace, etc.). */
  readonly [key: string]: unknown;
}

interface ExportFormat {
  readonly name: string; // "ddl", "dbt", "avro", "openapi", "svg", ...
  readonly description: string;
  export(model: OrmModel, options?: ExportOptions): ExportResult;
}
```

The `export` method receives the `OrmModel` as its primary input.
Each format decides internally what it needs:

- **Relational formats** (DDL, dbt, Avro, OpenAPI) call
  `RelationalMapper` internally to produce a `RelationalSchema`,
  then render from that. The relational mapping is an implementation
  detail of these formats, not a requirement of the interface.
- **Conceptual formats** (SVG diagram, documentation, GraphQL,
  OWL/RDF) work directly from the ORM model's entity types, fact
  types, constraints, and definitions -- no relational mapping step.

This means adding a non-relational format (documentation, diagram,
ontology export) follows the same pattern as adding a relational one.
The caller doesn't know or care whether the format uses relational
mapping.

**Maximizing semantic expression per format.** Each format should
express ORM semantics as fully as the target format supports, not
just render a lowest-common-denominator relational structure. The ORM
model has 11 constraint types, definitions, subtype relationships,
and value constraints. Different formats can express different subsets
of these natively:

| ORM Semantic             | DDL               | dbt                                       | OpenAPI                 | Avro           |
| ------------------------ | ----------------- | ----------------------------------------- | ----------------------- | -------------- |
| Uniqueness               | PK / UNIQUE       | `unique` test                             | structural              | structural     |
| Composite uniqueness     | composite UNIQUE  | `dbt_utils.unique_combination_of_columns` | --                      | --             |
| Mandatory                | NOT NULL          | `not_null` test                           | `required`              | non-null union |
| Value constraint         | CHECK IN          | `accepted_values` test                    | `enum`                  | `enum` type    |
| Frequency (min/max)      | CHECK / trigger   | `dbt_utils.expression_is_true`            | `minItems`/`maxItems`   | --             |
| Exclusion                | trigger           | `dbt_utils.expression_is_true`            | `oneOf`                 | --             |
| Exclusive-or             | trigger           | `dbt_utils.expression_is_true`            | `oneOf` + `required`    | --             |
| Disjunctive mandatory    | trigger           | `dbt_utils.expression_is_true`            | `anyOf` + `required`    | --             |
| Subset                   | trigger           | `dbt_utils.relationships`                 | --                      | --             |
| Ring (irreflexive, etc.) | CHECK + trigger   | `dbt_utils.expression_is_true`            | --                      | --             |
| Definition               | COMMENT ON        | `description` field                       | `description` field     | `doc` field    |
| Subtype                  | table inheritance | --                                        | `allOf` / discriminator | --             |

dbt is notably the richest target for constraint expression.
`dbt_utils.expression_is_true` is a generic test that evaluates any
SQL expression per row, which means most ORM constraints can be
expressed as actual dbt tests rather than comments. Existing dbt
packages provide the building blocks:

- **`accepted_values`** (built-in): Value constraints map directly.
- **`dbt_utils.unique_combination_of_columns`**: Composite
  uniqueness constraints spanning multiple roles.
- **`dbt_utils.expression_is_true`**: The workhorse. Ring
  constraints become `parent_id != child_id`. Frequency constraints
  become COUNT subqueries. Exclusion constraints become
  `NOT (condition_a AND condition_b)`.
- **`dbt_utils.relationships`**: Already used for foreign keys; also
  handles subset constraints (every value in A must exist in B).
- **`dbt_expectations`** (if available): Provides even more
  expressive tests like `expect_column_values_to_be_between` for
  frequency ranges and `expect_compound_columns_to_be_unique` for
  composite keys.

The dbt `ExportFormat` should generate these tests directly in the
schema.yml rather than leaving them as pseudocode comments. The
export can note which dbt packages are required and flag if a needed
package isn't listed in the project's `packages.yml`.

Today, the renderers only use what `RelationalSchema` carries
(tables, columns, keys, foreign keys). Constraints like value
restrictions, frequency bounds, and exclusion patterns are lost in
the relational mapping step and at best flagged as TODO annotations.

Because each `ExportFormat` receives the full `OrmModel`, it can
reach past the relational schema into the constraint graph for
everything the target format can express. For dbt, this means
generating actual `accepted_values` and `expression_is_true` tests
from ORM constraints -- not comments suggesting that someone should
write them. For OpenAPI, this means `enum` arrays on properties,
`oneOf` for exclusive-or patterns, and `description` fields
populated from entity definitions.

What a format _can_ express becomes a first-class part of the output.
What it _cannot_ express natively should not be silently dropped or
reduced to a vague TODO. Instead, the export should produce a
**constraint specification** that gives an engineer or AI agent
enough context to implement the constraint in whatever language
they're working in.

A constraint specification is pseudocode plus context -- enough for
a human or AI agent to implement the constraint in any language:

```typescript
interface ConstraintSpec {
  /** FORML verbalization -- the business rule in natural language. */
  readonly verbalization: string;
  /** Pseudocode predicate that must hold. */
  readonly pseudocode: string;
  /** Concrete example showing a valid and invalid case. */
  readonly example: string;
}
```

Examples for each constraint type that formats commonly can't express:

**Frequency** -- "Each Customer places at least 2 and at most 5
Orders."

```
pseudocode:
  FOR EACH customer IN Customer:
    ASSERT 2 <= COUNT(Order WHERE Order.customer_id = customer.id) <= 5

example:
  VALID:   Customer "Alice" has 3 Orders -> satisfies constraint
  INVALID: Customer "Bob" has 1 Order -> violates minimum of 2
```

**Ring (irreflexive)** -- "No Person is a parent of that same Person."

```
pseudocode:
  FOR EACH row IN person_is_parent_of_person:
    ASSERT row.parent_person_id != row.child_person_id

example:
  VALID:   parent_person_id=7, child_person_id=12 -> different persons
  INVALID: parent_person_id=7, child_person_id=7  -> same person
```

**Subset** -- "If a Customer rates a Product then that Customer
purchases that Product."

```
pseudocode:
  FOR EACH (customer_id, product_id) IN customer_rates_product:
    ASSERT (customer_id, product_id) EXISTS IN customer_purchases_product

example:
  VALID:   Customer "Alice" rates Product "X" AND purchases Product "X"
  INVALID: Customer "Bob" rates Product "Y" but has no purchase of "Y"
```

**Exclusion** -- "No Person both drives some Car and rides some Bus."

```
pseudocode:
  FOR EACH person IN Person:
    ASSERT NOT (person.id IN person_drives_car AND person.id IN person_rides_bus)

example:
  VALID:   Person "Alice" drives a Car, does not ride a Bus
  INVALID: Person "Bob" drives a Car AND rides a Bus
```

How this renders per format:

- **DDL**: SQL comment block on the relevant table with the
  verbalization, pseudocode, and example.
- **dbt**: YAML comment block, or a skeleton custom generic test
  with the pseudocode as a guide.
- **OpenAPI**: `x-barwise-constraints` extension array with the
  structured specs, machine-readable for code generators.

The pseudocode is language-neutral and reads naturally to both
humans and AI agents. The verbalization explains the business intent.
The example makes the logic concrete and testable -- an engineer
can use it directly as a test case, and an agent can use it to
verify its generated implementation.

This builds on existing infrastructure: the verbalization engine
produces the FORML readings, and the relational schema's traceability
fields (`sourceRoleId`, `sourceConstraintId`) connect constraints to
the tables and columns they affect. Generating the pseudocode is a
matter of translating the constraint parameters into a predicate
over the relational output.

The annotation system (TODO/NOTE) remains for non-constraint
concerns like missing descriptions and default data types. Constraint
specifications handle the richer case of business rules that the
target format cannot express natively.

When `annotate: true` (the default), each format injects TODO/NOTE
comments in its native syntax (see UC-3). The model provides the
annotation context (definitions, value constraints, etc.). When
`annotate: false`, the output is clean.

The `text` field always contains a usable result (combined output for
multi-file formats, or the single output for single-file formats).
The `files` array is present when the format naturally produces
multiple files (dbt: schema.yml + model SQL files; Avro: one .avsc
per table). Tool consumers use `text`; file-writing consumers (CLI
`--output-dir`, VS Code save dialog) use `files`.

The `annotations` array in the result lets callers report what was
flagged, even if the consumer doesn't render the comments (e.g., a
tool could return the clean artifact plus a separate annotation
summary).

The existing `renderDdl`, `renderDbt`, `renderAvro`, and
`renderOpenApi` functions become the internal implementations wrapped
by `ExportFormat` adapters. The existing `annotateDbtExport` logic
gets refactored: annotation collection moves to a shared function,
and each format adapter handles its own annotation injection. No
breaking changes to existing code.

### UC-3: Review and communicate

User wants to understand whether their model is sound, whether open
questions have been addressed, and explain the domain to stakeholders.

**Today**: Run `validate_model` (check for errors) + `verbalize_model`
(natural language readings) + `generate_diagram` (visual). Three
separate invocations. Copilot can compose these, but a user in VS Code
commands would invoke them one at a time.

Additionally, the ORM model may carry `TODO(barwise)` and
`NOTE(barwise)` annotations from LLM transcript extraction -- open
questions, ambiguities, assumptions needing verification. These
annotations exist in the `.orm.yaml` source but are lost when
exporting to physical artifacts. A data engineer reviewing a generated
DDL file or dbt model has no visibility into the unresolved questions
that the modeler flagged.

**Friction**: Two issues. No single "review this model" action. And
annotations don't flow through to exported artifacts.

**Proposed**: Two changes.

First, a `review_model` tool that runs validation + verbalization
and returns a structured summary (error count, key readings, constraint
summary). The MCP prompt `review-model` already describes this flow but
prompts aren't tools -- they guide the AI to call tools, which adds
latency and requires the AI to figure out the composition.

Second, annotations should flow through to exported artifacts in a
format-appropriate way. The annotation collection logic (what to
flag) is already format-independent -- it lives in
`DbtExportAnnotator.ts` but analyzes the ORM model against the
relational schema generically. The injection (where to put comments)
is format-specific. This maps naturally onto the `ExportFormat`
interface: each format knows how to render annotations into its output
syntax.

| Format  | Annotation rendering                                            |
| ------- | --------------------------------------------------------------- |
| DDL     | `-- TODO(barwise): ...` SQL comments on tables/columns          |
| dbt     | `# TODO(barwise): ...` YAML comments (already implemented)      |
| Avro    | `"doc"` field on records/fields                                 |
| OpenAPI | `description` field suffix or `x-barwise-annotations` extension |

The `ExportFormat` interface receives the ORM model alongside the
relational schema so it can access definitions, value constraints,
and other annotation sources. Annotation is opt-in via an `annotate`
option (default: true), consistent with the existing
`--no-annotate` CLI flag.

### UC-4: Model as development context

User is doing development work (writing SQL, building APIs, reviewing
PRs) and the ORM model contains relevant domain knowledge.

**Today**: The model sits in the workspace as a .orm.yaml file.
Copilot doesn't know it exists unless the user attaches it via `#file`
or invokes a tool. MCP clients can read it via the `orm-model://{path}`
resource, but VS Code Language Model Tools have no equivalent.

**Friction**: The model is invisible to AI assistants unless explicitly
surfaced. Its value as persistent context is unrealized.

**Proposed**: A tiered approach, starting with zero-effort options and
building toward richer integration. (See "Making context accessible"
for the full five-tier strategy.)

**Tier 1 -- Configuration (zero code, immediate).** Add a line to
`.github/copilot-instructions.md` and/or `CLAUDE.md` pointing to the
model file and explaining when to consult it. Example:

```
This project has a formal ORM domain model at models/clinic.orm.yaml.
Consult it before generating schemas, migrations, or API code to
ensure correctness. Use the describe_domain tool or read the file
directly.
```

Copilot reads `copilot-instructions.md` on every chat interaction.
Claude Code reads `CLAUDE.md`. This gives the AI ambient awareness of
the model with no code changes at all -- just a documentation
convention. It works today for MCP clients that already have the
`orm-model://` resource, and it will work for Copilot as soon as
`describe_domain` exists (Tier 2).

Template for `.github/copilot-instructions.md`:

```markdown
## Domain Model

This project has a formal ORM 2 domain model at
`models/clinic.orm.yaml`. It defines the canonical entity types,
relationships, constraints, and business rules for this domain.

Before generating database schemas, migrations, API code, dbt
models, or reviewing changes that affect data structure, use the
`#barwiseDescribe` tool to query the domain model for relevant
context. This ensures generated code respects the formal business
rules (mandatory fields, uniqueness constraints, value restrictions,
relationship cardinalities).

Use `#barwiseValidate` after modifying the model to check for errors.
Use `#barwiseExport` to generate artifacts (DDL, dbt, OpenAPI) from
the model.
```

Template for `CLAUDE.md` (Claude Code / MCP clients):

```markdown
## Domain Model

This project has a formal ORM 2 domain model at
`models/clinic.orm.yaml`. It defines entity types, relationships,
constraints, and business rules.

When working on database schemas, migrations, API code, or dbt
models, read the domain model or use the `describe_domain` MCP tool
to understand the relevant constraints and relationships before
generating code. The model is the source of truth for what fields
are mandatory, what values are allowed, how entities relate, and
what business rules apply.
```

**Tier 1.5 -- MCP resource (already implemented).** MCP clients
(Claude Code, Cursor, Windsurf, etc.) can already read the model via
the `orm-model://{path}` resource. Paired with Tier 1 configuration
that tells the agent the resource exists, this provides full model
access with no new code. The gap is VS Code Language Model Tools,
which have no resource concept -- they need a tool to pull context.

**Tier 2 -- `describe_domain` tool.** A tool that takes a model
source + an optional focus query and returns relevant domain context:

- `describe_domain(source, focus: "Patient")` -> Entity description,
  related fact types, applicable constraints, value types
- `describe_domain(source, focus: "mandatory constraints")` -> All
  mandatory role constraints with their readings
- `describe_domain(source)` -> High-level domain summary (entity count,
  key relationships, constraint overview)

This closes the VS Code Language Model Tools gap and provides
structured, focused context rather than dumping the entire model.
With a well-crafted `modelDescription`, Copilot will invoke it
autonomously when it deems domain context relevant -- without the
user explicitly asking.

Combined with Tier 1 configuration, Tiers 1 + 1.5 + 2 cover the
common case across all surfaces: the AI knows the model exists, can
read it directly (MCP) or query it intelligently (describe_domain),
and does so without user prompting.

Higher tiers (chat participant, semantic index, provenance graph) are
described in "Making context accessible" and build on this foundation.

### UC-5: Impact analysis

User is planning a change (add a field, rename an entity, modify a
constraint) and wants to understand the consequences.

**Today**: Manually create the modified model -> `diff_models` ->
read the deltas. Or just make the change and run `validate_model` to
see if anything broke. Neither approach tells you what downstream
artifacts would be affected.

**Friction**: Two problems. First, creating the modified model just
to diff it is tedious. There's no tool for "what would happen if I
added X?" Second, even after diffing, there's no way to trace forward
from model changes to affected artifacts. The user has to manually
figure out which dbt models, DDL scripts, or API specs depend on the
changed elements.

**Proposed**: Two complementary mechanisms.

First, the composition approach: with `describe_domain` providing
context, an AI assistant can reason about model-level impact -- "given
these constraints, adding field X to entity Y would require..." The
`diff_models` and `validate_model` tools are already well-scoped for
verifying changes after the fact.

Second, and more powerful: **lineage-driven impact analysis**. With
the lineage manifest in place (see Tier 5), forward traceability
becomes a concrete operation:

1. User proposes a change to the model (or asks "what if I remove
   the mandatory constraint on `Appointment.status`?").
2. `diff_models` identifies the affected elements (e.g., the
   mandatory constraint with ID `7c9e6679-...`).
3. The lineage manifest is queried for all artifacts whose `sources`
   reference those element IDs.
4. The result: "`stg_appointments.sql` and `schema.yml` reference
   this constraint. The NOT NULL on the `status` column and the
   `not_null` dbt test both derive from it. Removing the constraint
   would require making the column nullable and removing the test."

This is not speculative reasoning -- it is a deterministic lookup on
the manifest. The AI assistant can compose `diff_models` + manifest
lookup to give precise, traceable impact reports.

### UC-6: Schema evolution

User's domain has changed and they need to update both the model and
downstream artifacts.

**Today**: Edit the .orm.yaml manually -> validate -> re-export. If
the change came from a new transcript, use `import_transcript` to
merge. After updating the model, the user must remember which formats
they previously exported and re-export each one manually. There is no
way to know which artifacts are stale or which specific elements
changed.

**Friction**: Three problems. First, the merge is non-interactive in
MCP/CLI (accept all additions, reject all removals) -- only VS Code
has interactive delta review. Second, there's no tool for "apply this
specific change to the model" -- it's all-or-nothing merge or manual
editing. Third, and most important: after updating the model, the
user must manually re-export every downstream artifact and has no
visibility into what changed or what's stale.

**Proposed**: Three improvements.

First, `merge_models` is fine for bulk merges. For targeted changes,
the AI assistant can edit the YAML directly (it's a well-structured
format).

Second, making the validate -> re-export cycle smooth ties back to
UC-2 (all export formats available everywhere).

Third, **lineage-driven re-export**. With the lineage manifest
tracking what was exported and when:

1. After a model change, `barwise lineage status` (or a tool call)
   compares the current model hash against the manifest. If they
   differ, it reports which artifacts are stale and which model
   elements changed.

2. `barwise export --stale` re-exports only the artifacts whose
   source elements were modified, using the same format and options
   as the original export (recorded in the manifest).

3. For AI-assisted evolution: the agent updates the model, runs
   `diff_models` to confirm the change, checks the manifest for
   affected artifacts, and re-exports the stale ones -- all without
   the user needing to remember what was exported or in what format.

This turns schema evolution from a manual, error-prone process ("did
I re-export the OpenAPI spec?") into a tracked, verifiable workflow.

### UC-7: Brownfield formalization

User has an existing database schema, dbt project, API spec, or other
artifacts and wants to create an ORM model from them.

**Today**: VS Code has `importDbtProject` for dbt projects. CLI and
MCP have no reverse-engineering capability. There's no DDL, OpenAPI,
or Avro import.

**Friction**: Limited on-ramps, and an asymmetry with export. If the
tool can export to DDL, dbt, OpenAPI, and Avro, users will reasonably
expect to import from those same formats. Someone who already has a
Postgres schema or an OpenAPI spec shouldn't have to re-describe their
domain in a transcript -- the formal structure is already there.

**Proposed**: Import/export symmetry as a design goal. Not every
format needs import support immediately, but the architecture should
accommodate it.

An `ImportFormat` interface mirrors `ExportFormat`, with a two-phase
design (see "LLM use principles"):

```typescript
interface ImportResult {
  /** The inferred ORM model. */
  readonly model: OrmModel;
  /** Ambiguities and assumptions made during inference. */
  readonly warnings: readonly string[];
  /** Confidence level for the overall import. */
  readonly confidence: "high" | "medium" | "low";
}

interface ImportFormat {
  readonly name: string; // matches ExportFormat.name
  readonly description: string;

  /** Phase 1: Deterministic parse. Always available, no LLM. */
  parse(input: string, options?: ImportOptions): ImportResult;

  /** Phase 2: LLM enrichment. Optional, improves the draft. */
  enrich?(
    draft: ImportResult,
    input: string,
    llm: LlmClient,
    options?: ImportOptions,
  ): Promise<ImportResult>;
}
```

Import is inherently harder than export. Export is deterministic: the
ORM model has precise semantics, and each format renders them. Import
requires inference: a table named `patient_appointments` might be an
associative table from a binary fact type or an entity table with a
compound name. A NOT NULL column is probably a mandatory constraint,
but it might be an artifact of the schema tool's defaults. Import
produces a **draft model** that needs human or AI review, not a
finished product.

That said, different formats vary in how much they can tell us:

| Format  | What it captures                                            | Import feasibility                                                                                                         |
| ------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| DDL     | Tables, columns, types, PK, FK, UNIQUE, NOT NULL, CHECK     | Medium -- good structural coverage, but no business semantics (definitions, readings)                                      |
| dbt     | Models + schema.yml with tests, descriptions, relationships | High -- already implemented in VS Code. Tests map back to constraints. Descriptions provide semantics.                     |
| OpenAPI | Schemas, properties, required, enum, $ref, descriptions     | Medium-high -- rich type info and relationships. `description` fields provide semantics. `enum` maps to value constraints. |
| Avro    | Record schemas, fields, types, enums, doc                   | Medium -- structural but flat. No explicit relationships between schemas.                                                  |

The import flow ties into the provenance system. When importing from
an existing artifact, the lineage relationship is reversed: instead of
"ORM model produced this artifact," it's "this artifact was the source
of this ORM model." This is model-creation provenance, analogous to
`TranscriptProvenance` from LLM extraction. The import should record
which artifact it came from so the connection is traceable.

**Implementation path**:

1. **Now**: Expose existing dbt import on all surfaces (MCP, CLI).
   It already works in VS Code; the logic lives in core.

2. **Soon**: DDL import. The relational-to-ORM inference is the
   inverse of `RelationalMapper` and can reuse its type mappings.
   A DDL parser (or just accepting the output of `pg_dump` /
   `SHOW CREATE TABLE`) plus heuristic entity/fact type inference
   gets a useful draft model.

3. **Soon**: OpenAPI import. OpenAPI schemas are rich enough to infer
   entity types (from schema objects), fact types (from $ref
   relationships), value constraints (from enums), and mandatory
   constraints (from required arrays). Descriptions become ORM
   definitions.

4. **Later**: Avro import. Lower priority because Avro schemas are
   structurally simpler (flat records, no explicit relationships).

The `import_model` tool (counterpart to `export_model`) would
dispatch to the `ImportFormat` registry by name, just as
`export_model` dispatches to `ExportFormat`. Adding a new import
format follows the same pattern: implement the interface, register
it, all surfaces pick it up.

## The model as persistent context

The ORM model is the most formal, precise definition of a domain's
concepts. Unlike generated artifacts (DDL, dbt models), the ORM model
preserves WHY the schema looks the way it does:

- **Constraints explain business rules**: "Each Patient is treated by
  at most one Doctor" is a uniqueness constraint that becomes a UNIQUE
  key in DDL -- but the DDL doesn't tell you the business rule.
- **Fact types explain relationships**: "Patient is admitted to Ward"
  is a binary fact type. The DDL shows a foreign key, but the fact
  type carries the semantic reading.
- **Subtypes explain classification**: "Outpatient is a subtype of
  Patient" explains why two tables share a key. The DDL doesn't
  capture this.
- **Definitions explain meaning**: "A Patient is a person who is
  receiving or registered to receive medical treatment." This context
  exists nowhere else.

For ongoing development work, this means the ORM model can answer
questions that no other artifact can:

- "What does this entity mean?" -> definitions
- "Why is this column NOT NULL?" -> mandatory constraint on a role
- "Why do these tables share a primary key?" -> subtype relationship
- "What business rules apply to this entity?" -> constraints
- "Is it safe to make this field nullable?" -> check if there's a
  mandatory constraint and what it means

### Making context accessible

Five tiers, from most immediate to most ambitious. Each tier builds
on the ones before it.

#### Tier 1: Configuration (no code, do now)

Copilot reads `.github/copilot-instructions.md` automatically in
every chat interaction. Claude Code reads `CLAUDE.md`. If either file
says "this project has an ORM domain model at `X.orm.yaml` -- use
`describe_domain` to query it when you need to understand the domain
before generating code, writing migrations, or reviewing changes,"
the AI gains ambient awareness of the model via system prompt.

The AI doesn't discover the model -- it's told the model exists and
how to use it. This is crude but effective, costs nothing, and works
as soon as `describe_domain` exists.

#### Tier 2: Tool discoverability (proposed in this spec)

The `describe_domain` tool registered as a VS Code Language Model Tool
with a well-crafted `modelDescription`. Copilot uses
`modelDescription` to decide when to invoke tools autonomously. If the
description says "Query the formal domain model for entity definitions,
constraints, relationships, and business rules. Use this before
generating database schemas, API code, or data models to ensure
correctness," Copilot will call it when it deems domain context
relevant -- without the user explicitly asking.

This is the primary mechanism proposed in this spec. Combined with
Tier 1, it covers the common case: the AI knows the model exists and
can query it on demand.

#### Tier 3: Chat participant (near-term enhancement)

A VS Code chat participant (`@barwise`) that intercepts domain-related
questions and auto-injects model context. The user types
`@barwise what constraints apply to Patient?` and the participant finds
the workspace .orm.yaml, deserializes it, extracts the relevant slice,
and includes it in the prompt.

More seamless than Tier 2 for explicit domain questions, but still
requires the user to direct the conversation. Builds directly on the
`describe_domain` implementation.

#### Tier 4: Semantic index / RAG (medium-term)

Vectorize the model's verbalizations and definitions, then use
similarity search to automatically retrieve relevant model context
when the AI is working on related code.

Example: the AI is editing a file that references
`appointment_status`. The semantic index finds that the ORM model has
a Definition for "AppointmentStatus" and a mandatory constraint on the
Role where Patient is assigned an AppointmentStatus. That context gets
injected automatically -- no tool invocation, no user action.

This requires embedding infrastructure and a retrieval pipeline. It
makes the model truly ambient: the AI doesn't need to be told to look
at the model, and the user doesn't need to know the model exists.

#### Tier 5: Provenance and lineage

The ORM model is already a graph: entity types are nodes, fact types
are edges, constraints are annotations, subtypes create hierarchies.
Re-representing this structure in a separate graph database adds little
value. The real power of a knowledge graph approach is in tracking the
**connections between the model and the artifacts it produced**.

This is not a "nice to have." It is the mechanism that makes the ORM
model operationally useful beyond the moment of export. Without
lineage, each export is a one-shot operation: the model produces an
artifact, and the connection between them is lost. The artifact lives
on as an independent file that can drift, go stale, or be modified
without any awareness of the domain rules that shaped it. With
lineage, every exported artifact remains connected to the domain
concepts that justify it.

##### What lineage tracks

Lineage records the relationship between ORM model elements and the
artifacts they produce. Concretely:

- "The dbt model `stg_appointments.sql` was generated from the ORM
  entity types `Appointment`, `Patient`, and `AppointmentStatus`, and
  the fact types that connect them."
- "The column `appointments.status` is NOT NULL because of the
  mandatory role constraint on Role[1] of `Appointment has
  AppointmentStatus`."
- "The `accepted_values` test on `appointments.status` expresses the
  value constraint `{'scheduled', 'completed', 'cancelled'}` from
  the ORM model."
- "The OpenAPI path `POST /patients` corresponds to the fact type
  `Patient is identified by PatientId`."
- "These artifacts were last exported on 2026-02-15; the ORM model
  has changed since then (new constraint added to `Appointment`)."

##### How lineage gets produced

The infrastructure is partially in place. `RelationalSchema` already
carries traceability fields:

- `Table.sourceElementId` -- the entity type or fact type ID that
  produced the table (always populated).
- `Column.sourceRoleId` -- the role ID that produced the column
  (populated for most columns).
- `ForeignKey.sourceConstraintId` -- the constraint ID that produced
  the FK (declared but **not currently populated** -- a gap to fix).

These fields connect relational output back to ORM model elements.
The `DbtExportAnnotator` already uses `sourceRoleId` to trace columns
back to their value types for annotation. What is missing is:

1. **Persisting these connections beyond the export call.** Today the
   traceability fields exist in memory during the export, are used by
   `DbtExportAnnotator` to generate comments, and are then discarded.
   Nothing records that `stg_patients.sql` came from entity type
   `Patient`.

2. **Extending traceability to constraint-level granularity.**
   `sourceConstraintId` on ForeignKey is never populated. Constraints
   like value restrictions, frequency bounds, and exclusion patterns
   have no traceability at all -- they are either expressed as tests
   (if the format supports it) or dropped silently.

3. **Tracking model state at export time.** There is no record of
   which version of the ORM model produced a given artifact. Without
   this, staleness detection is impossible.

The fix is to have each `ExportFormat` produce lineage data as part
of its `ExportResult`. The `lineage` field carries per-artifact
source references (see updated `ExportResult` in UC-2). The caller
(CLI, MCP tool, VS Code command) writes the artifacts **and** persists
the lineage to a manifest.

##### Lineage data model

```typescript
/** A reference from an exported artifact back to its ORM source. */
interface SourceReference {
  readonly elementId: string;
  readonly elementType:
    | "EntityType"
    | "ValueType"
    | "FactType"
    | "Constraint"
    | "SubtypeFact"
    | "Role";
  readonly elementName: string;
}

/** Lineage for a single exported artifact. */
interface LineageEntry {
  /** Output artifact (file path relative to project root). */
  readonly artifact: string;
  /** ORM elements that contributed to this artifact. */
  readonly sources: readonly SourceReference[];
}
```

The manifest persists lineage across exports:

```typescript
/** Persisted in .barwise/lineage.yaml alongside the project. */
interface LineageManifest {
  readonly version: 1;
  readonly sourceModel: string; // path to .orm.yaml
  readonly sourceModelHash: string; // content hash at export time
  readonly exports: readonly ManifestExport[];
}

interface ManifestExport {
  readonly artifact: string; // relative path to exported file
  readonly format: string; // "dbt", "ddl", "openapi", ...
  readonly exportedAt: string; // ISO 8601 timestamp
  readonly modelHash: string; // hash of model at this export
  readonly sources: readonly SourceReference[];
}
```

Example manifest:

```yaml
# .barwise/lineage.yaml
version: 1
sourceModel: models/clinic.orm.yaml
sourceModelHash: sha256:a1b2c3...
exports:
  - artifact: dbt/models/staging/stg_patients.sql
    format: dbt
    exportedAt: "2026-03-01T10:00:00Z"
    modelHash: sha256:a1b2c3...
    sources:
      - elementId: 550e8400-...
        elementType: EntityType
        elementName: Patient
      - elementId: 6ba7b810-...
        elementType: FactType
        elementName: Patient is identified by PatientId
      - elementId: 7c9e6679-...
        elementType: Constraint
        elementName: "UC: Patient is identified by PatientId"

  - artifact: dbt/models/staging/stg_appointments.sql
    format: dbt
    exportedAt: "2026-03-01T10:00:00Z"
    modelHash: sha256:a1b2c3...
    sources:
      - elementId: 8f14e45f-...
        elementType: EntityType
        elementName: Appointment
      - elementId: 9a0364b9-...
        elementType: EntityType
        elementName: AppointmentStatus
      # ...
```

##### What lineage enables

Six concrete capabilities, roughly in order of implementation effort:

**1. Staleness detection.** Compare `modelHash` in the manifest
against the current model's hash. If they differ, every artifact in
the manifest is potentially stale. Finer-grained: diff the current
model against the model-at-export and check which elements changed.
If only `Patient` changed, only artifacts whose `sources` reference
`Patient` are stale.

This can surface as a VS Code diagnostic ("3 exported artifacts are
stale after model changes"), a CLI command (`barwise lineage status`),
or a tool response ("The dbt models were last exported before you
added the frequency constraint on Orders").

**2. Impact analysis.** Given a proposed model change (UC-5), trace
forward through the manifest to find every artifact that depends on
the affected elements. "If I remove the mandatory constraint on
`Appointment.status`, which artifacts are affected?" The manifest
says: `stg_appointments.sql` and `schema.yml` both reference that
constraint. The `accepted_values` test in schema.yml came from the
value constraint on the same role. The agent can report exactly what
would need to change and what tests would need updating.

**3. Context injection for agents.** This is the bridge between
Tier 4 (semantic index) and Tier 5. When an agent opens or edits
`stg_appointments.sql`, the lineage manifest says this file was
produced from `Appointment`, `Patient`, `AppointmentStatus`, and
their constraints. The agent (or a tool it calls) can pull exactly
those entities' definitions, constraints, and relationships as
context -- without reading the entire model, and without the user
needing to point it to the right file.

This works with simple file-path matching (the agent knows what file
it's editing, the manifest maps file paths to ORM elements). No
vector embeddings or semantic search required.

**4. Drift detection.** Hash each exported artifact at export time
and store the hash in the manifest. Later, compare the current file
hash against the stored hash. If they differ, the artifact has been
modified after export -- either by hand or by another tool. This
surfaces as: "stg_appointments.sql has been modified since it was
last exported from the ORM model. Run `export_model` to regenerate,
or update the model to match the manual changes."

**5. Bidirectional traceability.** The manifest supports two query
directions:

- **Forward** (model -> artifacts): "What did this entity type
  produce?" Look up all manifest entries whose `sources` contain
  the element ID.
- **Reverse** (artifact -> model): "Where did this file come from?"
  Look up the manifest entry for the file path and read its
  `sources`.

Both directions are simple lookups on a small YAML file. No graph
database needed.

**6. Re-export orchestration.** With staleness detection and
forward traceability, re-exporting after a model change becomes
targeted: only regenerate the artifacts whose source elements
actually changed, rather than re-exporting everything. The CLI
could support `barwise export --stale` to re-export only what needs
updating.

##### Relationship to existing provenance

The codebase already has a separate provenance system for transcript
extraction: `TranscriptProvenance` in `OrmYamlAnnotator.ts` records
which transcript lines produced which model elements, with confidence
scores and ambiguity flags. This is **model-creation provenance** --
where the model came from.

Lineage is **model-consumption provenance** -- what the model
produced. The two systems are complementary and could eventually
connect: a full trace from "this transcript line" through "this ORM
entity type" to "this dbt model column" to "this dbt test."

##### Storage and lifecycle

The manifest lives at `.barwise/lineage.yaml` in the project root
(or alongside the `.orm.yaml` file for single-model projects). It
is a derived artifact that can be regenerated by re-exporting. It
should be committed to version control so the team shares a common
view of what was exported and when, and so CI can check for
staleness.

The manifest is append-and-update: each export updates the entries
for the affected format (replacing previous entries for the same
artifact paths). It never grows unboundedly because it tracks current
state, not history. History is in git.

##### Implementation approach

Lineage builds on existing infrastructure rather than requiring new
abstractions:

1. **Fix `sourceConstraintId` population** in `RelationalMapper` so
   foreign keys are traceable to their source constraints.

2. **Add `lineage` field to `ExportResult`** (see UC-2). Each
   `ExportFormat` populates this from the `OrmModel` -- the
   authoritative source of domain semantics. For relational formats,
   the `RelationalSchema` traceability fields (`sourceElementId`,
   `sourceRoleId`, `sourceConstraintId`) serve as the bridge back to
   ORM elements, but the lineage references the ORM elements
   themselves, not the relational intermediaries.

3. **Add manifest read/write** as a utility in core (parse/serialize
   the YAML manifest, merge new exports into existing manifest,
   compute model hash).

4. **CLI writes manifest on export.** `barwise export` already writes
   files to `--output-dir`. Adding manifest persistence is a small
   change.

5. **`barwise lineage status`** -- CLI command that reads the manifest,
   compares model hash, reports stale artifacts. This is the first
   consumer-facing lineage feature.

6. **Integrate with `describe_domain`.** When given a file path
   instead of a model source, `describe_domain` can check the
   manifest to find which ORM elements produced that file and return
   their context. This is how context injection (capability 3 above)
   works in practice.

The lineage manifest is simple enough (a flat list of exports with
source references) that it does not require a graph database, a new
storage format, or external infrastructure. It is a YAML file that
sits next to the model and moves with the project.

##### Scope boundary

The lineage system tracks **barwise-generated artifacts**. It does not
attempt to track manually-written code that references the domain, nor
does it track runtime data lineage (which rows flowed through which
tables). Those are separate concerns handled by tools like dbt lineage
graphs and data observability platforms. The barwise lineage system
answers a narrower question: "what is the formal relationship between
my domain model and the artifacts it produced?"

#### Implementation priority

**Now** -- Tiers 1 and 2. They require `describe_domain` (already
proposed) plus configuration files. No new infrastructure.

**Soon** -- Tier 5 (lineage). The value is clear and the
infrastructure is partially in place (traceability fields in
`RelationalSchema`, annotation collection in `DbtExportAnnotator`).
The implementation approach (above) is incremental: fix
`sourceConstraintId`, add `lineage` to `ExportResult`, write a
manifest file on export, add a `lineage status` CLI command. Each
step is independently useful. Lineage does not require Tiers 3 or 4
as prerequisites -- it builds directly on Tier 2's `describe_domain`
and the `ExportFormat` interface.

**Later** -- Tier 3 (chat participant) and Tier 4 (semantic index).
These enhance the developer experience but are not required for
lineage or core tool functionality. Tier 3 is a natural follow-on
to `describe_domain`. Tier 4 requires embedding infrastructure and
should be scoped separately once lineage is proven out.

## LLM use principles

**Deterministic where possible, LLM for disambiguation and judgment.**

The majority of the tool surface is deterministic: validation is
rule-based, verbalization is template-driven, export is mechanical
rendering, diff is structural comparison, lineage is manifest lookup.
These operations produce predictable, reproducible results and should
stay that way. LLM involvement adds latency, cost, non-determinism,
and a provider dependency. It is only justified when the task requires
semantic judgment that cannot be encoded as rules.

### Where LLM is not appropriate

| Operation            | Why deterministic is sufficient                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| Validation           | Structural rules are well-defined. A missing mandatory role is an error regardless of context.          |
| Verbalization        | FORML readings are template-driven. The reading pattern for a binary fact type is fixed.                |
| Export (all formats) | The ORM model has precise semantics. Rendering to DDL, dbt, OpenAPI, or Avro is mechanical translation. |
| Diff / merge         | Structural comparison. Two models either have the same entity type or they don't.                       |
| Lineage              | Manifest lookup. Staleness is a hash comparison.                                                        |
| Diagram generation   | Layout algorithm + SVG rendering. No judgment involved.                                                 |

### Where LLM adds genuine value

**1. Transcript extraction (existing).** The input is unstructured
natural language. Extracting entity types, fact types, and constraints
from prose is an inherently linguistic task. This is the core use case
for `@barwise/llm` and will remain so.

**2. Structured format import (new).** Deterministic parsing handles
the structural mapping (tables -> entity types, FK -> fact types,
NOT NULL -> mandatory constraints). But ambiguities arise that
heuristics can't reliably resolve:

- Is `patient_appointments` an associative table or an entity table?
- Is `status` a value type or a reference to a separate entity?
- What does the `expression_is_true` dbt test
  `parent_id != child_id` mean as an ORM constraint?
- What should the entity be named when the source column is
  `pat_appt_sts`?

The approach is a **two-phase pipeline**: deterministic parsing
produces a draft model, then an optional LLM enrichment pass resolves
ambiguities, adds definitions, improves naming, and identifies
semantic structure (subtypes, missing constraints) that the source
format doesn't make explicit.

```typescript
interface ImportFormat {
  readonly name: string;
  readonly description: string;

  /** Phase 1: Deterministic parse. Always available, no LLM needed. */
  parse(input: string, options?: ImportOptions): ImportResult;

  /** Phase 2: LLM enrichment. Optional, improves the draft model. */
  enrich?(
    draft: ImportResult,
    input: string,
    llm: LlmClient,
    options?: ImportOptions,
  ): Promise<ImportResult>;
}
```

The `parse` method is always available and produces a usable (if
rough) model. The `enrich` method is optional and requires an LLM
client. Callers decide whether to run enrichment based on whether
an LLM is available and whether the user wants it. CI pipelines
and offline workflows use `parse` only. Interactive sessions and
agent-assisted workflows use `parse` + `enrich`.

This keeps the deterministic path fast, free, and reproducible while
allowing LLM assistance when it genuinely helps.

**3. Model review (new capability).** The validation engine catches
structural errors (missing roles, orphaned constraints, invalid
references). But it cannot make semantic judgments:

- "This entity has no definition -- consider adding one."
- "These two entity types (`Inpatient`, `Outpatient`) look like
  subtypes of `Patient`."
- "The fact type `Person drives Car` has no uniqueness constraint.
  Can a person drive multiple cars, or should this be unique?"
- "These definitions are vague and would not help a developer
  understand the domain."

A `review_model` tool (or an LLM-enhanced mode of `validate_model`)
could produce these suggestions. Unlike validation errors, review
suggestions are advisory -- they don't block export or indicate
broken structure. They help a modeler improve the quality and
completeness of their model.

This is a genuine judgment task: deciding whether two entity types
"look like" subtypes, or whether a definition is "vague," requires
understanding of the domain and modeling conventions that cannot be
encoded as deterministic rules.

### The LLM availability spectrum

Not every user has LLM access. The tool surface must work without it:

| LLM availability | What works                                                                         | What doesn't                                                       |
| ---------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| No LLM           | All deterministic tools, `parse`-only imports, full export/lineage/validation/diff | Transcript extraction, import enrichment, model review suggestions |
| LLM available    | Everything above + transcript extraction, enriched imports, model review           |                                                                    |

No tool should silently fail because an LLM is unavailable. Tools
that benefit from LLM enrichment should produce useful results
without it and indicate what additional value enrichment would
provide. For example, a DDL import without enrichment produces a
model with generic names and no definitions. The tool response should
note: "Enrichment available -- run with `--enrich` to add definitions
and resolve naming ambiguities."

## Populations: surfacing sample data

### The asset we're not using

The ORM metamodel has a fully implemented `Population` system: sample
fact instances (tuples of role values) that can be validated against
all constraint types. A population for "Customer places Order" might
contain:

```yaml
populations:
  - fact_type: customer_places_order
    description: "Sample order data"
    instances:
      - { customer: "Alice", order: "ORD-001" }
      - { customer: "Alice", order: "ORD-002" }
      - { customer: "Bob",   order: "ORD-003" }
```

The validation engine already checks these instances against
uniqueness, value constraints, frequency bounds, exclusion, ring
constraints, subset, and equality. This is powerful: it answers "do
the examples actually satisfy the rules?" -- which is how domain
experts naturally validate a model ("ok but what about the case
where...?").

Yet populations are invisible in the tool surface. No tool generates
them, displays them, or uses them in exports. They exist in the YAML
and can be validated, but they don't flow through to any consumer.

### Where populations should surface

**1. LLM transcript extraction.** People naturally give examples when
describing a domain: "Alice has 3 open orders," "Bob is a doctor at
General Hospital," "an appointment can be scheduled, completed, or
cancelled." These examples are currently discarded during extraction.
The LLM should capture them as population instances alongside the
entity types and constraints it already extracts.

This is a natural extension of the existing extraction prompt. The
LLM already identifies entity types and fact types from the same
conversational context. Extracting the concrete examples that
illustrate those facts is a small addition to the prompt.

**2. Exports.** Populations provide concrete data that each export
format can use natively:

| Format        | How populations render                                            |
| ------------- | ----------------------------------------------------------------- |
| DDL           | `INSERT INTO` statements or `-- Example:` comments                |
| dbt           | Seed files (`seeds/customers.csv`) with sample data               |
| OpenAPI       | `example` values on schema properties and request/response bodies |
| Avro          | Example records in `doc` fields                                   |
| Documentation | Example tables alongside entity descriptions                      |

The `ExportOptions` interface should include an `includeExamples`
option (default: true). When enabled, the export format renders
population data in its native example mechanism. When disabled,
examples are omitted (useful for production schema generation where
sample data is noise).

```typescript
interface ExportOptions {
  readonly annotate?: boolean;
  readonly includeExamples?: boolean; // new
  readonly [key: string]: unknown;
}
```

**3. `describe_domain`.** When explaining an entity or fact type,
concrete examples make the explanation tangible. Without populations:

> "Patient is identified by PatientId. Patient is admitted to Ward.
> Each Patient is treated by at most one Doctor."

With populations:

> "Patient is identified by PatientId. Patient is admitted to Ward.
> Each Patient is treated by at most one Doctor.
>
> Examples: Patient 'Alice' (P001) is admitted to Ward 'ICU' and
> treated by Dr. Smith. Patient 'Bob' (P002) is admitted to Ward
> 'Cardiology' and treated by Dr. Jones."

For a human asking "what is a Patient?", the examples ground the
abstraction. For an AI agent generating code, the examples serve as
test data and clarify the semantics of fields that a schema alone
leaves ambiguous.

**4. Model review.** An LLM reviewing a model (see "LLM use
principles") could suggest populations to test edge cases:

- "The frequency constraint says 2-5 orders per customer. Consider
  adding a population instance with exactly 2 and exactly 5 orders
  to verify the bounds."
- "The exclusion constraint says a person cannot both drive a car
  and ride a bus. Consider adding a population that tests this
  boundary."

**5. Import enrichment.** When importing from DDL or OpenAPI, the
LLM enrichment phase could generate sample populations to make the
inferred model concrete and testable. A DDL import that infers
`Patient is admitted to Ward` from a foreign key could also produce
example instances, giving the reviewer something to validate against
the real domain.

### Populations and validation

The population validation engine is already implemented but not
exposed through any tool. Currently, `validate_model` runs structural
validation only. Population validation runs separately if there are
populations in the model.

**Proposed**: When the model contains populations, `validate_model`
should include population constraint violations in its diagnostics.
A population instance that violates a uniqueness constraint or
frequency bound is a validation finding, just like a missing role
reference. This requires no new infrastructure -- the validation
rules exist, they just need to be included in the standard validation
run.

This makes populations a **testing mechanism**: add examples to the
model, run validate, and see if the examples satisfy the constraints.
If they don't, either the examples are wrong (fix the data) or the
constraints are wrong (fix the model). This is the ORM 2 equivalent
of test-driven development.

## Proposed tool surface

### New tools

#### `describe_domain`

**Purpose**: Query the ORM model for domain context. The primary tool
for using the model as ongoing reference.

**Parameters**:

- `source` (string): File path or inline YAML
- `focus` (string, optional): Entity name, fact type, constraint type,
  or natural-language question to focus on

**Output**: Structured text appropriate to the focus:

- No focus: High-level summary (entity list, relationship count,
  constraint summary, definitions)
- Entity focus: Entity description (definition if present), related
  fact types with readings, applicable constraints, value types
- Constraint focus: All constraints of that type with readings and
  affected entities
- Fact type focus: Full reading, roles, constraints, related entities

**Rationale**: This is the "model as context" tool. It lets AI
assistants pull exactly the domain knowledge they need for any task.
It's the tool equivalent of the MCP `orm-model://` resource but with
intelligent focusing.

**Available on**: MCP, VS Code Language Model Tools, CLI
(`barwise describe`)

#### `export_model`

**Purpose**: Generate artifacts from a model in any supported format.
Consolidates the fragmented export capabilities behind the
`ExportFormat` registry (see UC-2).

**Parameters**:

- `source` (string): File path or inline YAML
- `format` (string): Any registered format name. Initial set:
  `ddl`, `dbt`, `avro`, `openapi`, `json`, `yaml`
- `annotate` (boolean, optional, default: true): Include TODO/NOTE
  annotations in the output. When true, the export format injects
  comments flagging missing descriptions, default data types, value
  constraints available for tests, and other items needing review.
  When false, the output is clean.
- `strict` (boolean, optional, default: false): When true, refuse to
  export if the model has validation errors. When false (default),
  export proceeds and any validation errors are included as warnings
  in the response alongside the artifact.
- `includeExamples` (boolean, optional, default: true): Include
  population data as examples in the output. Renders as INSERT
  statements (DDL), seed files (dbt), `example` values (OpenAPI),
  or doc fields (Avro). Set to false for clean production schemas.
- `options` (object, optional): Format-specific options passed through
  to the `ExportFormat.export()` call. Each format defines its own
  options:
  - ddl: `{ dialect: "generic" | "postgres" | "snowflake" }`
  - openapi: `{ title, apiVersion, basePath }`
  - avro: `{ namespace }`
  - dbt: `{ sourceName, generateRelationshipTests }`

**Output**: `ExportResult` -- always includes `text` (the primary
output as a single string). For multi-file formats, also includes
`files[]` with individual file names and contents. `annotations[]`
lists what was flagged regardless of whether comments were injected
(useful for reporting separately from the artifact). Tool consumers
(MCP, Language Model Tools) use `text`; file-writing consumers (CLI,
VS Code commands) use `files` when present.

**Rationale**: The tool parses the model from source and dispatches to
the `ExportFormat` registry by name. It doesn't need to know anything
about specific formats -- not even whether they use relational mapping.
When a new format is added to core (implement `ExportFormat`, register
it), this tool automatically supports it with no changes to MCP,
Language Model Tools, or CLI wiring.

**Available on**: MCP, VS Code Language Model Tools, CLI (already has
`barwise export`, this aligns MCP/LM tools with CLI)

#### `review_model`

**Purpose**: LLM-powered semantic review of an ORM model. Produces
advisory suggestions that go beyond structural validation -- missing
definitions, potential subtype relationships, unconstrained fact
types, vague descriptions, edge cases worth testing with populations.

**Parameters**:

- `source` (string): File path or inline YAML
- `focus` (string, optional): Specific entity, fact type, or area
  to focus the review on. Omit for a full-model review.

**Output**: Structured list of suggestions, each with:

- `category`: "definition" | "constraint" | "subtype" | "population"
  | "naming" | "completeness"
- `severity`: "suggestion" | "recommendation"
- `element`: The entity type, fact type, or constraint the suggestion
  applies to
- `message`: The suggestion text
- `rationale`: Why this was flagged

**Rationale**: The validation engine catches structural errors. This
tool catches semantic gaps -- things that aren't wrong but could be
better. It's the difference between "your model compiles" and "your
model is complete and well-specified." The MCP prompt `review-model`
already describes this flow but requires the AI to compose multiple
tool calls. A dedicated tool makes the review a single invocation.

**LLM required**: Yes. This is an inherently judgment-based task
(see "LLM use principles"). The tool should fail gracefully with a
clear message if no LLM is available.

**Available on**: MCP, VS Code Language Model Tools, CLI
(`barwise review`)

### Modified tools

#### `validate_model` -- no changes

Already well-scoped. Returns structured diagnostics. Keep as-is.

#### `verbalize_model` -- no changes

Already well-scoped. Returns natural language readings. Keep as-is.
(Verbalization is distinct from `describe_domain` -- verbalize
produces formal FORML readings, describe produces contextual
explanations.)

#### `diff_models` -- no changes

Already well-scoped. Returns structured deltas. Keep as-is.

#### `import_transcript` -- minor expansion

Accept inline transcript text (already works in MCP, ensure VS Code
Language Model Tool supports it too). Consider renaming to
`extract_model` in a future pass to better communicate what it does
(extracting domain knowledge, not importing a file format).

#### `merge_models` -- add preview mode

The current all-or-nothing merge (accept all additions, reject all
removals) is too coarse for AI-assisted workflows where the agent
should review individual deltas.

Add a `preview` parameter (boolean, default: false). When true,
`merge_models` returns the diff (additions, modifications, removals)
without applying it. The caller can review each delta and selectively
apply changes by editing the YAML directly.

```
merge_models(base, incoming, preview: false)
  -> merged model YAML (current behavior)

merge_models(base, incoming, preview: true)
  -> { additions: [...], modifications: [...], removals: [...] }
     (structured diff, nothing applied)
```

This gives AI agents the ability to make judgment calls: "this new
entity looks right, but this removal conflicts with an existing
constraint -- I'll accept the addition and reject the removal." The
agent then edits the base model YAML to apply the accepted changes.

The non-preview mode remains the default for backward compatibility
and for cases where accept-all is the right behavior (initial model
creation, automated pipelines).

### Deprecated tools

#### `generate_schema` -> superseded by `export_model`

`generate_schema` with `format: ddl|json` is a subset of
`export_model`. Keep it working for backward compatibility but steer
documentation and tool descriptions toward `export_model`.

#### `generate_diagram` -> subsumed by `export_model` + `describe_domain`

Diagram generation is an output format (`export_model(format: svg)`)
and also useful as context (`describe_domain` could reference diagram
availability). Keep it working but consolidate under `export_model`.

### Tool surface by interface

| Tool                | MCP (stdio) | VS Code LM |                                CLI                                |
| ------------------- | :---------: | :--------: | :---------------------------------------------------------------: |
| `validate_model`    |     Yes     |    Yes     |                        `barwise validate`                         |
| `verbalize_model`   |     Yes     |    Yes     |                        `barwise verbalize`                        |
| `describe_domain`   |   **New**   |  **New**   |                    **New**: `barwise describe`                    |
| `export_model`      |   **New**   |  **New**   | Existing: `barwise export` + `barwise schema` + `barwise diagram` |
| `review_model`      |   **New**   |  **New**   |                     **New**: `barwise review`                     |
| `diff_models`       |     Yes     |    Yes     |                          `barwise diff`                           |
| `import_transcript` |     Yes     |    Yes     |                    `barwise import transcript`                    |
| `merge_models`      |     Yes     |    Yes     |           (not in CLI; manual editing + diff preferred)           |
| `import_model`      |  **Soon**   |  **Soon**  |                **Soon**: `barwise import <format>`                |
| `lineage_status`    |  **Soon**   |  **Soon**  |                **Soon**: `barwise lineage status`                 |

### VS Code commands (human-facing)

VS Code commands (the Command Palette actions) stay goal-oriented and
high-level. They compose the underlying tools:

| Command             | What it does                                                         |
| ------------------- | -------------------------------------------------------------------- |
| `orm.newProject`    | Scaffold new .orm.yaml (unchanged)                                   |
| `orm.validateModel` | Run validation, show diagnostics (unchanged)                         |
| `orm.verbalize`     | Generate readings, show in output (unchanged)                        |
| `orm.showDiagram`   | Generate SVG, show in webview (unchanged)                            |
| `orm.export`        | Quick pick: DDL, dbt, Avro, OpenAPI -> generate + save (add OpenAPI) |
| `orm.import`        | Quick pick: Transcript, dbt project -> extract + save (unchanged)    |

The commands are thin UI wrappers. The real capability lives in the
tools, which are available to both humans (via commands) and AI (via
Language Model Tools / MCP).

## Capability parity plan

Current asymmetries and how to resolve them:

| Capability                  | Today                 | Proposed                                                 |
| --------------------------- | --------------------- | -------------------------------------------------------- |
| OpenAPI export              | CLI only              | All surfaces via `export_model`                          |
| Avro export                 | VS Code command only  | All surfaces via `export_model`                          |
| dbt export                  | CLI + VS Code command | All surfaces via `export_model`                          |
| dbt project import          | VS Code only          | Defer (complex, interactive)                             |
| Batch transcript import     | CLI only              | Keep CLI-only (batch is a CLI concern)                   |
| Domain query/context        | Not available         | All surfaces via `describe_domain`                       |
| Diagram generation          | All surfaces          | Fold into `export_model(format: svg)`                    |
| Export lineage tracking     | Not available         | Manifest written on export, `lineage_status` tool        |
| Staleness detection         | Not available         | `barwise lineage status` / `lineage_status` tool         |
| Impact analysis (artifacts) | Not available         | `diff_models` + manifest lookup                          |
| DDL import                  | Not available         | `import_model(format: ddl)` -- Soon                      |
| OpenAPI import              | Not available         | `import_model(format: openapi)` -- Soon                  |
| dbt import                  | VS Code only          | All surfaces via `import_model` -- Now (expose existing) |
| NORMA XML import            | Core library only     | Defer (low demand)                                       |

## Implementation order

### Now

1. **`describe_domain`** -- Highest impact. Enables the "model as
   context" use case that no current tool addresses. Implement in
   core (the logic for filtering/summarizing model elements), expose
   via MCP tool, VS Code LM tool, and CLI command.

2. **`ExportFormat` interface and registry** -- Define the interface
   in core. Wrap existing renderers (`renderDdl`, `renderDbt`,
   `renderAvro`, `renderOpenApi`) as `ExportFormat` adapters.

3. **`export_model` tool** -- Closes the format gap. Dispatches to
   the `ExportFormat` registry by name. New MCP tool + VS Code LM
   tool. CLI already has `barwise export` covering most formats;
   align it with the registry.

4. **VS Code OpenAPI export command** -- Quick win, adds OpenAPI to
   the VS Code export picker.

5. **Expose dbt import on all surfaces** -- The logic already exists
   in core. Wire it into MCP (`import_model` tool) and CLI
   (`barwise import dbt`).

6. **Deprecate `generate_schema` and `generate_diagram`** -- Add
   deprecation notes to tool descriptions pointing to `export_model`.
   Keep them working indefinitely for backward compatibility.

### Soon

7. **Fix `sourceConstraintId` in `RelationalMapper`** -- Foreign
   keys are declared with a `sourceConstraintId` field but it is
   never populated. Fix this so FK traceability is complete. Small,
   isolated change.

8. **Add `lineage` to `ExportResult`** -- Each `ExportFormat`
   produces `LineageEntry[]` by walking the `RelationalSchema`
   traceability fields and/or the `OrmModel` directly. The data is
   already available during export; this surfaces it.

9. **Lineage manifest read/write** -- Utility in core to
   parse/serialize `.barwise/lineage.yaml`, merge new exports into
   existing manifest, compute model hash.

10. **CLI manifest persistence** -- `barwise export` writes the
    manifest alongside the exported files. `barwise lineage status`
    reads the manifest and reports stale artifacts.

11. **Integrate lineage with `describe_domain`** -- When given a
    file path instead of a model source, `describe_domain` checks
    the manifest to find which ORM elements produced that file and
    returns their context (context injection via lineage).

12. **Population extraction in LLM transcripts** -- Extend the
    extraction prompt to capture example data as population
    instances. Small prompt change, no new infrastructure.

13. **Population rendering in exports** -- Each `ExportFormat`
    renders population data in its native example mechanism when
    `includeExamples` is true. dbt: seed files. OpenAPI: `example`
    values. DDL: INSERT statements or comments.

14. **Include populations in `describe_domain`** -- When the model
    has populations for the focused entity/fact type, include
    concrete examples in the output.

15. **Include population validation in `validate_model`** -- The
    rules exist. Wire them into the standard validation run so
    population constraint violations appear in diagnostics.

16. **DDL import** -- Parse DDL (pg_dump, CREATE TABLE) and infer
    an ORM draft model. Inverse of `RelationalMapper`. Register as
    `ImportFormat`, wire into `import_model` tool.

17. **OpenAPI import** -- Parse OpenAPI 3.x spec and infer an ORM
    draft model. Schemas become entity types, $ref becomes fact
    types, required/enum become constraints.

### Later

18. **Chat participant (`@barwise`)** -- VS Code chat participant
    that intercepts domain questions and auto-injects model context.
    Builds on `describe_domain`.

19. **Semantic index / RAG** -- Vectorize verbalizations and
    definitions for automatic context retrieval. Requires embedding
    infrastructure.

20. **Avro import** -- Lower priority due to flat structure (no
    explicit relationships between schemas).

## v1.0 scope

v1.0 includes everything in **Now** (items 1-6) and **Soon** (items
7-17). This delivers the complete value proposition:

- Goal-oriented tools (`describe_domain`, `export_model`)
- Format parity across all surfaces (MCP, LM Tools, CLI)
- Import/export symmetry with DDL and OpenAPI import
- Lineage tracking with manifest, staleness detection, and
  context injection
- Population surfacing (LLM extraction, export rendering,
  validation integration)
- `review_model` for LLM-powered semantic suggestions
- Enhanced `merge_models` with preview mode

**Later** items (18-20: chat participant, semantic index/RAG, Avro
import) are post-v1.0 enhancements.

### v1.0 delivery stages

The 17 items group into four stages that can be delivered and
validated incrementally:

**Stage A: Core tool surface** (items 1-6)

- `describe_domain` tool on all surfaces
- `ExportFormat` interface, registry, and `export_model` tool
- dbt import exposed on all surfaces
- Deprecation notices on old tools
- **Validation**: All existing tests pass. New tools produce correct
  output for the clinic and university example models.

**Stage B: Lineage** (items 7-11)

- Fix `sourceConstraintId` in RelationalMapper
- `lineage` field on ExportResult
- Manifest read/write, CLI persistence
- `describe_domain` lineage integration
- **Validation**: Export produces manifest. `barwise lineage status`
  correctly reports staleness after model changes.

**Stage C: Populations and review** (items 12-15)

- Population extraction in LLM transcripts
- Population rendering in exports
- Populations in `describe_domain` and `validate_model`
- `review_model` tool
- **Validation**: Transcript extraction captures example data.
  Exports include population examples. Population violations
  appear in validation diagnostics.

**Stage D: Import formats** (items 16-17)

- DDL import (parse + optional LLM enrich)
- OpenAPI import (parse + optional LLM enrich)
- **Validation**: Round-trip test: export to DDL, import back,
  compare models. Same for OpenAPI.

## Out of scope

- **SQL DDL reverse-engineering**: Moved to "Soon" in implementation
  order (see UC-7). No longer out of scope.
- **Chat participant (`@barwise`)**: A VS Code chat participant that
  automatically includes model context is valuable but orthogonal to
  the tool surface. Can be built on top of `describe_domain` later.
- **Incremental model updates**: Applying targeted changes to a model
  (add entity, rename field) without full merge. The AI can edit YAML
  directly for now.
- **Interactive merge in MCP/CLI**: The interactive delta review flow
  is inherently a UI concern. Keep it in VS Code.
- **Real-time diagram updates**: Live-updating diagram as the model
  changes. Interesting but separate from tool surface design.

## Design decisions

1. **`describe_domain` output adapts by transport.** The tool always
   returns the same structured data for a given `focus` query. The
   surface determines presentation:
   - **CLI** (`barwise describe`): Defaults to a summary view.
     `--verbose` shows full detail. Human-readable formatting.
   - **MCP**: Returns full structured output. The consuming agent
     processes what it needs.
   - **VS Code Language Model Tool**: Returns full structured output.
     Copilot incorporates it into its context window.

   The tool itself has no `mode` or `depth` parameter. The `focus`
   parameter controls what slice of the model is returned (entity,
   fact type, constraint type, or full summary). The surface controls
   how much of that slice is displayed.

2. **`export_model` exports with a warning by default.** Validation
   runs before export and any errors are included in the response
   alongside the exported artifact. This is configurable: a
   `strict` option (default: false) causes export to fail on
   validation errors. Some projects may prefer to reject exports
   with errors in CI or review workflows.

3. **Import tool naming requires holistic thinking.** With
   `import_model` now handling structured format imports (DDL,
   OpenAPI, dbt) and `import_transcript` handling LLM-powered
   extraction, the naming needs to work as a coherent family.
   Current candidates:
   - `import_model(format: "dbt" | "ddl" | "openapi")` for
     structured format import
   - `import_transcript` (or `extract_model`) for LLM extraction
   - Unified under `import_model` with a `format` parameter that
     includes `"transcript"` as a format type

   The right answer depends on whether LLM extraction is
   conceptually "another import format" or a fundamentally different
   operation. Defer the naming decision until the `ImportFormat`
   interface is implemented and the ergonomics become concrete.

## Testing strategy

The project has 1,183 passing tests and targets 90-95% coverage.
New functionality must maintain this standard.

### Per-stage testing

**Stage A: Core tool surface**

- **`ExportFormat` adapters**: Each adapter gets a test that builds
  a known model (via `ModelBuilder`), calls `export()`, and verifies
  the output matches expected content. Tests cover: correct structure,
  annotation injection, constraint expression, and `includeExamples`
  behavior. One test per format.
- **`ExportFormat` registry**: Test that all registered formats are
  discoverable by name. Test that unknown format names produce a
  clear error.
- **`describe_domain`**: Test focused queries return correct model
  slices. Test entity focus, fact type focus, constraint focus, and
  no-focus summary. Test that populations are included when present.
- **`export_model` tool handler**: Integration test that dispatches
  to the registry and returns correct `ExportResult` structure.
- **`review_model` tool handler**: Test with a model that has known
  gaps (missing definitions, unconstrained fact types). Verify the
  LLM is called and the output has the expected suggestion structure.
  Mock the LLM client for deterministic tests.

**Stage B: Lineage**

- **`sourceConstraintId` fix**: Add test in RelationalMapper tests
  verifying FK traceability fields are populated.
- **Lineage in ExportResult**: Verify each ExportFormat produces
  `lineage` entries with correct element IDs and types.
- **Manifest read/write**: Round-trip test (write manifest, read it
  back, compare). Test merge behavior (new export updates existing
  entries for same artifact path).
- **Staleness detection**: Test with a model, export (writes
  manifest), modify model, verify `lineage status` reports correct
  stale artifacts.
- **describe_domain + lineage**: Test that passing a file path
  (instead of model source) resolves through the manifest to the
  correct ORM elements.

**Stage C: Populations**

- **LLM population extraction**: Test with a transcript containing
  explicit examples. Verify the extracted model has population
  instances. Mock the LLM client.
- **Population rendering in exports**: Test each format with a model
  that has populations. Verify examples appear in the output (INSERT
  statements, seed files, OpenAPI examples, etc.).
- **Population validation integration**: Test that `validate_model`
  includes population constraint violations when the model has
  populations with violations.

**Stage D: Import formats**

- **Round-trip tests**: Export model to DDL, import it back, compare
  the resulting model against the original. Same for OpenAPI. The
  imported model won't be identical (import loses semantics), but
  structural equivalence (same tables, columns, keys) should hold.
- **Parse-only tests**: Test deterministic parsing of known DDL and
  OpenAPI inputs. Verify entity types, fact types, and constraints
  are correctly inferred.
- **Enrich tests**: Test that LLM enrichment improves the draft
  model (adds definitions, resolves naming). Mock the LLM client.

### Testing principles

- **Use `ModelBuilder`** for all test fixtures. No hand-constructing
  model objects.
- **Mock LLM clients** for deterministic tests. LLM-dependent tools
  get separate integration tests that can run with a real provider.
- **Test behavior, not implementation.** ExportFormat tests verify
  output content, not which internal functions were called.
- **Existing tests must not break.** Every stage's first validation
  criterion is "all existing tests pass."

## Multi-model project support

The spec focuses on single `.orm.yaml` models. The metamodel also
supports `OrmProject` -- a multi-domain project with multiple models
and cross-references between them.

For v1.0, all tools operate on a single model (the `source`
parameter points to one `.orm.yaml` file). Multi-model behavior:

- **`describe_domain`**: When given an `.orm-project.yaml`, query
  across all models in the project. The `focus` parameter can
  specify a domain prefix to narrow the scope.
- **`export_model`**: Operates on a single model within a project.
  The user specifies which model via the `source` parameter.
- **Lineage manifest**: The `sourceModel` field records the specific
  model path. A project with three models produces three manifests
  (one per model) or one manifest with entries tagged by model path.
- **`review_model`**: Can review a single model or a full project.
  Cross-model suggestions (e.g., "these two models have overlapping
  entity types") are a post-v1.0 enhancement.

This is sufficient for v1.0. Full multi-model support (cross-model
lineage, project-wide export, cross-domain impact analysis) warrants
its own spec.

## Breaking changes

All changes in this spec are **additive**. No existing public API is
removed or changed in a backward-incompatible way.

| Change                                              | Type       | Impact                                                                                | Migration                                                                                                 |
| --------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `ExportFormat` interface                            | New        | None -- new type                                                                      | N/A                                                                                                       |
| `ExportResult` type                                 | New        | None -- new type                                                                      | N/A                                                                                                       |
| `ImportFormat` interface                            | New        | None -- new type                                                                      | N/A                                                                                                       |
| `LineageEntry`, `SourceReference`                   | New        | None -- new types                                                                     | N/A                                                                                                       |
| `describe_domain` tool                              | New        | None -- new tool                                                                      | N/A                                                                                                       |
| `export_model` tool                                 | New        | None -- new tool                                                                      | N/A                                                                                                       |
| `review_model` tool                                 | New        | None -- new tool                                                                      | N/A                                                                                                       |
| `import_model` tool                                 | New        | None -- new tool                                                                      | N/A                                                                                                       |
| `lineage_status` tool                               | New        | None -- new tool                                                                      | N/A                                                                                                       |
| `merge_models` preview param                        | Additive   | None -- new optional param, default preserves current behavior                        | N/A                                                                                                       |
| `generate_schema` deprecation                       | Soft       | Tool keeps working. Description updated to point to `export_model`.                   | Update tool calls at leisure                                                                              |
| `generate_diagram` deprecation                      | Soft       | Tool keeps working. Description updated to point to `export_model`.                   | Update tool calls at leisure                                                                              |
| Population validation in `validate_model`           | Behavioral | Models with populations may now show new diagnostics                                  | Population diagnostics use a distinct category (`population-violation`) so consumers can filter if needed |
| `sourceConstraintId` population in RelationalMapper | Behavioral | ForeignKey objects may now have `sourceConstraintId` set where they previously didn't | No consumer should break -- the field was always declared optional                                        |
| `ExportOptions.includeExamples`                     | Additive   | New optional field, defaults to `true`                                                | Consumers that don't want examples pass `includeExamples: false`                                          |
| `ExportOptions.strict`                              | Additive   | New optional field, defaults to `false`                                               | No change in default behavior                                                                             |

The only behavioral changes that could surprise existing consumers
are population validation diagnostics and `sourceConstraintId`
population. Both are low risk: population diagnostics use a new
category that existing consumers won't match on, and
`sourceConstraintId` was always declared but never populated.
