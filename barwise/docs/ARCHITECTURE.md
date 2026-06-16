# Architecture: ORM Modeler for VS Code

**Status:** Draft
**Last Updated:** February 2026

---

## 1. Project Overview

This project is a VS Code extension for Object-Role Modeling (ORM 2) that enables data engineers and architects to capture, validate, and manage conceptual data models using fact-oriented modeling principles.

The extension supports a workflow where business domain knowledge -- captured in working session transcripts -- is processed by an LLM to derive an initial set of object types, fact types, and ubiquitous language definitions. These derived artifacts are imported into an ORM project where they can be refined, constrained, validated, and eventually mapped to logical schemas.

### 1.1 Design Goals

- **Accessible to data engineers.** The primary users are people who work in SQL, Python, and dbt daily, not UML specialists. The tooling should meet them where they are.
- **Semantics first.** The core representation is the ORM conceptual model. Physical modeling decisions (star schema, Data Vault, normalized) are downstream concerns, not embedded in the tool.
- **Testable at every layer.** The architecture separates pure domain logic from VS Code platform concerns, making the core model and validation logic testable without launching an editor.
- **Informed by NORMA.** We draw on the NORMA implementation for the ORM 2 metamodel structure, FORML verbalization patterns, OIAL abstraction layer, and Rmap relational mapping algorithms. We do not attempt to port the NORMA codebase.
- **LLM-assisted, human-governed.** LLM processing produces draft artifacts that are always subject to human review and refinement. The LLM is a accelerant for the initial capture phase, not an autonomous modeler.

### 1.2 Non-Goals (Current Scope)

- Full ORM 2 graphical notation compliance. We prioritize readability and utility over strict adherence to every notational convention.
- Real-time collaborative editing. Single-user editing is the initial target.
- NORMA ecosystem compatibility. We do not need to import or export NORMA XML files. The NORMA codebase is a reference for domain knowledge, not an integration target.
- Direct database deployment. We generate schema definitions; deployment is handled by existing tools (dbt, Terraform, etc.).

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        VS Code Extension Host                       │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────────┐ │
│  │   Language    │  │   Diagram    │  │      Command Palette      │ │
│  │   Server     │  │   Webview    │  │      & UI Integration     │ │
│  │   (LSP)      │  │   Panel      │  │                           │ │
│  └──────┬───────┘  └──────┬───────┘  └─────────────┬─────────────┘ │
│         │                 │                         │               │
│  ┌──────┴─────────────────┴─────────────────────────┴─────────────┐ │
│  │                   Extension Controller                         │ │
│  │            (VS Code API integration layer)                     │ │
│  └────────────────────────────┬───────────────────────────────────┘ │
└───────────────────────────────┼─────────────────────────────────────┘
                                │
          ┌─────────────────────┼─────────────────────┐
          │          Platform-Independent Core         │
          │                                            │
          │  ┌────────────────────────────────────┐    │
          │  │          ORM Metamodel              │    │
          │  │  (Object Types, Fact Types,         │    │
          │  │   Constraints, Populations)         │    │
          │  └──────────────┬─────────────────────┘    │
          │                 │                           │
          │  ┌──────────────┴─────────────────────┐    │
          │  │        Model Services               │    │
          │  │                                     │    │
          │  │  ┌─────────────┐ ┌───────────────┐  │    │
          │  │  │ Validation  │ │ Verbalization │  │    │
          │  │  │ Engine      │ │ Engine        │  │    │
          │  │  └─────────────┘ └───────────────┘  │    │
          │  │  ┌─────────────┐ ┌───────────────┐  │    │
          │  │  │ OIAL        │ │ Relational    │  │    │
          │  │  │ Mapper      │ │ Mapper (Rmap) │  │    │
          │  │  └─────────────┘ └───────────────┘  │    │
          │  └────────────────────────────────────┘    │
          │                                            │
          │  ┌────────────────────────────────────┐    │
          │  │        Import / Export               │    │
          │  │                                     │    │
          │  │  ┌─────────────┐ ┌───────────────┐  │    │
          │  │  │ Transcript  │ │ Serialization │  │    │
          │  │  │ Processor   │ │ (.orm.yaml)   │  │    │
          │  │  │ (LLM)       │ │               │  │    │
          │  │  └─────────────┘ └───────────────┘  │    │
          │  │  ┌─────────────┐ ┌───────────────┐  │    │
          │  │  │ NORMA       │ │ Schema        │  │    │
          │  │  │ XML Import  │ │ Export (DDL)  │  │    │
          │  │  └─────────────┘ └───────────────┘  │    │
          │  └────────────────────────────────────┘    │
          │                                            │
          └────────────────────────────────────────────┘
```

The architecture enforces a strict boundary between the **platform-independent core** (which contains all ORM domain logic, validation, mapping, and serialization) and the **VS Code extension host** (which handles editor integration, UI rendering, and user interaction). This boundary is the most important structural decision in the project: the core must have zero dependencies on the `vscode` module.

---

## 3. Platform-Independent Core

The core is a standalone TypeScript library with no VS Code dependencies. It can be consumed by the extension, by a CLI tool, by a CI pipeline, or by tests -- all without launching an editor.

### 3.1 ORM Metamodel

The metamodel is the central data structure. It represents the conceptual ORM model and is the single source of truth for all downstream operations (validation, verbalization, mapping, serialization).

#### 3.1.1 Primary Entities

| Entity                | Description                                                                                                                                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ObjectType`          | A concept in the domain. May be an **entity type** (identified by a reference scheme) or a **value type** (self-identifying, e.g., a string or number).                                                   |
| `FactType`            | A relationship between object types, expressed as a set of ordered roles. Binary fact types are the most common, but unary, ternary, and higher-arity fact types are supported.                           |
| `Role`                | A position within a fact type, played by an object type. Each role carries a role name used in verbalization.                                                                                             |
| `SubtypeFact`         | A specialization relationship: entity type A is a subtype of entity type B.                                                                                                                               |
| `ObjectifiedFactType` | A fact type that is simultaneously treated as an entity type (nesting).                                                                                                                                   |
| `ReadingOrder`        | An ordered sequence of roles with interstitial text, producing a natural-language reading of the fact type. Each fact type has at least one reading order (forward); many have two (forward and inverse). |
| `Constraint`          | A restriction on the population of one or more fact types. See constraint taxonomy below.                                                                                                                 |
| `Population`          | A set of sample fact instances used for validation with domain experts.                                                                                                                                   |
| `Definition`          | A natural-language definition of an object type or fact type, forming part of the ubiquitous language.                                                                                                    |
| `DomainContext`       | Metadata tracking the bounded context from which an object type or fact type originates. Used to document cross-context mappings.                                                                         |

