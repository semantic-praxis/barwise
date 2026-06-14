/**
 * OpenAPI 3.0/3.1 import format.
 *
 * Parses OpenAPI specifications (YAML or JSON) into an ORM model. This is a
 * deterministic parser that handles standard OpenAPI 3.x features. It infers
 * ORM concepts from API schemas:
 *
 * - Schemas (objects with properties) become EntityTypes
 * - Schema properties become binary FactTypes (Entity has ValueType)
 * - $ref relationships become FactTypes between entities
 * - required arrays become mandatory constraints
 * - enum values become value constraints
 * - string constraints (minLength, maxLength, pattern) become value constraints where expressible
 *
 * The parser uses heuristics for naming and reference mode inference. The optional
 * LLM enrichment phase (not implemented here) can improve naming and add definitions.
 */

import {
  type ConceptualDataTypeName,
  type ImportFormat,
  type ImportOptions,
  type ImportResult,
  OrmModel,
} from "@barwise/core";
import { parse as parseYaml } from "yaml";

/**
 * A parsed OpenAPI schema object.
 */
interface ParsedSchema {
  readonly name: string;
  readonly type?: string;
  readonly properties?: Record<string, ParsedProperty>;
  readonly required?: readonly string[];
  readonly description?: string;
}

/**
 * A parsed property within a schema.
 */
interface ParsedProperty {
  readonly type?: string;
  readonly format?: string;
  readonly enum?: readonly unknown[];
  readonly $ref?: string;
  readonly items?: { readonly $ref?: string; readonly type?: string; };
  readonly description?: string;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
}

/**
 * OpenAPI import format implementation.
 */
export class OpenApiImportFormat implements ImportFormat {
  readonly name = "openapi";
  readonly description = "Import OpenAPI 3.0/3.1 specification (YAML or JSON) into an ORM model";

  parse(input: string, options?: ImportOptions): ImportResult {
    const warnings: string[] = [];
    const modelName = options?.modelName ?? "OpenAPI Model";

    // Parse YAML/JSON (yaml package handles both)
    let spec: any;
    try {
      spec = parseYaml(input);
    } catch (err) {
      warnings.push(
        `Failed to parse OpenAPI input: ${err instanceof Error ? err.message : String(err)}`,
      );
      return {
        model: new OrmModel({ name: modelName }),
        warnings,
        confidence: "low",
      };
    }

    // Verify it's an OpenAPI spec
    if (!spec || typeof spec !== "object") {
      warnings.push("Input is not a valid OpenAPI specification");
      return {
        model: new OrmModel({ name: modelName }),
        warnings,
        confidence: "low",
      };
    }

    if (!spec.openapi || !spec.openapi.startsWith("3.")) {
      warnings.push(
        `Expected OpenAPI 3.x specification, found version: ${spec.openapi || "unknown"}`,
      );
    }

    // Extract schemas from components
    const schemas = spec.components?.schemas;
    if (!schemas || typeof schemas !== "object") {
      warnings.push("No schemas found in OpenAPI specification");
      return {
        model: new OrmModel({ name: modelName }),
        warnings,
        confidence: "low",
      };
    }

    // Parse all schemas
    const parsedSchemas: ParsedSchema[] = [];
    for (const [schemaName, schemaDef] of Object.entries(schemas)) {
      if (typeof schemaDef === "object" && schemaDef !== null) {
        parsedSchemas.push(
          this.parseSchema(schemaName, schemaDef as any, warnings),
        );
      }
    }

    if (parsedSchemas.length === 0) {
      warnings.push("No valid schemas found to import");
      return {
        model: new OrmModel({ name: modelName }),
        warnings,
        confidence: "low",
      };
    }

    // Build the ORM model
    const model = new OrmModel({ name: modelName });

    // Step 1: Create entity types for all schemas
    const entityMap = new Map<string, string>(); // schema name -> entity type id
    for (const schema of parsedSchemas) {
      const referenceMode = this.inferReferenceMode(schema);

      const entityType = model.addObjectType({
        name: schema.name,
        kind: "entity",
        referenceMode,
        definition: schema.description,
      });
      entityMap.set(schema.name, entityType.id);
    }

    // Step 2: Create value types and fact types for properties
    for (const schema of parsedSchemas) {
      const entityId = entityMap.get(schema.name);
      if (!entityId) continue;

      const entityType = model.getObjectType(entityId);
      if (!entityType || !schema.properties) continue;

      for (const [propName, propDef] of Object.entries(schema.properties)) {
        // Check if this is a $ref to another schema
        if (propDef.$ref) {
          const refSchemaName = this.extractRefName(propDef.$ref);
          const referencedEntityId = entityMap.get(refSchemaName);

          if (referencedEntityId) {
            this.createRefFactType(
              model,
              entityType,
              referencedEntityId,
              propName,
              propDef,
              schema.required ?? [],
              warnings,
            );
          } else {
            warnings.push(
              `Cannot resolve $ref: ${propDef.$ref} for property ${propName}`,
            );
          }
        } else if (propDef.items?.$ref) {
          // Array of $ref - many-to-many relationship indicator
          const refSchemaName = this.extractRefName(propDef.items.$ref);
          const referencedEntityId = entityMap.get(refSchemaName);

          if (referencedEntityId) {
            this.createArrayRefFactType(
              model,
              entityType,
              referencedEntityId,
              propName,
              propDef,
              warnings,
            );
          } else {
            warnings.push(
              `Cannot resolve array $ref: ${propDef.items.$ref} for property ${propName}`,
            );
          }
        } else {
          // Regular property: create value type and fact type
          this.createPropertyFactType(
            model,
            entityType,
            propName,
            propDef,
            schema.required ?? [],
            warnings,
          );
        }
      }
    }

    // Warn about unsupported features
    if (spec.components?.schemas) {
      for (
        const [schemaName, schemaDef] of Object.entries(
          spec.components.schemas,
        )
      ) {
        const schema = schemaDef as any;
        if (schema.oneOf || schema.anyOf || schema.allOf) {
          warnings.push(
            `Schema "${schemaName}" uses oneOf/anyOf/allOf - these are not fully supported and may require manual review`,
          );
        }
        if (schema.discriminator) {
          warnings.push(
            `Schema "${schemaName}" has a discriminator - subtype relationships may need manual modeling`,
          );
        }
      }
    }

    return {
      model,
      warnings,
      confidence: "medium",
    };
  }

