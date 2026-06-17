/**
 * The JSON Schema that constrains the LLM's structured extraction output.
 */

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
