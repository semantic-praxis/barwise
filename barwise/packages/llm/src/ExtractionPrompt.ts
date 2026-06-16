/**
 * System prompt construction for ORM model extraction from transcripts.
 *
 * The prompt instructs the LLM to:
 * 1. Identify entity types, value types, and their definitions
 * 2. Identify fact types (relationships) with role names and readings
 * 3. Infer constraints from conversational context
 * 4. Track source references for every extracted element
 * 5. Flag ambiguities and contradictions
 */

import type { ExtractionResponse } from "./ExtractionTypes.js";

/**
 * Build the system prompt for transcript extraction.
 *
 * @param includeAlternatives - When true, also ask for one alternative
 *   framing at the highest-impact structural fork.
 */
export function buildSystemPrompt(includeAlternatives = false): string {
  const prompt =
    `You are an expert data modeler specializing in Object-Role Modeling (ORM 2). Your task is to analyze a business working session transcript and extract a structured ORM conceptual model.

## ORM Concepts

**Entity types** are concepts identified by a reference scheme (e.g., Customer identified by customer_id, Order identified by order_number). They represent the main business objects.

**Value types** are self-identifying data values (e.g., Name, Date, Amount, Rating). They represent properties or measurements, not business objects.

**Fact types** are relationships between object types, expressed as natural-language sentences. For example: "Customer places Order" is a binary fact type with two roles -- the Customer role ("places") and the Order role ("is placed by").

**Roles** are positions within a fact type. Each role is played by an object type and has a role name used in verbalization.

**Reading orders** are natural-language templates for the fact type. A binary fact type typically has a forward reading ("{0} places {1}") and an inverse reading ("{1} is placed by {0}"), where {0} and {1} are positional placeholders for the role players.

**Subtype relationships** express specialization: "Employee is a subtype of Person" means every Employee is also a Person. Subtypes must be entity types. By default, a subtype shares the identification scheme of its supertype (provides_identification = true). When a subtype has its own independent identifier, provides_identification should be false.

**Constraints** encode business rules:
- **Internal uniqueness**: "Each Order is placed by at most one Customer" -- the combination of values in certain roles is unique. Single-role uniqueness is most common.
- **Mandatory**: "Every Order is placed by some Customer" -- every instance must participate.
- **Value constraint**: "Rating must be one of: A, B, C, D, F" -- restricts allowed values. Value constraints can appear at two levels: (1) on the value type itself (via the object type's value_constraint field) when the restriction applies universally, or (2) on a specific role within a fact type (via inferred_constraints with type "value_constraint") when the restriction is contextual to that relationship.
- **External uniqueness**: Like internal uniqueness but spans roles across multiple fact types or applies to roles not within a single fact type's internal structure. "The combination of Employee Number and Department Code uniquely identifies an Assignment."
- **Disjunctive mandatory**: At least one of several roles must be populated. "Every Person must have a HomePhone or a MobilePhone (or both)."
- **Exclusion**: Two or more roles are mutually exclusive -- an instance can fill one but not the other. "A Person cannot be both the Driver and the Passenger in the same Trip."
- **Exclusive-or**: Combines exclusion with disjunctive mandatory -- exactly one of the roles must be filled. "Each Vehicle is either a Car or a Truck, but not both."
- **Subset**: One role population must be a subset of another. "Every Person who teaches a Course must also be enrolled in that Course." Uses superset_fact_type and superset_roles to identify the superset side.
- **Equality**: Two role populations must be identical (subset in both directions). "Every Person who manages a Department also works in that Department, and vice versa." Uses superset_fact_type and superset_roles.
- **Ring**: A constraint on a self-referencing (recursive) fact type where the same entity type plays both roles. Common ring types: irreflexive ("No Person manages themselves"), asymmetric ("If A manages B then B does not manage A"), antisymmetric, intransitive, acyclic, symmetric, transitive, purely_reflexive.
- **Frequency**: A role must be played a specific number of times. "Each Customer places between 1 and 5 Orders." Requires min and max values (max can be "unbounded").

## Instructions

Analyze the transcript carefully and extract:

1. **Object types**: Identify the main business concepts (entity types) and their data properties (value types). For each:
   - Provide a name (PascalCase for entity types, PascalCase for value types)
   - Classify as "entity" or "value"
   - Write a concise definition based on how the stakeholders describe it
   - For entity types, propose a reference_mode (the identifier, e.g., "customer_id"). The reference_mode must be a single, simple identifier name -- NEVER a composite like "CourseCode + TermCode" or a fabricated scheme like "auto_counter (generated X)". If identification is unclear, flag it as an ambiguity instead of inventing a scheme.
   - For value types, infer the conceptual data_type when possible. Use one of: text, integer, decimal, money, float, boolean, date, time, datetime, timestamp, auto_counter, binary, uuid, other. ALWAYS include length for text types -- infer reasonable lengths from context (codes/identifiers: 10-20, names: 100-200, free text/notes: 500, short labels: 30). Include length/scale for decimal (e.g. name: "decimal", length: 10, scale: 2).
   - For value types with a fixed set of allowed values, include a value_constraint
   - If stakeholders use alternative names or synonyms for this concept, list them in the aliases array (e.g., aliases: ["Client"] when the primary name is "Customer")
   - Include source references (line numbers and verbatim excerpts)

2. **Populations**: Capture example data mentioned in the transcript. When stakeholders give concrete examples like "Customer Alice placed Order 123" or "Status can be scheduled, completed, or cancelled", record these as sample fact instances. For each population:
   - Identify the fact type being exemplified
   - List the role player names and their example values
   - Include source references
   - Only capture examples explicitly mentioned in the transcript -- do not invent sample data
   - Examples serve two purposes: (1) validation -- they can be checked against constraints to verify the model is correct, (2) documentation -- they make abstract fact types concrete for stakeholders and developers

3. **Fact types**: Identify relationships between object types. For each:
   - Provide a descriptive name (e.g., "Customer places Order")
   - List the roles with their player (object type name) and role_name
   - Provide at least one reading template using {0}, {1}, etc. as placeholders
   - Include source references

   **CRITICAL -- Identifier fact types**: For EVERY entity type that has a reference_mode, you MUST emit a binary fact type linking the entity to its identifying value type. For example, if Customer has reference_mode "customer_id" and there is a value type CustomerId, emit a fact type "Customer has CustomerId" with roles [{player: "Customer", role_name: "has"}, {player: "CustomerId", role_name: "identifies"}] and readings ["{0} has {1}", "{1} identifies {0}"]. Without these fact types, identifier constraints cannot be applied and the model is incomplete.

   **CRITICAL -- Identifier constraints**: Every identifier fact type MUST have three constraints in the inferred_constraints array:
   (a) internal_uniqueness on the entity role with is_preferred: true -- "Each Customer has at most one CustomerId"
   (b) internal_uniqueness on the value role -- "Each CustomerId identifies at most one Customer"
   (c) mandatory on the entity role -- "Every Customer has a CustomerId"
   All three are required. Without is_preferred the relational mapper cannot determine primary keys. Without mandatory the model allows entities without identifiers, which is invalid.

   **Ternary and higher-arity fact types**: When the transcript describes a rule spanning 3 or more concepts, model it as a single multi-role fact type rather than leaving it as a comment. For example, "each line specifies a product and a quantity" where quantity depends on the order-product combination should be a ternary "Order contains Product with Quantity" with composite uniqueness on the Order+Product roles.

   When scheduling or assignment constraints involve multiple dimensions (e.g., "a patient can have at most one appointment per date and time slot", "a doctor can have at most one appointment per date and time slot"), these cross-entity constraints require all participating concepts in one fact type. Model a single higher-arity fact type (e.g., "Appointment is for Patient with Doctor on Date at TimeSlot") and apply multiple uniqueness constraints on different role combinations within it. Do NOT model these as separate binary fact types -- the scheduling constraints cannot be expressed on independent binaries.

4. **Objectified fact types**: Identify when a relationship is itself treated as an entity in other relationships. This is called objectification (or nesting). For example, if the transcript discusses "Enrollment" as a concept that has its own properties (grade, semester) AND enrollment represents the relationship "Student enrolls in Course", then "Student enrolls in Course" is objectified as "Enrollment". For each:
   - Specify the fact_type name (the underlying relationship, e.g., "Student enrolls in Course")
   - Specify the object_type name (the entity created by objectification, e.g., "Enrollment")
   - Both must appear in the extracted fact_types and object_types respectively
   - The object type must be an entity type with its own reference_mode
   - Write a description explaining why objectification is appropriate
   - Include source references
   - Common examples: Enrollment (Student enrolls in Course), Marriage (Person marries Person), Employment (Person works for Company), Prescription (Doctor prescribes Drug to Patient)
   - Only use objectification when the transcript explicitly treats the relationship as a named concept with its own attributes

5. **Subtypes**: Identify "is a" / specialization relationships between entity types. For each:
   - Specify the subtype and supertype entity names (both must appear in the object_types list)
   - Set provides_identification to false only if the subtype has its own independent identifier
   - Write a brief description explaining the specialization
   - Include source references

6. **Inferred constraints**: Identify business rules from context. For each:
   - Specify the type: one of internal_uniqueness, mandatory, value_constraint, external_uniqueness, disjunctive_mandatory, exclusion, exclusive_or, subset, equality, ring, or frequency.
   - In the "roles" array, list the **object type names** (player names) of the constrained roles, NOT the role names. For example, for "Each Order is placed by at most one Customer" in fact type "Customer places Order", use roles: ["Order"] (the constrained player), not roles: ["is placed by"].
   - For value_constraint: specify one role (the constrained player name) and include a "values" array listing the allowed values. Example: type "value_constraint", fact_type "Appointment has AppointmentStatus", roles ["AppointmentStatus"], values ["scheduled", "checked-in", "completed", "cancelled"]. Use this for enumerated values tied to a specific role. If the value type is ALWAYS restricted to these values (regardless of context), prefer setting value_constraint on the object type instead.
   - Write a human-readable description
   - For **reference-mode fact types** (entity has value-type identifier), emit TWO uniqueness constraints:
     (a) uniqueness on the entity role with is_preferred: true ("Each Customer has at most one CustomerId")
     (b) uniqueness on the value role ("Each CustomerId identifies at most one Customer")
     Both are needed to make the identifier a bijection.
   - For **ternary or higher-arity fact types**, composite uniqueness should list ALL constrained role players. For example, if each Order-Product combination has at most one Quantity, use roles: ["Order", "Product"] -- not just one of them.
   - For binary many-to-one relationships, the uniqueness goes on the "many" side. "Customers can place multiple orders" but "each Order belongs to one Customer" means uniqueness on the Order role, not the Customer role.
   - For **subset** and **equality** constraints that span two fact types, use the "fact_type" field for one side and "superset_fact_type" for the other side. List role players in "roles" for the first fact type and "superset_roles" for the second. Both role arrays must have the same length (matching arity).
   - For **ring** constraints on self-referencing fact types (where the same entity plays both roles), specify ring_type as one of: irreflexive, asymmetric, antisymmetric, intransitive, acyclic, symmetric, transitive, purely_reflexive. The roles array must contain exactly 2 entries (both the same player name).
   - For **frequency** constraints, specify min and max (max can be the string "unbounded"). The roles array must contain exactly 1 entry.
   - Assess confidence: "high" if explicitly stated, "medium" if strongly implied, "low" if inferred from general domain knowledge
   - Include the source references that justify the inference

7. **Ambiguities**: After extracting all elements above, perform a review pass against each category below. Flag anything uncertain as an ambiguity with a clear, actionable description and the source references that triggered the concern. For each ambiguity, describe the specific question that needs to be answered.

   **Identification**: Does every entity type have a clear, unambiguous identifier? Flag when multiple candidate identifiers exist (e.g., both "customer number" and "email" implied as unique), when no identifier is stated, or when composite identification is unclear. Example: "Each customer has a customer number and an email" -- is email also unique, or just customer number?

   **Cardinality**: Is the multiplicity of each relationship clear? Flag when one-to-many vs many-to-many is not explicit, when "has" or "contains" could mean either direction, or when aggregation vs association is ambiguous. Example: "A project has team members" -- can a team member belong to multiple projects?

   **Optionality**: Is participation mandatory or optional? Flag when "can have" or "may have" is used without clarifying the reverse direction, when mandatory participation is assumed but not stated, or when null/empty cases are unaddressed. Example: "An order can have a discount code" -- must every discount code be used on at least one order?

   **Overloaded terms**: Are the same words used with different meanings? Flag when a term appears in multiple contexts with potentially different semantics, when abbreviations are undefined, or when domain jargon could be interpreted multiple ways. Example: "Account" used for both user login accounts and financial accounts.

   **Temporal**: Are time-dependent facts modeled correctly? Flag when a relationship changes over time but is modeled as current-state only, when historical tracking may be needed but is not mentioned, or when effective dates are implied but not explicit. Example: "An employee works in a department" -- is this current assignment only, or should history be tracked?

   **Granularity**: Is the level of detail appropriate? Flag when an entity could be decomposed further, when a value type might be better modeled as an entity, or when measurement precision is unstated. Example: "Each store has an address" -- is address a single text value, or structured into street, city, state, postal code?

   **Derivation**: Is a fact stored or computed? Flag when a stated fact appears derivable from other facts, when aggregations are described as attributes, or when it is unclear whether a value should be stored or computed. Example: "Each order has a total amount" -- is this stored, or derived from line item prices?

   **Constraint completeness**: Are business rules fully captured? Flag when a constraint is implied but not explicit enough to formalize, when mutual exclusion or dependency between facts is hinted at, or when boundary conditions are unaddressed. Example: "A flight is either domestic or international" -- is this exclusive (exactly one), or could a flight be neither?

## Critical Rules

- Every extracted element MUST have source_references with line numbers and verbatim excerpts from the transcript.
- Do NOT invent concepts not discussed in the transcript.
- Do NOT assume constraints that are not at least implied by the conversation.
- Prefer specific, descriptive fact type names over generic ones.
- If stakeholders use different terms for what appears to be the same concept, record the alternative names as aliases on the primary object type rather than flagging as an ambiguity. For example, if "Client" and "Customer" are used interchangeably, pick the most common term as the name and list the other(s) in the aliases array. Only flag as ambiguity if it is genuinely unclear whether the terms refer to the same concept.
- Role names should be natural verbs or prepositions (e.g., "places", "is placed by", "has", "is of").
- Reading templates must use {0}, {1}, etc. matching the role order.
- EVERY entity type with a reference_mode MUST have a corresponding identifier fact type in the fact_types array. If you emit an entity with reference_mode "order_number" but no fact type "Order has OrderNumber", the model is incomplete.
- EVERY identifier fact type MUST have three inferred constraints: (1) internal_uniqueness on the entity role with is_preferred: true, (2) internal_uniqueness on the value role, (3) mandatory on the entity role. If any of these are missing, the identifier is incomplete.
- NEVER use composite or fabricated reference_modes. Each reference_mode must be a single simple identifier name (e.g., "customer_id", "order_number", "sku"). If identification requires a composite key, flag it as an ambiguity.
- ALWAYS include length for text data types. Do not omit it.
- NEVER emit a fact type that duplicates information already captured by other fact types in the model. Each relationship should be modeled exactly once.
- Do NOT place is_preferred: true on non-identifier fact types. Only the fact type linking an entity to its identifying value type should have is_preferred.`;

  if (!includeAlternatives) return prompt;

  return prompt + `

## Alternative framings

After the primary extraction, review the ambiguities you flagged and pick the single most consequential STRUCTURAL fork -- one of: an attribute that could be a value type or its own entity type; a relationship that could be a subtype or a role; a binary fact type that could be objectified; or a choice between candidate identifiers. For that one fork only, produce an alternative framing in the "alternatives" array: a full model (object_types, fact_types, subtypes, inferred_constraints, and any objectified_fact_types or populations) that takes the OTHER side of the fork, plus:
- rationale: one sentence naming what this framing does differently (e.g. "models Email as the preferred identifier instead of customer_id").
- ambiguity_description: the description of the ambiguity this framing resolves.

Produce AT MOST ONE alternative, and only when a genuine structural fork exists. If there is none, omit "alternatives" or leave it empty. Do NOT produce alternatives for mere cardinality or optionality questions -- those are constraint choices, not framings.`;
}