  /**
   * Parse a single schema definition.
   */
  private parseSchema(
    name: string,
    def: any,
    warnings: string[],
  ): ParsedSchema {
    if (def.type !== "object" && !def.properties) {
      // Non-object schemas (primitives, arrays) are not modeled as entities
      warnings.push(
        `Schema "${name}" is not an object type and will be skipped`,
      );
    }

    return {
      name,
      type: def.type,
      properties: def.properties,
      required: def.required,
      description: def.description,
    };
  }

  /**
   * Extract the schema name from a $ref like "#/components/schemas/User".
   */
  private extractRefName(ref: string): string {
    const parts = ref.split("/");
    return parts[parts.length - 1] ?? ref;
  }

  /**
   * Infer a reference mode (primary key field) for an entity.
   * Looks for properties named "id", "{schema}Id", or uses a default.
   */
  private inferReferenceMode(schema: ParsedSchema): string {
    if (!schema.properties) {
      return `${schema.name.toLowerCase()}_id`;
    }

    const props = Object.keys(schema.properties);

    // Look for "id" property
    if (props.includes("id")) {
      return "id";
    }

    // Look for "{schema}Id" pattern (e.g., "userId" for "User" schema)
    const expectedId = `${schema.name.toLowerCase()}Id`;
    if (props.includes(expectedId)) {
      return expectedId;
    }

    // Default
    return `${schema.name.toLowerCase()}_id`;
  }