#### 3.1.2 Constraint Taxonomy

Constraints are the formal encoding of business rules. The following constraint types are supported, ordered by implementation priority.

**Phase 1 (Core):**

| Constraint           | Applies To                                  | Meaning                                                                   |
| -------------------- | ------------------------------------------- | ------------------------------------------------------------------------- |
| `InternalUniqueness` | One or more roles within a single fact type | The combination of values in these roles is unique across the population. |
| `MandatoryRole`      | A single role                               | Every instance of the object type playing this role must participate.     |
| `ExternalUniqueness` | Roles spanning multiple fact types          | Uniqueness across a combination of roles from different fact types.       |
| `ValueConstraint`    | A value type or role                        | Restricts the allowed values (enumeration or range).                      |

**Phase 2 (Extended):**

| Constraint             | Applies To                                                           | Meaning                                                                                    |
| ---------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `DisjunctiveMandatory` | Two or more roles                                                    | Each instance of the common object type must play at least one of the specified roles.     |
| `Exclusion`            | Two or more roles                                                    | No instance may play both roles simultaneously.                                            |
| `ExclusiveOr`          | Two or more roles                                                    | Combines disjunctive mandatory and exclusion: exactly one of the roles must be played.     |
| `Subset`               | Pair of role sequences                                               | The population of one role sequence must be a subset of the other.                         |
| `Equality`             | Pair of role sequences                                               | The populations of both role sequences must be identical.                                  |
| `Ring`                 | A pair of roles in a single fact type played by the same object type | Constrains reflexive relationships (irreflexive, asymmetric, intransitive, acyclic, etc.). |
| `Frequency`            | A role                                                               | Restricts how many times an object may play this role (min..max).                          |

#### 3.1.3 Model Identity and References

Every model element has a stable, opaque identifier (UUID) assigned at creation. References between elements use these identifiers. This enables:

- Renaming without breaking references.
- Diffing and merging of model files.
- Traceability from downstream artifacts (dbt tests, DDL) back to the source model element.

#### 3.1.4 Multi-File Models and Cross-Domain References

Large projects span multiple bounded contexts, each modeled in its own `.orm.yaml` file. A project manifest (`.orm-project.yaml`) declares the set of domain models and the context mappings between them.

**Cross-domain references** use a namespace-qualified syntax: `crm:Customer` refers to the `Customer` object type defined in the domain whose context name is `crm`. This ensures that `crm:Customer` and `billing:Customer` are unambiguous even when both domains define an object type with the same name.

The metamodel supports this through the following additions:

| Entity             | Description                                                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `OrmProject`       | Root aggregate for a multi-domain project. Holds references to domain models and context mappings.                                     |
| `DomainModel`      | A single bounded context's ORM model, loaded from one `.orm.yaml` file. Each has a unique context name.                                |
| `ContextMapping`   | A relationship between two domain models, loaded from a `.map.yaml` file. Documents how concepts translate across context boundaries.  |
| `EntityMapping`    | A specific correspondence between an object type in one domain and an object type in another, within a context mapping.                |
| `SemanticConflict` | An explicit documentation of where two domains use the same term with different meanings, and how the warehouse resolves the conflict. |

The `ContextMapping` carries a `pattern` field corresponding to the DDD context mapping patterns:

- `shared_kernel` -- both domains genuinely share the same definition.
- `published_language` -- a conformed definition that multiple domains agree to.
- `anticorruption_layer` -- a translation boundary with explicit transformation rules.

Cross-domain validation rules include: every namespace-qualified reference resolves to an actual object type in the referenced domain; entity mappings reference valid object types on both sides; and the analytical model's object types can be traced to source domains through mappings.

#### 3.1.5 Data Products as Compositional Models

Data products are analytical solutions built on top of the common domain data layer. Structurally, they are similar to context mappings: they are compositional artifacts that reference and combine concepts from multiple domain models without owning those models.

A data product is represented as an `.orm.yaml` domain model with two distinguishing characteristics:

1. **It declares dependencies on source domains and mappings.** This makes its upstream lineage explicit and enables the tooling to validate that all referenced domain concepts actually exist.
2. **It introduces analytical-only concepts** -- metrics, KPIs, derived classifications, grain definitions, and cohort definitions -- that have no operational system counterpart. These are first-class model elements that receive the same verbalization and validation treatment as any other fact type.

The project manifest lists data products alongside domains and mappings:

```yaml
project:
  name: "Data Warehouse Semantic Model"

  domains:
    - path: "./domains/crm.orm.yaml"
      context: "crm"
    - path: "./domains/billing.orm.yaml"
      context: "billing"

  mappings:
    - path: "./mappings/crm-billing.map.yaml"

  products:
    - path: "./products/customer-lifetime-value.orm.yaml"
      context: "clv"
      depends_on:
        domains: ["crm", "billing"]
        mappings: ["crm-billing"]
```

Within the data product's `.orm.yaml` file, analytical-only concepts are modeled using standard ORM constructs. A metric like "Lifetime Revenue" is captured as a derived fact type with a definition that traces to its source fact types. A grain definition like "one row per customer per calendar month" is captured as a documented constraint on the product's primary fact types. Cross-domain references use the same `context:ObjectType` namespace syntax.

This approach avoids introducing a new file format for data products. They are domain models with declared dependencies, which keeps the metamodel simple while supporting the compositional pattern.

```
packages/core/src/model/
  OrmProject.ts          // multi-domain project root; holds domains, mappings, and products
  DomainModel.ts         // single bounded context model (used for both source domains and data products)
  ContextMapping.ts      // cross-domain mapping
  EntityMapping.ts       // specific entity correspondence
  SemanticConflict.ts    // documented term conflicts
  ProductDependency.ts   // dependency declaration for data products
```

#### 3.1.6 Metamodel Implementation

The metamodel is implemented as a set of TypeScript interfaces and classes in `packages/core/src/model/`. The model is mutable during editing but can produce immutable snapshots for validation and mapping operations.