/**
 * Build the user message containing the transcript.
 *
 * @param transcript - The raw transcript text.
 * @param existingModelContext - Optional summary of types already in
 *   the base model.  When provided, the LLM avoids redefining them.
 */
export function buildUserMessage(
  transcript: string,
  existingModelContext?: string,
): string {
  const contextBlock = existingModelContext
    ? `\n<existing_model>\n${existingModelContext}\n</existing_model>\n\nThe types listed above already exist in the base model. Do NOT include them in your object_types output -- only output genuinely NEW types. When creating new fact types, reference existing types by their exact names as role players. Do NOT create identifier fact types for existing entity types.\n\n`
    : "";

  return `Extract an ORM conceptual model from the following business working session transcript. Number each line for source reference tracking.
${contextBlock}
<transcript>
${numberLines(transcript)}
</transcript>

Analyze this transcript and produce the structured extraction.`;
}

/**
 * JSON Schema for the extraction response, used to constrain LLM output.
 *
 * @param includeAlternatives - When true, add an `alternatives` property
 *   (an array of full candidate models with a rationale).
 */
export function buildResponseSchema(
  includeAlternatives = false,
): Record<string, unknown> {
  const schema = {
    type: "object",
    properties: {
      object_types: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            kind: { type: "string", enum: ["entity", "value"] },
            definition: { type: "string" },
            reference_mode: { type: "string" },
            value_constraint: {
              type: "object",
              properties: {
                values: { type: "array", items: { type: "string" } },
              },
              required: ["values"],
            },
            data_type: {
              type: "object",
              properties: {
                name: {
                  type: "string",
                  enum: [
                    "text",
                    "integer",
                    "decimal",
                    "money",
                    "float",
                    "boolean",
                    "date",
                    "time",
                    "datetime",
                    "timestamp",
                    "auto_counter",
                    "binary",
                    "uuid",
                    "other",
                  ],
                },
                length: { type: "number" },
                scale: { type: "number" },
              },
              required: ["name"],
            },
            aliases: {
              type: "array",
              items: { type: "string" },
            },
            source_references: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  lines: {
                    type: "array",
                    items: { type: "number" },
                    minItems: 2,
                    maxItems: 2,
                  },
                  excerpt: { type: "string" },
                },
                required: ["lines", "excerpt"],
              },
            },
          },
          required: ["name", "kind", "source_references"],
        },
      },
      fact_types: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            roles: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  player: { type: "string" },
                  role_name: { type: "string" },
                },
                required: ["player", "role_name"],
              },
            },
            readings: { type: "array", items: { type: "string" } },
            source_references: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  lines: {
                    type: "array",
                    items: { type: "number" },
                    minItems: 2,
                    maxItems: 2,
                  },
                  excerpt: { type: "string" },
                },
                required: ["lines", "excerpt"],
              },
            },
          },
          required: ["name", "roles", "readings", "source_references"],
        },
      },
      inferred_constraints: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: [
                "internal_uniqueness",
                "mandatory",
                "value_constraint",
                "external_uniqueness",
                "disjunctive_mandatory",
                "exclusion",
                "exclusive_or",
                "subset",
                "equality",
                "ring",
                "frequency",
              ],
            },
            fact_type: { type: "string" },
            roles: { type: "array", items: { type: "string" } },
            description: { type: "string" },
            confidence: {
              type: "string",
              enum: ["high", "medium", "low"],
            },
            is_preferred: { type: "boolean" },
            values: { type: "array", items: { type: "string" } },
            ring_type: {
              type: "string",
              enum: [
                "irreflexive",
                "asymmetric",
                "antisymmetric",
                "intransitive",
                "acyclic",
                "symmetric",
                "transitive",
                "purely_reflexive",
              ],
            },
            min: { type: "number" },
            max: {
              oneOf: [
                { type: "number" },
                { type: "string", enum: ["unbounded"] },
              ],
            },
            superset_fact_type: { type: "string" },
            superset_roles: { type: "array", items: { type: "string" } },
            source_references: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  lines: {
                    type: "array",
                    items: { type: "number" },
                    minItems: 2,
                    maxItems: 2,
                  },
                  excerpt: { type: "string" },
                },
                required: ["lines", "excerpt"],
              },
            },
          },
          required: [
            "type",
            "fact_type",
            "roles",
            "description",
            "confidence",
            "source_references",
          ],
        },
      },
      subtypes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            subtype: { type: "string" },
            supertype: { type: "string" },
            provides_identification: { type: "boolean" },
            description: { type: "string" },
            source_references: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  lines: {
                    type: "array",
                    items: { type: "number" },
                    minItems: 2,
                    maxItems: 2,
                  },
                  excerpt: { type: "string" },
                },
                required: ["lines", "excerpt"],
              },
            },
          },
          required: ["subtype", "supertype", "description", "source_references"],
        },
      },
      objectified_fact_types: {
        type: "array",
        items: {
          type: "object",
          properties: {
            fact_type: { type: "string" },
            object_type: { type: "string" },
            description: { type: "string" },
            source_references: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  lines: {
                    type: "array",
                    items: { type: "number" },
                    minItems: 2,
                    maxItems: 2,
                  },
                  excerpt: { type: "string" },
                },
                required: ["lines", "excerpt"],
              },
            },
          },
          required: [
            "fact_type",
            "object_type",
            "description",
            "source_references",
          ],
        },
      },
      populations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            fact_type: { type: "string" },
            description: { type: "string" },
            instances: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  role_values: {
                    type: "object",
                    additionalProperties: { type: "string" },
                  },
                },
                required: ["role_values"],
              },
            },
            source_references: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  lines: {
                    type: "array",
                    items: { type: "number" },
                    minItems: 2,
                    maxItems: 2,
                  },
                  excerpt: { type: "string" },
                },
                required: ["lines", "excerpt"],
              },
            },
          },
          required: ["fact_type", "instances", "source_references"],
        },
      },
      ambiguities: {
        type: "array",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            source_references: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  lines: {
                    type: "array",
                    items: { type: "number" },
                    minItems: 2,
                    maxItems: 2,
                  },
                  excerpt: { type: "string" },
                },
                required: ["lines", "excerpt"],
              },
            },
          },
          required: ["description", "source_references"],
        },
      },
    },
    required: [
      "object_types",
      "fact_types",
      "subtypes",
      "inferred_constraints",
      "ambiguities",
    ],
  };

  if (includeAlternatives) {
    const props = schema.properties as Record<string, unknown>;
    props["alternatives"] = {
      type: "array",
      items: {
        type: "object",
        properties: {
          rationale: { type: "string" },
          ambiguity_description: { type: "string" },
          object_types: props["object_types"],
          fact_types: props["fact_types"],
          subtypes: props["subtypes"],
          inferred_constraints: props["inferred_constraints"],
          objectified_fact_types: props["objectified_fact_types"],
          populations: props["populations"],
        },
        required: [
          "rationale",
          "ambiguity_description",
          "object_types",
          "fact_types",
          "subtypes",
          "inferred_constraints",
        ],
      },
    };
  }

  return schema;
}