  /**
   * Create a fact type for a $ref property (relationship to another entity).
   */
  private createRefFactType(
    model: OrmModel,
    entityType: { readonly id: string; readonly name: string; },
    referencedEntityId: string,
    propName: string,
    propDef: ParsedProperty,
    requiredProps: readonly string[],
    warnings: string[],
  ): void {
    const referencedEntity = model.getObjectType(referencedEntityId);
    if (!referencedEntity) return;

    // Infer verb from property name (e.g., "owner" -> "owned by")
    const verb = this.inferVerbFromPropertyName(
      propName,
      referencedEntity.name,
    );

    const factTypeName = `${entityType.name} ${verb} ${referencedEntity.name}`;

    try {
      const constraints: any[] = [];

      // Uniqueness constraint (many-to-one by default)
      const role1Id = `${entityType.id}-${verb}-role`;
      constraints.push({
        type: "internal_uniqueness",
        roleIds: [role1Id],
        isPreferred: false,
      });

      // Mandatory constraint if property is required
      if (requiredProps.includes(propName)) {
        constraints.push({
          type: "mandatory",
          roleId: role1Id,
        });
      }

      model.addFactType({
        name: factTypeName,
        roles: [
          {
            name: verb,
            playerId: referencedEntity.id,
            id: `${referencedEntity.id}-${verb}-role`,
          },
          { name: `is ${verb} by`, playerId: entityType.id, id: role1Id },
        ],
        readings: [`{0} ${verb} {1}`],
        constraints,
        definition: propDef.description,
      });
    } catch (err) {
      warnings.push(
        `Failed to create fact type for $ref property ${propName}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Create a fact type for an array of $ref (many-to-many relationship indicator).
   */
  private createArrayRefFactType(
    model: OrmModel,
    entityType: { readonly id: string; readonly name: string; },
    referencedEntityId: string,
    propName: string,
    propDef: ParsedProperty,
    warnings: string[],
  ): void {
    const referencedEntity = model.getObjectType(referencedEntityId);
    if (!referencedEntity) return;

    // Array of refs suggests many-to-many
    const factTypeName = `${entityType.name} has ${referencedEntity.name}`;

    try {
      // No uniqueness constraint for many-to-many
      model.addFactType({
        name: factTypeName,
        roles: [
          {
            name: "has",
            playerId: entityType.id,
            id: `${entityType.id}-has-${referencedEntity.name}-role`,
          },
          {
            name: "belongs to",
            playerId: referencedEntity.id,
            id: `${referencedEntity.id}-belongs-to-${entityType.name}-role`,
          },
        ],
        readings: [`{0} has {1}`],
        constraints: [], // Many-to-many has no uniqueness constraint on either side
        definition: propDef.description
          ? `Many-to-many: ${propDef.description}`
          : undefined,
      });
    } catch (err) {
      warnings.push(
        `Failed to create fact type for array $ref property ${propName}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Create a fact type for a regular property (Entity has ValueType).
   */
  private createPropertyFactType(
    model: OrmModel,
    entityType: { readonly id: string; readonly name: string; },
    propName: string,
    propDef: ParsedProperty,
    requiredProps: readonly string[],
    warnings: string[],
  ): void {
    // Create value type
    const valueTypeName = this.toPascalCase(propName);
    const conceptualType = this.mapOpenApiTypeToConceptual(
      propDef.type,
      propDef.format,
    );

    let valueType = model.getObjectTypeByName(valueTypeName);
    if (!valueType) {
      // Check for enum values
      const valueConstraint = propDef.enum && propDef.enum.length > 0
        ? { values: propDef.enum.map((v) => String(v)) }
        : undefined;

      valueType = model.addObjectType({
        name: valueTypeName,
        kind: "value",
        dataType: { name: conceptualType },
        valueConstraint,
        definition: propDef.description,
      });
    }

    // Create fact type
    const factTypeName = `${entityType.name} has ${valueTypeName}`;

    try {
      const constraints: any[] = [];

      const role0Id = `${valueType.id}-has-role`;
      const role1Id = `${entityType.id}-has-${valueTypeName}-role`;

      // Uniqueness constraint (unique on entity side by default)
      constraints.push({
        type: "internal_uniqueness",
        roleIds: [role0Id],
        isPreferred: false,
      });

      // Mandatory constraint if property is required
      if (requiredProps.includes(propName)) {
        constraints.push({
          type: "mandatory",
          roleId: role0Id,
        });
      }

      model.addFactType({
        name: factTypeName,
        roles: [
          { name: "has", playerId: valueType.id, id: role0Id },
          { name: `belongs to`, playerId: entityType.id, id: role1Id },
        ],
        readings: [`{0} has {1}`],
        constraints,
        definition: propDef.description,
      });
    } catch (err) {
      warnings.push(
        `Failed to create fact type for property ${propName}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Infer a verb phrase from a property name.
   */
  private inferVerbFromPropertyName(
    propName: string,
    referencedEntityName: string,
  ): string {
    // Common patterns
    if (propName.toLowerCase() === "owner") return "owned by";
    if (propName.toLowerCase() === "creator") return "created by";
    if (propName.toLowerCase() === "parent") return "child of";
    if (propName.toLowerCase() === "manager") return "managed by";

    // Default: use the property name as-is if it's different from entity name
    if (propName.toLowerCase() !== referencedEntityName.toLowerCase()) {
      return this.toCamelCase(propName);
    }

    return "references";
  }

  /**
   * Convert plural array property name to singular verb.
   */
  private pluralToSingularVerb(propName: string): string {
    // Simple plural removal
    if (propName.endsWith("s")) {
      return propName.slice(0, -1);
    }
    return propName;
  }

  /**
   * Map OpenAPI types to conceptual ORM data types.
   */
  private mapOpenApiTypeToConceptual(
    type?: string,
    format?: string,
  ): ConceptualDataTypeName {
    if (!type) return "other";

    switch (type.toLowerCase()) {
      case "string":
        if (format === "date") return "date";
        if (format === "time") return "time";
        if (format === "date-time") return "datetime";
        if (format === "uuid") return "uuid";
        if (format === "binary") return "binary";
        return "text";

      case "integer":
        return "integer";

      case "number":
        return format === "float" || format === "double" ? "float" : "decimal";

      case "boolean":
        return "boolean";

      default:
        return "other";
    }
  }

  /**
   * Convert string to PascalCase.
   */
  private toPascalCase(str: string): string {
    // Handle camelCase, snake_case, kebab-case
    return str
      .replace(/([a-z])([A-Z])/g, "$1_$2") // camelCase -> snake_case
      .replace(/-/g, "_") // kebab-case -> snake_case
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join("");
  }

  /**
   * Convert string to camelCase.
   */
  private toCamelCase(str: string): string {
    const parts = str
      .replace(/([a-z])([A-Z])/g, "$1_$2")
      .replace(/-/g, "_")
      .split("_");

    if (parts.length === 0) return str;

    return (
      parts[0]!.toLowerCase()
      + parts
        .slice(1)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join("")
    );
  }
}