```
packages/core/src/model/
  ObjectType.ts
  FactType.ts
  Role.ts
  Constraint.ts
  ReadingOrder.ts
  Population.ts
  Definition.ts
  DomainContext.ts
  OrmModel.ts          // root aggregate; holds all elements and provides query methods
  ModelElement.ts       // base class with id, name, and metadata
```

### 3.2 Validation Engine

The validation engine applies ORM well-formedness rules and constraint consistency checks to the model. It produces a list of diagnostics (errors, warnings, informational messages) that can be surfaced in the VS Code Problems panel or consumed by tests.

Validation is organized into **rule sets**, each of which is a pure function: `(model: OrmModel) => Diagnostic[]`. Rule sets include:

- **Structural rules.** Every fact type has at least one reading order. Every role references an existing object type. Entity types have a reference scheme. No duplicate names within a namespace.
- **Constraint consistency.** Uniqueness constraints reference roles that exist in the specified fact type. Mandatory constraints are not applied to roles whose object type has a matching disjunctive mandatory. Subset and equality constraints reference role sequences of compatible arity and type.
- **Population validation.** Sample populations satisfy all declared constraints. This is the runtime equivalent of "do the examples actually work?"
- **Completeness warnings.** Object types without definitions. Fact types without constraints (which usually indicates the modeler hasn't finished specifying business rules). Entity types referenced by name but not yet created.

Validation is incremental where practical: when a single element changes, only the rule sets relevant to that element and its dependents are re-evaluated. The dependency graph for incremental validation is maintained by the `OrmModel` root aggregate.

```
packages/core/src/validation/
  Diagnostic.ts          // { severity, message, elementId, ruleId }
  ValidationRule.ts      // (model: OrmModel) => Diagnostic[]
  rules/
    structural.ts
    constraintConsistency.ts
    populationValidation.ts  // orchestrator over the population/ families
    population/              // one module per constraint family
    completenessWarnings.ts
  ValidationEngine.ts    // orchestrates rule sets, manages incremental state
```

### 3.3 Verbalization Engine

The verbalization engine generates natural-language readings of fact types, constraints, and entire models. This is the primary mechanism for producing documentation that business stakeholders can review.

Verbalizations follow the FORML (Formal ORM Language) patterns established by Halpin. Examples:

- **Fact type:** "Customer places Order"
- **Internal uniqueness (single-role):** "Each Order is placed by at most one Customer."
- **Mandatory role:** "Each Customer places at least one Order."
- **Value constraint:** "The possible values of Rating are: {'A', 'B', 'C', 'D', 'F'}."

The verbalization engine operates on the model and produces structured output (not just raw strings) so that verbalizations can be rendered with formatting, hyperlinks between elements, and contextual annotations.

```
packages/core/src/verbalization/
  Verbalizer.ts               // main entry point
  FactTypeVerbalizer.ts
  ConstraintVerbalizer.ts
  templates/                  // FORML sentence templates
```

### 3.4 OIAL Mapper

The OIAL (Object-oriented Information Analysis Layer) is an intermediate abstraction between the conceptual ORM model and a logical schema. It resolves ORM-specific constructs (objectification, subtyping, multi-role uniqueness) into a simplified object graph that can be mapped to various physical targets.

The OIAL mapper is a later-phase component. Initial implementation will focus on a direct conceptual-to-relational mapping for common patterns, with OIAL introduced when the model complexity demands it.

```
packages/core/src/mapping/
  OialMapper.ts
  OialModel.ts        // intermediate representation
```

### 3.5 Relational Mapper (Rmap)

The relational mapper transforms the conceptual model (or OIAL output) into a relational schema. It implements the standard ORM-to-relational mapping algorithms:

- Binary fact types with single-role uniqueness map to foreign keys on the table representing the uniqueness side.
- Binary fact types with spanning uniqueness (both roles unique) map to either a foreign key or a separate table, depending on mandatory constraints.
- Ternary and higher fact types map to associative tables.
- Subtyping maps to one of the standard strategies (absorption into supertype, separate tables, or partition) based on constraint patterns.

The output is a logical relational schema (tables, columns, keys, foreign keys) that can be rendered as DDL, dbt model skeletons, or other physical targets.

```
packages/core/src/mapping/
  RelationalMapper.ts
  RelationalSchema.ts    // tables, columns, keys, foreign keys
  renderers/
    ddl.ts               // SQL DDL output
```

---

## 4. Import / Export

### 4.1 Serialization Format

ORM projects are stored as `.orm.yaml` files. YAML is chosen over XML or JSON for the following reasons:

- Readable and editable by humans in a text editor.
- Diffable in version control (meaningful line-by-line diffs).
- Familiar to data engineers who work with dbt and Airflow configurations daily.
- Comments are supported natively, allowing inline documentation.

#### 4.1.1 JSON Schema as a First-Class Artifact

The `.orm.yaml` file format is formally defined by a JSON Schema that serves multiple purposes:

- **File validation.** Every `.orm.yaml` file is validated against the schema on load. Structural errors are caught before the model logic runs.
- **Editor intelligence.** The YAML file includes a `$schema` reference, enabling native validation and autocomplete in any editor that supports the YAML Language Server (including VS Code with the Red Hat YAML extension), even without our extension installed.
- **LLM output constraint.** The same schema (or a targeted subset) is provided to the LLM as a structured output specification during transcript extraction. This constrains the LLM response to produce valid model structures.
- **Contract for multi-file references.** The schema defines the valid shapes for cross-domain references, mapping files, and project manifests.

The schema is maintained as a `.json` file in the repository and is published as part of the extension. It is the authoritative definition of the file format.

```
packages/core/schemas/
  orm-model.schema.json          # schema for .orm.yaml domain model files
  orm-mapping.schema.json        # schema for .map.yaml context mapping files
  orm-project.schema.json        # schema for project manifest files
```

#### 4.1.2 Schema Versioning and Migration

The schema is versioned. Every file begins with a schema version declaration. When the schema evolves (new fields, restructured elements), the serialization layer includes forward migration functions that automatically upgrade older files on load. This prevents "my model stopped working after an extension update" situations.

Migration is applied transparently: the file is read, its version is detected, any necessary migrations are applied in sequence, and the model is constructed from the migrated representation. The original file on disk is not rewritten unless the user explicitly saves.

```
packages/core/src/serialization/
  OrmYamlSerializer.ts       // read/write .orm.yaml files
  SchemaValidator.ts          // validates against JSON Schema using ajv
  migration/
    MigrationRunner.ts        // applies migrations in version order
    v1_0.ts                   // initial version (identity)
    v1_1.ts                   // example: future migration from 1.0 to 1.1
```

#### 4.1.3 File Format Examples

**Domain model file (.orm.yaml):**

```yaml
# yaml-language-server: $schema=https://orm-modeler.dev/schemas/v1/orm-model.schema.json
orm_version: "1.0"

model:
  name: "Order Management"
  domain_context: "ecommerce"

  object_types:
    - id: "ot-001"
      name: "Customer"
      kind: "entity"
      reference_mode: "customer_id"
      definition: "A person or organization that has placed at least one order."
      source_context: "crm"

    - id: "ot-002"
      name: "Order"
      kind: "entity"
      reference_mode: "order_number"
      definition: "A confirmed request by a customer for one or more products."

    - id: "ot-003"
      name: "Rating"
      kind: "value"
      value_constraint:
        values: ["A", "B", "C", "D", "F"]

  fact_types:
    - id: "ft-001"
      name: "Customer places Order"
      roles:
        - id: "r-001"
          player: "ot-001"
          role_name: "places"
        - id: "r-002"
          player: "ot-002"
          role_name: "is placed by"
      readings:
        - "{0} places {1}"
        - "{1} is placed by {0}"
      constraints:
        - type: "internal_uniqueness"
          roles: ["r-002"]      # each Order is placed by at most one Customer
        - type: "mandatory"
          role: "r-002"         # every Order is placed by some Customer

  definitions:
    # Ubiquitous language entries not directly attached to a model element
    - term: "Backorder"
      definition: "An order that cannot be fulfilled from current inventory."
      context: "fulfillment"
```

**Context mapping file (.map.yaml):**

```yaml
# yaml-language-server: $schema=https://orm-modeler.dev/schemas/v1/orm-mapping.schema.json
orm_version: "1.0"

mapping:
  name: "CRM to Billing alignment"
  source_domain: "./domains/crm.orm.yaml"
  target_domain: "./domains/billing.orm.yaml"
  pattern: "anticorruption_layer"   # or: shared_kernel, published_language

  entity_mappings:
    - source: "crm:Customer"         # namespace:ObjectType
      target: "billing:Account"
      relationship: "equivalent"     # or: subset, superset, overlapping
      notes: >
        CRM Customer maps to Billing Account for active customers only.
        CRM includes leads and prospects that have no billing representation.
      translation_rules:
        - field: "customer_id"
          maps_to: "account_id"
          transform: "direct"
        - field: "status"
          maps_to: "account_status"
          transform: "value_map"
          value_map:
            "active": "active"
            "churned": "cancelled"
            # leads and prospects have no billing equivalent

  semantic_conflicts:
    - term: "Customer"
      crm_definition: "Any person or org the sales team is tracking, including leads."
      billing_definition: "An entity with an active or historical payment relationship."
      warehouse_resolution: >
        In the analytical model, Customer refers to the billing definition.
        CRM-only leads are modeled separately as Prospect.
```

**Project manifest (.orm-project.yaml):**

```yaml
# yaml-language-server: $schema=https://orm-modeler.dev/schemas/v1/orm-project.schema.json
orm_version: "1.0"

project:
  name: "Data Warehouse Semantic Model"

  domains:
    - path: "./domains/crm.orm.yaml"
      context: "crm"
    - path: "./domains/billing.orm.yaml"
      context: "billing"
    - path: "./domains/fulfillment.orm.yaml"
      context: "fulfillment"

  mappings:
    - path: "./mappings/crm-billing.map.yaml"
    - path: "./mappings/crm-fulfillment.map.yaml"

  products:
    - path: "./products/customer-lifetime-value.orm.yaml"
      context: "clv"
      depends_on:
        domains: ["crm", "billing"]
        mappings: ["crm-billing"]
```

### 4.2 Transcript Processor (LLM Integration)

The transcript processor takes a plain text or markdown transcript of a business working session and produces a draft ORM model. This is the primary acceleration mechanism for initial model capture.

#### 4.2.1 Processing Pipeline

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Raw          │     │  Structured  │     │  Draft       │     │  Validated   │
│  Transcript   │────▶│  Extraction  │────▶│  ORM Model   │────▶│  Import      │
│  (.md/.txt)   │     │  (LLM)       │     │  (JSON)      │     │  (.orm.yaml) │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
                           │
                     Uses structured
                     output schema
                     to constrain
                     LLM response
```

**Step 1: Structured Extraction.** The transcript is sent to an LLM with a carefully designed system prompt that instructs the model to extract:

- Candidate entity types and value types, with proposed definitions.
- Candidate fact types, expressed as verbalized sentences.
- Candidate constraints, inferred from statements like "every X must have a Y" or "no X can be both A and B." The LLM should infer likely constraints from conversational context, not just explicitly stated rules.
- Ubiquitous language terms, especially where the transcript reveals that stakeholders use specific terminology.
- Ambiguities and open questions, where the transcript contains contradictions or unclear phrasing.

**Every extracted element must include source references** -- line number ranges or quoted excerpts from the transcript that justify the extraction. This provides:

- An audit trail from model element back to the stakeholder's actual words.
- A basis for the modeler to evaluate whether the LLM's inference is reasonable.
- Documentation of "why we modeled it this way" that traces to the source conversation.

The LLM is instructed to return its output conforming to a JSON schema that matches the draft model structure. This constrains the output and makes parsing reliable. The structured output schema is derived from the same JSON Schema that defines the `.orm.yaml` file format, extended with `source_references` fields.

```json
{
  "object_types": [
    {
      "name": "Customer",
      "kind": "entity",
      "definition": "A person or organization that has placed at least one order.",
      "source_references": [
        {
          "lines": [42, 45],
          "excerpt": "when we say customer, we mean someone who has actually bought something"
        }
      ]
    }
  ],
  "fact_types": [...],
  "inferred_constraints": [
    {
      "type": "mandatory",
      "description": "Every Order must be placed by a Customer",
      "confidence": "high",
      "source_references": [
        {
          "lines": [87, 89],
          "excerpt": "an order always belongs to a customer, there's no such thing as an anonymous order"
        }
      ]
    }
  ],
  "ambiguities": [
    {
      "description": "Stakeholders used 'client' and 'customer' interchangeably -- are these the same concept?",
      "source_references": [
        { "lines": [42, 45], "excerpt": "...customer..." },
        { "lines": [112, 114], "excerpt": "...the client's account..." }
      ]
    }
  ]
}
```

**Step 2: Draft Model Construction.** The JSON output is parsed into an in-memory ORM model. At this stage, the model is expected to have gaps and errors -- it is a draft, not a finished product.

**Step 3: Validated Import.** The draft model is validated against the ORM metamodel rules. Validation failures are surfaced as import warnings (not blocking errors), allowing the user to see what the LLM produced and fix issues manually.

#### 4.2.2 LLM Integration Boundary

The LLM integration is deliberately kept at the boundary of the system. The core ORM model, validation engine, and mapping logic have no awareness of LLMs. The transcript processor is an import adapter, structurally identical to any other import mechanism (NORMA XML import, manual file creation, etc.).

This design means:

- The LLM provider can be swapped without affecting the core.
- The prompt engineering can evolve independently of the metamodel.
- Tests for the core model logic do not require LLM calls.
- The LLM output is validated by the same rules as any other model input.

The transcript processor lives in a separate package:

```
packages/llm/src/
  TranscriptProcessor.ts        // orchestrates the pipeline
  ExtractionPrompt.ts           // system prompt construction
  DraftModelParser.ts           // JSON response -> OrmModel
  LlmClient.ts                  // abstract interface for LLM calls
  providers/
    anthropic.ts                // Claude implementation
    openai.ts                   // OpenAI implementation (future)
```

#### 4.2.3 LLM Provider Configuration

The extension does not bundle an LLM provider. The user configures their provider and API key in VS Code settings. The `LlmClient` interface is minimal:

```typescript
interface LlmClient {
  complete(request: CompletionRequest): Promise<CompletionResponse>;
}

interface CompletionRequest {
  systemPrompt: string;
  userMessage: string;
  responseSchema?: JsonSchema; // for structured output
}
```

### 4.3 NORMA XML Import (Low Priority)

For teams with existing NORMA models, an import adapter could read NORMA's `.orm` XML format and produce an internal `OrmModel`. This is not on the critical path and would only be built if a concrete need arises. The NORMA XML schema is complex, and the effort to support it is not justified by current requirements.

If needed in the future:

```
packages/core/src/import/
  NormaXmlImporter.ts
  NormaXmlParser.ts       // low-level XML parsing
  NormaToOrmMapper.ts     // maps NORMA elements to our metamodel
```

### 4.4 Integration Surface Area

The core package exposes a programmatic API (the `OrmModel`, `OrmProject`, `RelationalSchema`, and verbalization output) that downstream integration projects can consume. The core itself does not implement any specific export format beyond its own `.orm.yaml` serialization.

The following integrations are anticipated. Each would be a separate project/package with its own repository, release cadence, and dependencies.

| Integration           | Consumes                                                                 | Produces                                                                                                         | Notes                                                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **dbt export**        | `OrmProject`, `RelationalSchema`, constraint model, verbalization output | Staging/integration/mart model skeletons, YAML configs with descriptions, dbt tests derived from ORM constraints | Primary integration target. Constraint-to-test mapping (uniqueness to `unique`, mandatory to `not_null`, value constraint to `accepted_values`, subset to `relationships`) is the highest-value feature. |
| **NORMA XML import**  | NORMA `.orm` XML files                                                   | `OrmModel`                                                                                                       | One-directional. Supports teams migrating from NORMA. Low priority unless a concrete need arises.                                                                                                        |
| **SQL DDL export**    | `RelationalSchema`                                                       | DDL statements                                                                                                   | Useful for documentation and for teams not using dbt.                                                                                                                                                    |
| **MCP server**        | `OrmProject`, verbalization output                                       | MCP tool responses                                                                                               | Exposes the semantic model to LLM-based tooling. Enables queries like "what does Customer mean in the billing context?"                                                                                  |
| **CI/CD validator**   | `OrmProject`                                                             | Pass/fail with diagnostics                                                                                       | CLI wrapper around the validation engine for use in pull request checks.                                                                                                                                 |
| **Data catalog sync** | `OrmProject`, verbalization output                                       | Catalog API calls                                                                                                | Pushes definitions and lineage to tools like Atlan, DataHub, or OpenMetadata.                                                                                                                            |

To support these integrations cleanly, the core package must export stable, well-documented TypeScript interfaces for:

- Loading and querying an `OrmProject` (domains, mappings, products).
- Running validation and retrieving diagnostics.
- Generating verbalizations for any model element.
- Producing a `RelationalSchema` from a domain model via the relational mapper.
- Traversing cross-domain references and context mappings.

These interfaces are the core's public API contract. Integration authors (including us, for the dbt export) depend on this contract rather than on internal implementation details.

---

## 5. VS Code Extension Host

The extension host layer adapts the platform-independent core to the VS Code editor. It is intentionally thin: business logic lives in the core, and the extension host handles wiring.

### 5.1 Language Server (LSP)

The language server provides editor intelligence for `.orm.yaml` files:

- **Diagnostics.** Validation engine output is mapped to VS Code diagnostics and displayed in the Problems panel.
- **Completion.** When editing a `player` reference in a fact type role, the server offers completions from the set of known object types. When editing constraint types, it offers the valid constraint taxonomy.
- **Hover.** Hovering over an object type reference shows its definition and verbalization of the fact types it participates in.
- **Go to Definition.** Navigating from a role's `player` reference to the object type definition.
- **Code Actions.** Quick fixes for common validation errors (e.g., "Add missing reading order" or "Add mandatory constraint to this role").

The language server runs in a separate process (per LSP protocol) and communicates with the extension host via JSON-RPC.

```
packages/vscode/src/
  server/
    OrmLanguageServer.ts
    CompletionProvider.ts
    DiagnosticsProvider.ts
    HoverProvider.ts
    CodeActionProvider.ts
  client/
    OrmLanguageClient.ts     // VS Code client that launches the server
```

### 5.2 Diagram Webview

The diagram panel renders a visual representation of the ORM model. It is implemented as a VS Code Webview panel using a React application with SVG rendering. SVG is chosen because it produces crisp diagrams at any zoom level and supports clean export to static images or PDF.

The approach is informed by the ORM Solutions web verbalization tool, which demonstrates that high-fidelity ORM diagrams can be rendered as SVG in a browser context. Their "JavaScript Fact Engine" (JFE) library is proprietary and not available for use, but the rendering quality and SVG-based architecture serve as a reference target.

The diagram is **read-from-model**: it renders the current state of the `.orm.yaml` file. Editing is done in the text editor (or via commands); the diagram updates reactively. Future phases may support direct manipulation in the diagram, but the initial implementation is read-only visualization.

Diagram rendering uses a layout engine (ELK.js or dagre) for automatic placement of object types and fact types, with manual position overrides stored as metadata.

```
packages/vscode/src/
  diagram/
    DiagramPanel.ts          // VS Code Webview panel host
    webview/                 // React application
      App.tsx
      components/
        ObjectTypeNode.tsx
        FactTypeNode.tsx
        ConstraintIndicator.tsx
        RoleBox.tsx
      layout/
        ElkLayoutEngine.ts
      hooks/
        useModelSync.ts      // receives model updates from extension host
```

### 5.3 Commands and UI Integration

The extension registers commands for common operations:

| Command                | Description                                            |
| ---------------------- | ------------------------------------------------------ |
| `orm.newProject`       | Create a new `.orm.yaml` file with scaffold.           |
| `orm.importTranscript` | Run the transcript processor on a selected file.       |
| `orm.importNorma`      | Import a NORMA `.orm` XML file.                        |
| `orm.showDiagram`      | Open the diagram panel for the current model.          |
| `orm.verbalize`        | Generate a verbalization report for the current model. |
| `orm.exportDdl`        | Generate relational DDL from the current model.        |
| `orm.validateModel`    | Run full validation and report results.                |

```
packages/vscode/src/
  commands/
    NewProjectCommand.ts
    ImportTranscriptCommand.ts
    ImportNormaCommand.ts
    ShowDiagramCommand.ts
    VerbalizeCommand.ts
    ExportDdlCommand.ts
    ValidateModelCommand.ts
  extension.ts               // VS Code activate/deactivate entry point
```

---

## 6. Package Structure

The project uses a monorepo with clearly separated packages.

```
orm-modeler/
├── packages/
│   ├── core/                    # Platform-independent ORM logic
│   │   ├── schemas/             # JSON Schema definitions (first-class artifacts)
│   │   │   ├── orm-model.schema.json
│   │   │   ├── orm-mapping.schema.json
│   │   │   └── orm-project.schema.json
│   │   ├── src/
│   │   │   ├── model/           # Metamodel classes
│   │   │   │   ├── ObjectType.ts
│   │   │   │   ├── FactType.ts
│   │   │   │   ├── Role.ts
│   │   │   │   ├── Constraint.ts
│   │   │   │   ├── ReadingOrder.ts
│   │   │   │   ├── Population.ts
│   │   │   │   ├── Definition.ts
│   │   │   │   ├── DomainContext.ts
│   │   │   │   ├── OrmModel.ts
│   │   │   │   ├── OrmProject.ts
│   │   │   │   ├── ContextMapping.ts
│   │   │   │   └── ModelElement.ts
│   │   │   ├── validation/      # Validation engine and rules
│   │   │   ├── verbalization/   # FORML verbalization
│   │   │   ├── mapping/         # OIAL and relational mapping
│   │   │   └── serialization/   # .orm.yaml and .map.yaml read/write
│   │   ├── tests/
│   │   │   ├── model/
│   │   │   ├── validation/
│   │   │   ├── verbalization/
│   │   │   ├── mapping/
│   │   │   ├── serialization/
│   │   │   └── integration/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── llm/                     # LLM integration (transcript processing)
│   │   ├── src/
│   │   │   ├── TranscriptProcessor.ts
│   │   │   ├── ExtractionPrompt.ts
│   │   │   ├── DraftModelParser.ts
│   │   │   ├── LlmClient.ts
│   │   │   └── providers/
│   │   ├── tests/
│   │   │   ├── ExtractionPrompt.test.ts
│   │   │   ├── DraftModelParser.test.ts
│   │   │   └── fixtures/        # sample transcripts and expected outputs
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── vscode/                  # VS Code extension
│       ├── src/
│       │   ├── extension.ts
│       │   ├── server/          # Language server
│       │   ├── client/          # Language client
│       │   ├── diagram/         # Webview diagram panel (SVG-based)
│       │   └── commands/        # Command implementations
│       ├── tests/
│       │   └── integration/     # Tests that require VS Code test runner
│       ├── package.json         # VS Code extension manifest
│       └── tsconfig.json
│
├── docs/
│   ├── ARCHITECTURE.md          # this file
│   ├── CONTRIBUTING.md
│   ├── metamodel.md             # detailed metamodel documentation
│   └── decisions/               # Architecture Decision Records
│       ├── 001-yaml-over-xml.md
│       ├── 002-multi-file-models.md
│       └── 003-llm-as-import-boundary.md
│
├── examples/                    # Example ORM projects
│   └── order-management/
│       ├── project.orm-project.yaml
│       ├── domains/
│       │   ├── crm.orm.yaml
│       │   ├── billing.orm.yaml
│       │   └── fulfillment.orm.yaml
│       ├── mappings/
│       │   └── crm-billing.map.yaml
│       ├── products/
│       │   └── customer-lifetime-value.orm.yaml
│       └── transcripts/
│           └── kickoff-session.md
│
├── package.json                 # workspace root
├── tsconfig.base.json
└── turbo.json                   # monorepo build orchestration
```

---

## 7. Testing Strategy

The testing approach is structured in layers that mirror the architecture. The guiding principle is that the vast majority of tests run without VS Code, against the platform-independent core.

### 7.1 Test Pyramid

```
      ╱  ╲
     ╱ E2E ╲              VS Code integration tests (slow, few)
    ╱────────╲
   ╱ Integration╲          Cross-module tests in core (moderate)
  ╱──────────────╲
 ╱   Unit Tests    ╲        Pure functions, single module (fast, many)
╱────────────────────╲
```

### 7.2 Unit Tests (packages/core, packages/llm)

**Scope:** Individual functions and classes in isolation.

**Characteristics:**

- No I/O, no file system, no network.
- Run in under a second per test file.
- Use in-memory model construction helpers to build test fixtures.
- Cover every constraint type, validation rule, verbalization pattern, and mapping case.

**Key test areas in `packages/core`:**

| Area                    | What is tested                | Example test case                                                                         |
| ----------------------- | ----------------------------- | ----------------------------------------------------------------------------------------- |
| Model construction      | Creating and linking elements | "Adding a role to a fact type with a nonexistent player ObjectType throws"                |
| Validation: structural  | Well-formedness rules         | "Fact type with no reading orders produces a diagnostic"                                  |
| Validation: constraints | Constraint consistency        | "Internal uniqueness referencing a role not in its fact type produces an error"           |
| Validation: population  | Sample data vs. constraints   | "Population that violates a uniqueness constraint produces an error"                      |
| Verbalization           | FORML sentence generation     | "Binary fact type with single-role uniqueness verbalizes as 'Each X ... at most one Y'"   |
| Relational mapping      | ORM to tables/columns/keys    | "Binary fact type with mandatory single-role uniqueness maps to FK on the mandatory side" |
| Serialization           | Round-trip YAML read/write    | "Model serialized to YAML and deserialized produces an identical model"                   |

**Key test areas in `packages/llm`:**

| Area                     | What is tested                      | Example test case                                                                                                  |
| ------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Prompt construction      | System prompt assembly              | "Prompt includes the JSON schema for structured output"                                                            |
| Response parsing         | LLM JSON output to OrmModel         | "Well-formed extraction response produces valid draft model"                                                       |
| Malformed responses      | Graceful handling of bad LLM output | "Response with missing required fields produces parse error, not crash"                                            |
| Fixture-based extraction | Known transcript to expected output | "Given the sample order-management transcript, extraction identifies Customer, Order, and Product as entity types" |

**Framework:** Vitest (fast, TypeScript-native, compatible with VS Code testing extensions).

**Conventions:**

- Test files are co-located with source under `tests/` mirrors.
- Naming: `<Module>.test.ts`.
- Shared fixture builders live in `tests/helpers/ModelBuilder.ts`, providing a fluent API for constructing test models without boilerplate.

```typescript
// Example: ModelBuilder usage in a test
const model = new ModelBuilder()
  .withEntityType("Customer", { referenceMode: "customer_id" })
  .withEntityType("Order", { referenceMode: "order_number" })
  .withBinaryFactType("Customer places Order", {
    role1: { player: "Customer", name: "places" },
    role2: { player: "Order", name: "is placed by" },
    uniqueness: "role2", // shorthand: each Order -> at most one Customer
    mandatory: "role2", // shorthand: every Order must have a Customer
  })
  .build();
```

### 7.3 Integration Tests (packages/core)

**Scope:** Multiple modules working together within the core.

**Characteristics:**

- May involve file system reads (loading test fixture `.orm.yaml` files).
- Test end-to-end flows: load a model file, validate it, verbalize it, map it to relational schema.
- NORMA XML import tests load real `.orm` files exported from NORMA and verify the resulting model.

**Key scenarios:**

- **Round-trip fidelity.** Load a complex model, serialize it, reload it, verify all elements and constraints are preserved.
- **Multi-file project loading.** Load a project manifest, resolve all domain models and mappings, verify cross-domain references resolve correctly.
- **Context mapping validation.** Verify that entity mappings reference valid object types in both source and target domains, and that namespace-qualified references resolve.
- **Validation-to-verbalization consistency.** A model that passes validation produces verbalizations that are grammatically and semantically correct.
- **Mapping correctness.** A known ORM model produces the expected relational schema (table structure, key placement, foreign key direction).

```
packages/core/tests/
  integration/
    roundTrip.test.ts
    multiFileProject.test.ts
    contextMapping.test.ts
    validationVerbalization.test.ts
    relationalMapping.test.ts
  fixtures/
    orderManagement.orm.yaml
    complexSubtyping.orm.yaml
    multi-domain/
      project.orm-project.yaml
      domains/
        crm.orm.yaml
        billing.orm.yaml
      mappings/
        crm-billing.map.yaml
```

### 7.4 VS Code Integration Tests (packages/vscode)

**Scope:** Extension behavior within a running VS Code instance.

**Characteristics:**

- Run using VS Code's `@vscode/test-electron` or `@vscode/test-web` harness.
- Slow relative to unit tests; limited to critical user-facing flows.
- Verify that diagnostics appear, commands execute, and the diagram panel opens.

**Key scenarios:**

- Opening a `.orm.yaml` file triggers validation and displays diagnostics.
- Running the `orm.validateModel` command produces expected output.
- The diagram panel opens and renders without errors.
- Completions are offered when editing a `player` reference.

### 7.5 LLM Integration Tests (packages/llm)

LLM integration tests use recorded fixtures (saved request/response pairs) rather than live API calls. This ensures tests are deterministic, fast, and free.

For validating actual LLM behavior against the extraction prompt, a separate `tests/live/` directory contains tests that make real API calls. These are excluded from CI and run manually during prompt engineering iterations.

```
packages/llm/tests/
  fixtures/
    transcripts/
      orderManagement.md           # input transcript
    responses/
      orderManagement.json         # recorded LLM response
    expected/
      orderManagement.orm.yaml     # expected resulting model
  live/
    extraction.live.test.ts        # manual; requires API key
```

### 7.6 Test Coverage Targets

| Package              | Target | Rationale                                                                      |
| -------------------- | ------ | ------------------------------------------------------------------------------ |
| `core/model`         | 95%+   | The metamodel is the foundation. Edge cases here propagate everywhere.         |
| `core/validation`    | 95%+   | Incorrect validation erodes trust in the tool. Every rule must be tested.      |
| `core/verbalization` | 90%+   | Verbalization quality directly affects business stakeholder adoption.          |
| `core/mapping`       | 90%+   | Incorrect relational mappings produce wrong schemas.                           |
| `core/serialization` | 95%+   | Data loss during save/load is unacceptable.                                    |
| `llm`                | 85%+   | Response parsing must be robust; prompt construction less so.                  |
| `vscode`             | 70%+   | UI integration tests cover critical paths; exhaustive coverage is impractical. |

---

## 8. Key Technical Decisions

### 8.1 Why YAML over XML for the file format

NORMA uses XML. We use YAML because:

- Our users edit dbt YAML and Airflow YAML daily. The format is familiar.
- YAML diffs are meaningful in pull requests. XML diffs are noisy.
- YAML supports inline comments, which are valuable for documenting modeling decisions.
- The trade-off is that YAML lacks a schema validation ecosystem as mature as XML's XSD. We compensate with a JSON Schema validator applied on load.

See `docs/decisions/001-yaml-over-xml.md`.

### 8.2 Why a monorepo with separate packages

Separation of `core`, `llm`, and `vscode` into distinct packages enforces the dependency rule: `core` depends on nothing, `llm` depends on `core`, and `vscode` depends on both. This is verified by each package's `tsconfig.json` and enforced in CI.

If the core proves useful outside the extension (e.g., in a CLI tool or a CI validation step), it can be published as a standalone npm package without extracting it from the repo.

### 8.3 Why the LLM integration is a separate package

LLM APIs change frequently. Prompt engineering is iterative and experimental. Keeping the LLM integration in its own package means:

- Changes to prompts do not trigger rebuilds of the core.
- The LLM package can have its own, more relaxed testing standards for prompt-dependent behavior.
- Swapping or adding LLM providers does not touch the core.
- Teams that do not want LLM integration can ignore the package entirely.

### 8.4 Why read-only diagrams in the initial phase

Bidirectional synchronization between a graphical editor and a text file is one of the hardest problems in developer tooling. Getting it wrong produces data loss, flickering, and sync conflicts. Starting with read-only diagrams that render from the text file eliminates this entire class of problems and still provides substantial value (visual review of the model during editing).

Direct manipulation in the diagram is a future phase that should be approached cautiously and only after the model layer is stable.

### 8.5 Why multi-file models with explicit context mapping

A single monolithic model file would be simpler, but it fails to represent the bounded context boundaries that are central to the DDD approach this project is built on. Separate files per domain context mean:

- Each domain can be owned and versioned independently.
- Context mappings are explicit artifacts, not implicit conventions.
- The file structure itself communicates the architecture (one file per bounded context, mapping files at the boundaries).
- Multiple data products can compose different subsets of domains and mappings.

The cost is cross-file reference resolution and a project manifest, but this complexity is justified by the semantic clarity.

### 8.6 Why automatic schema migration on load

When the `.orm.yaml` schema evolves between extension versions, users should not need to manually edit their model files. Automatic migration on load (without rewriting the file on disk unless the user saves) means existing projects continue to work seamlessly after an extension update. The migration code is small per version bump and is covered by round-trip integration tests.

---

## 9. Implementation Phasing

### Phase 1: Core Model, Schemas, and Serialization

- JSON Schema definitions for `.orm.yaml`, `.map.yaml`, and `.orm-project.yaml`.
- Metamodel implementation (object types, fact types, Phase 1 constraints).
- YAML serialization with schema validation.
- Unit tests for model and serialization.
- ModelBuilder test helper.
- Example project in `examples/order-management/`.

### Phase 2: Validation and Verbalization

- Validation engine with structural rules and Phase 1 constraint consistency.
- FORML verbalization for fact types and Phase 1 constraints.
- Unit tests for all validation rules and verbalization patterns.

### Phase 3: Multi-File Models, Context Mapping, and Data Products

- Project manifest loading and domain resolution.
- Context mapping model and validation.
- Data product dependency declarations and validation.
- Cross-domain reference resolution with namespace-qualified names.
- Integration tests for multi-file scenarios.

### Phase 4: VS Code Extension (Minimum Viable)

- Language server with diagnostics, completion, and hover.
- Basic command registration (new project, validate).
- Extension packaging and local install.

### Phase 5: LLM Transcript Processing

- Extraction prompt design and iteration.
- Source reference tracking (line numbers, excerpts).
- Draft model parser with validation.
- Import command in the extension.
- Fixture-based tests.

### Phase 6: Relational Mapping

- Rmap implementation for common patterns.
- Phase 2 constraints in metamodel, validation, and verbalization.
- Stable public API for integration consumers.

### Phase 7: Diagram Visualization

- Webview panel with React and SVG rendering.
- Layout engine integration (ELK.js).
- Object type, fact type, and constraint rendering.
- Model sync from editor to diagram.

### Phase 8: Integrations (Separate Projects, Prioritized Separately)

- dbt export (highest priority integration).
- CI/CD validator CLI.
- MCP server.
- NORMA XML import.
- Data catalog sync.

---

## 10. Dependencies

### Runtime

| Dependency              | Purpose                                    | Package |
| ----------------------- | ------------------------------------------ | ------- |
| `yaml`                  | YAML parsing and serialization             | core    |
| `ajv`                   | JSON Schema validation for .orm.yaml files | core    |
| `uuid`                  | Stable element identifiers                 | core    |
| `vscode-languageserver` | LSP implementation                         | vscode  |
| `vscode-languageclient` | LSP client                                 | vscode  |
| `elkjs`                 | Automatic diagram layout                   | vscode  |
| `react`, `react-dom`    | Diagram webview UI                         | vscode  |

### Development

| Dependency              | Purpose                         |
| ----------------------- | ------------------------------- |
| `vitest`                | Test runner                     |
| `typescript`            | Language                        |
| `turbo`                 | Monorepo build orchestration    |
| `@vscode/test-electron` | VS Code integration test runner |
| `@vscode/vsce`          | Extension packaging             |
| `eslint`                | Linting                         |

---

## 11. Open Questions

These are items that need further discussion before or during implementation.

1. **Diagram notation fidelity.** How close to ORM 2 graphical notation do we want the diagrams? Full ORM 2 (role boxes, constraint symbols) or a simplified representation that prioritizes readability? The ORM Solutions web tool demonstrates that full-fidelity SVG rendering is achievable in a browser context.

2. **Cross-domain reference syntax.** The current proposal uses `context:ObjectType` (e.g., `crm:Customer`). Should this be a simple string convention, or should we support richer path-based references (e.g., `./domains/crm.orm.yaml#Customer`) for cases where context names might collide?

3. **Analytical model derivation.** The project manifest lists an `analytical_model` alongside source domains. Should the analytical model's object types carry explicit derivation metadata (e.g., "this Customer is synthesized from crm:Customer and billing:Account via these rules"), or is that sufficiently captured by the context mapping files?

4. **LLM prompt as a managed artifact.** The extraction prompt is critical to the quality of transcript processing. Should it be versioned and testable as a first-class artifact (with regression tests against known transcripts), or treated as a configuration file that users can customize?

5. **Constraint inference confidence thresholds.** The LLM extraction includes a `confidence` field on inferred constraints. Should the import process auto-accept high-confidence constraints and present low-confidence ones as suggestions requiring explicit approval? What confidence threshold separates these?