/**
 * Validate that a parsed JSON object conforms to the ExtractionResponse shape.
 * Returns a typed result or throws with a descriptive message.
 */
export function parseExtractionResponse(json: unknown): ExtractionResponse {
  if (typeof json !== "object" || json === null) {
    throw new Error("Extraction response must be a JSON object.");
  }

  const obj = json as Record<string, unknown>;

  const objectTypes = Array.isArray(obj["object_types"])
    ? obj["object_types"]
    : [];
  const factTypes = Array.isArray(obj["fact_types"])
    ? obj["fact_types"]
    : [];
  const subtypes = Array.isArray(obj["subtypes"])
    ? obj["subtypes"]
    : [];
  const inferredConstraints = Array.isArray(obj["inferred_constraints"])
    ? obj["inferred_constraints"]
    : [];
  const objectifiedFactTypes = Array.isArray(obj["objectified_fact_types"])
    ? obj["objectified_fact_types"]
    : [];
  const populations = Array.isArray(obj["populations"])
    ? obj["populations"]
    : [];
  const ambiguities = Array.isArray(obj["ambiguities"])
    ? obj["ambiguities"]
    : [];
  const alternatives = Array.isArray(obj["alternatives"])
    ? (obj["alternatives"] as ExtractionResponse["alternatives"])
    : undefined;

  return {
    object_types: objectTypes as ExtractionResponse["object_types"],
    fact_types: factTypes as ExtractionResponse["fact_types"],
    subtypes: subtypes as ExtractionResponse["subtypes"],
    inferred_constraints: inferredConstraints as ExtractionResponse["inferred_constraints"],
    objectified_fact_types: objectifiedFactTypes as ExtractionResponse["objectified_fact_types"],
    populations: populations as ExtractionResponse["populations"],
    ambiguities: ambiguities as ExtractionResponse["ambiguities"],
    ...(alternatives ? { alternatives } : {}),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function numberLines(text: string): string {
  return text
    .split("\n")
    .map((line, i) => `${i + 1}: ${line}`)
    .join("\n");
}
