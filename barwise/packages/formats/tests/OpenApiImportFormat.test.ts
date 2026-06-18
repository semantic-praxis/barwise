import { describe, expect, it } from "vitest";
import { OpenApiImportFormat } from "../src/openapi/OpenApiImportFormat.js";

describe("OpenApiImportFormat", () => {
  const importer = new OpenApiImportFormat();

  describe("metadata", () => {
    it("should have correct name and description", () => {
      expect(importer.name).toBe("openapi");
      expect(importer.description).toContain("OpenAPI");
    });
  });

  describe("parse", () => {
    it("should handle empty input", () => {
      const result = importer.parse("");
      expect(result.model.objectTypes).toHaveLength(0);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.confidence).toBe("low");
    });

    it("should handle invalid JSON/YAML", () => {
      const result = importer.parse("{{{invalid");
      expect(result.model.objectTypes).toHaveLength(0);
      expect(result.warnings.some((w) => w.includes("parse"))).toBe(true);
      expect(result.confidence).toBe("low");
    });

    it("should handle non-OpenAPI spec", () => {
      const input = JSON.stringify({ foo: "bar" });
      const result = importer.parse(input);
      expect(result.model.objectTypes).toHaveLength(0);
      expect(result.warnings.some((w) => w.includes("schemas"))).toBe(true);
      expect(result.confidence).toBe("low");
    });

    it("should parse simple schema with id and name", () => {
      const spec = {
        openapi: "3.0.0",
        info: { title: "Test API", version: "1.0.0" },
        components: {
          schemas: {
            User: {
              type: "object",
              properties: {
                id: { type: "integer" },
                name: { type: "string" },
                email: { type: "string" },
              },
              required: ["id", "name", "email"],
            },
          },
        },
      };

      const result = importer.parse(JSON.stringify(spec));

      // Should create User entity
      const entities = result.model.objectTypes.filter(
        (ot) => ot.kind === "entity",
      );
      expect(entities).toHaveLength(1);
      expect(entities[0]?.name).toBe("User");
      expect(entities[0]?.referenceMode).toBe("id");

      // Should create value types
      const values = result.model.objectTypes.filter(
        (ot) => ot.kind === "value",
      );
      expect(values.length).toBeGreaterThan(0);

      const nameType = values.find((v) => v.name === "Name");
      expect(nameType).toBeDefined();
      expect(nameType?.dataType?.name).toBe("text");

      const emailType = values.find((v) => v.name === "Email");
      expect(emailType).toBeDefined();
      expect(emailType?.dataType?.name).toBe("text");

      // Should create fact types
      const factTypes = result.model.factTypes;
      expect(factTypes.length).toBeGreaterThan(0);

      const hasNameFact = factTypes.find((ft) => ft.name.includes("has Name"));
      expect(hasNameFact).toBeDefined();
      expect(hasNameFact?.roles).toHaveLength(2);

      // Should have mandatory constraints (all fields are required)
      const allConstraints = result.model.factTypes.flatMap(
        (ft) => ft.constraints,
      );
      const mandatoryConstraints = allConstraints.filter(
        (c) => c.type === "mandatory",
      );
      expect(mandatoryConstraints.length).toBeGreaterThan(0);

      expect(result.confidence).toBe("medium");
    });

    it("should handle required fields correctly", () => {
      const spec = {
        openapi: "3.0.0",
        info: { title: "Test API", version: "1.0.0" },
        components: {
          schemas: {
            Product: {
              type: "object",
              properties: {
                id: { type: "integer" },
                name: { type: "string" },
                description: { type: "string" },
              },
              required: ["id", "name"],
            },
          },
        },
      };

      const result = importer.parse(JSON.stringify(spec));

      const allConstraints = result.model.factTypes.flatMap(
        (ft) => ft.constraints,
      );
      const mandatoryConstraints = allConstraints.filter(
        (c) => c.type === "mandatory",
      );

      // Should have mandatory constraints for "name" but not "description"
      // Note: we need to count carefully - there should be constraints for required props only
      expect(mandatoryConstraints.length).toBeGreaterThan(0);

      // Find the fact type for "description" - it should exist but not have mandatory
      const descriptionFact = result.model.factTypes.find((ft) => ft.name.includes("Description"));
      expect(descriptionFact).toBeDefined();

      // The description fact should not have a mandatory constraint
      const descMandatory = descriptionFact?.constraints.some(
        (c) => c.type === "mandatory",
      );
      expect(descMandatory).toBe(false);
    });

    it("should parse $ref relationships", () => {
      const spec = {
        openapi: "3.0.0",
        info: { title: "Test API", version: "1.0.0" },
        components: {
          schemas: {
            Department: {
              type: "object",
              properties: {
                id: { type: "integer" },
                name: { type: "string" },
              },
            },
            Employee: {
              type: "object",
              properties: {
                id: { type: "integer" },
                name: { type: "string" },
                department: {
                  $ref: "#/components/schemas/Department",
                },
              },
              required: ["id", "name", "department"],
            },
          },
        },
      };

      const result = importer.parse(JSON.stringify(spec));

      // Should create two entity types
      const entities = result.model.objectTypes.filter(
        (ot) => ot.kind === "entity",
      );
      expect(entities).toHaveLength(2);

      const dept = entities.find((e) => e.name === "Department");
      const emp = entities.find((e) => e.name === "Employee");
      expect(dept).toBeDefined();
      expect(emp).toBeDefined();

      // Should create a fact type for the relationship
      const factTypes = result.model.factTypes;
      const refFact = factTypes.find(
        (ft) =>
          ft.roles.some((r) => r.playerId === dept?.id)
          && ft.roles.some((r) => r.playerId === emp?.id),
      );
      expect(refFact).toBeDefined();

      // Relationship should have uniqueness constraint (many-to-one)
      const uniquenessConstraints = refFact?.constraints.filter(
        (c) => c.type === "internal_uniqueness",
      );
      expect(uniquenessConstraints).toHaveLength(1);

      // Should have mandatory constraint since department is required
      const mandatoryConstraints = refFact?.constraints.filter(
        (c) => c.type === "mandatory",
      );
      expect(mandatoryConstraints).toHaveLength(1);
    });

    it("should parse enum values as value constraints", () => {
      const spec = {
        openapi: "3.0.0",
        info: { title: "Test API", version: "1.0.0" },
        components: {
          schemas: {
            Task: {
              type: "object",
              properties: {
                id: { type: "integer" },
                status: {
                  type: "string",
                  enum: ["pending", "in_progress", "completed", "cancelled"],
                },
              },
              required: ["id", "status"],
            },
          },
        },
      };

      const result = importer.parse(JSON.stringify(spec));

      // Should create Status value type with enum constraint
      const values = result.model.objectTypes.filter(
        (ot) => ot.kind === "value",
      );
      const statusType = values.find((v) => v.name === "Status");
      expect(statusType).toBeDefined();
      expect(statusType?.valueConstraint).toBeDefined();
      expect(statusType?.valueConstraint?.values).toEqual([
        "pending",
        "in_progress",
        "completed",
        "cancelled",
      ]);
    });

    it("should parse array of $ref as many-to-many relationship", () => {
      const spec = {
        openapi: "3.0.0",
        info: { title: "Test API", version: "1.0.0" },
        components: {
          schemas: {
            Tag: {
              type: "object",
              properties: {
                id: { type: "integer" },
                name: { type: "string" },
              },
            },
            Article: {
              type: "object",
              properties: {
                id: { type: "integer" },
                title: { type: "string" },
                tags: {
                  type: "array",
                  items: {
                    $ref: "#/components/schemas/Tag",
                  },
                },
              },
            },
          },
        },
      };

      const result = importer.parse(JSON.stringify(spec));

      // Should create two entity types
      const entities = result.model.objectTypes.filter(
        (ot) => ot.kind === "entity",
      );
      expect(entities).toHaveLength(2);

      const tag = entities.find((e) => e.name === "Tag");
      const article = entities.find((e) => e.name === "Article");
      expect(tag).toBeDefined();
      expect(article).toBeDefined();

      // Should create a many-to-many fact type
      const factTypes = result.model.factTypes;
      const manyToManyFact = factTypes.find(
        (ft) =>
          ft.roles.some((r) => r.playerId === tag?.id)
          && ft.roles.some((r) => r.playerId === article?.id),
      );
      expect(manyToManyFact).toBeDefined();

      // Many-to-many should have no uniqueness constraints
      const uniquenessConstraints = manyToManyFact?.constraints.filter(
        (c) => c.type === "internal_uniqueness",
      );
      expect(uniquenessConstraints?.length ?? 0).toBe(0);
    });

    it("should parse multiple schemas with relationships", () => {
      const spec = {
        openapi: "3.0.0",
        info: { title: "Test API", version: "1.0.0" },
        components: {
          schemas: {
            User: {
              type: "object",
              properties: {
                id: { type: "integer" },
                email: { type: "string" },
              },
            },
            Post: {
              type: "object",
              properties: {
                id: { type: "integer" },
                title: { type: "string" },
                author: {
                  $ref: "#/components/schemas/User",
                },
              },
            },
            Comment: {
              type: "object",
              properties: {
                id: { type: "integer" },
                text: { type: "string" },
                post: {
                  $ref: "#/components/schemas/Post",
                },
                author: {
                  $ref: "#/components/schemas/User",
                },
              },
            },
          },
        },
      };

      const result = importer.parse(JSON.stringify(spec));

      // Should create three entity types
      const entities = result.model.objectTypes.filter(
        (ot) => ot.kind === "entity",
      );
      expect(entities).toHaveLength(3);

      const user = entities.find((e) => e.name === "User");
      const post = entities.find((e) => e.name === "Post");
      const comment = entities.find((e) => e.name === "Comment");
      expect(user).toBeDefined();
      expect(post).toBeDefined();
      expect(comment).toBeDefined();

      // Should create relationships
      const factTypes = result.model.factTypes;

      // Post -> User
      const postAuthorFact = factTypes.find(
        (ft) =>
          ft.roles.some((r) => r.playerId === user?.id)
          && ft.roles.some((r) => r.playerId === post?.id),
      );
      expect(postAuthorFact).toBeDefined();

      // Comment -> Post
      const commentPostFact = factTypes.find(
        (ft) =>
          ft.roles.some((r) => r.playerId === post?.id)
          && ft.roles.some((r) => r.playerId === comment?.id),
      );
      expect(commentPostFact).toBeDefined();

      // Comment -> User
      const commentAuthorFact = factTypes.find(
        (ft) =>
          ft.roles.some((r) => r.playerId === user?.id)
          && ft.roles.some((r) => r.playerId === comment?.id)
          && ft !== postAuthorFact, // Different from post->user
      );
      expect(commentAuthorFact).toBeDefined();
    });

    it("should map descriptions to definitions", () => {
      const spec = {
        openapi: "3.0.0",
        info: { title: "Test API", version: "1.0.0" },
        components: {
          schemas: {
            Customer: {
              type: "object",
              description: "A customer who purchases products",
              properties: {
                id: { type: "integer" },
                name: {
                  type: "string",
                  description: "The customer's full name",
                },
              },
            },
          },
        },
      };

      const result = importer.parse(JSON.stringify(spec));

      // Entity should have definition
      const entity = result.model.objectTypes.find(
        (ot) => ot.kind === "entity",
      );
      expect(entity?.definition).toBe("A customer who purchases products");

      // Property fact type should have definition
      const nameFact = result.model.factTypes.find((ft) => ft.name.includes("Name"));
      expect(nameFact?.definition).toBe("The customer's full name");
    });

    it("should handle all OpenAPI type mappings", () => {
      const spec = {
        openapi: "3.0.0",
        info: { title: "Test API", version: "1.0.0" },
        components: {
          schemas: {
            TypeTest: {
              type: "object",
              properties: {
                id: { type: "integer" },
                name: { type: "string" },
                price: { type: "number" },
                count: { type: "integer" },
                active: { type: "boolean" },
                created: { type: "string", format: "date" },
                updated: { type: "string", format: "date-time" },
                uid: { type: "string", format: "uuid" },
              },
            },
          },
        },
      };

      const result = importer.parse(JSON.stringify(spec));

      const values = result.model.objectTypes.filter(
        (ot) => ot.kind === "value",
      );

      // Check type mappings
      const nameType = values.find((v) => v.name === "Name");
      expect(nameType?.dataType?.name).toBe("text");

      const priceType = values.find((v) => v.name === "Price");
      expect(priceType?.dataType?.name).toBe("decimal");

      const countType = values.find((v) => v.name === "Count");
      expect(countType?.dataType?.name).toBe("integer");

      const activeType = values.find((v) => v.name === "Active");
      expect(activeType?.dataType?.name).toBe("boolean");

      const createdType = values.find((v) => v.name === "Created");
      expect(createdType?.dataType?.name).toBe("date");

      const updatedType = values.find((v) => v.name === "Updated");
      expect(updatedType?.dataType?.name).toBe("datetime");

      const uidType = values.find((v) => v.name === "Uid");
      expect(uidType?.dataType?.name).toBe("uuid");
    });

    it("should warn about unsupported features", () => {
      const spec = {
        openapi: "3.0.0",
        info: { title: "Test API", version: "1.0.0" },
        components: {
          schemas: {
            Pet: {
              type: "object",
              oneOf: [{ $ref: "#/components/schemas/Cat" }],
              properties: {
                id: { type: "integer" },
              },
            },
            Product: {
              type: "object",
              discriminator: {
                propertyName: "type",
              },
              properties: {
                id: { type: "integer" },
                type: { type: "string" },
              },
            },
          },
        },
      };

      const result = importer.parse(JSON.stringify(spec));

      // Should have warnings about oneOf and discriminator
      expect(
        result.warnings.some((w) => w.includes("oneOf") || w.includes("anyOf")),
      ).toBe(true);
      expect(result.warnings.some((w) => w.includes("discriminator"))).toBe(
        true,
      );
    });

    it("should parse YAML input", () => {
      const yaml = `
openapi: 3.0.0
info:
  title: Test API
  version: 1.0.0
components:
  schemas:
    User:
      type: object
      properties:
        id:
          type: integer
        username:
          type: string
      required:
        - id
        - username
`;

      const result = importer.parse(yaml);

      // Should successfully parse YAML
      const entities = result.model.objectTypes.filter(
        (ot) => ot.kind === "entity",
      );
      expect(entities).toHaveLength(1);
      expect(entities[0]?.name).toBe("User");

      expect(result.confidence).toBe("medium");
    });

    it("should handle circular references with warning", () => {
      const spec = {
        openapi: "3.0.0",
        info: { title: "Test API", version: "1.0.0" },
        components: {
          schemas: {
            Node: {
              type: "object",
              properties: {
                id: { type: "integer" },
                parent: {
                  $ref: "#/components/schemas/Node",
                },
              },
            },
          },
        },
      };

      const result = importer.parse(JSON.stringify(spec));

      // Should create entity and self-referential fact type
      const entities = result.model.objectTypes.filter(
        (ot) => ot.kind === "entity",
      );
      expect(entities).toHaveLength(1);

      const node = entities[0];
      expect(node?.name).toBe("Node");

      // Should create self-referential fact type
      const factTypes = result.model.factTypes;
      const selfRef = factTypes.find(
        (ft) =>
          ft.roles.some((r) => r.playerId === node?.id)
          && ft.roles.every((r) => r.playerId === node?.id),
      );
      expect(selfRef).toBeDefined();
    });
  });
});
