import { Ajv, type ErrorObject } from "ajv";
import { parse, stringify } from "yaml";
import mappingSchema from "../../schemas/context-mapping.schema.json" with { type: "json" };
import {
  ContextMapping,
  type ContextMappingConfig,
  type MappingPattern,
} from "../model/ContextMapping.js";
import type { EntityMappingConfig } from "../model/EntityMapping.js";
import type { SemanticConflictConfig } from "../model/SemanticConflict.js";
import { formatVersionProblem } from "./schemaVersion.js";

/**
 * The `format_version` this build reads and writes for `.map.yaml`. The
 * serializer stamps it on every mapping file, and the schema pins its
 * `const` to the same value (iri-identity WS4, barwise-y1b).
 */
export const CURRENT_MAPPING_FORMAT_VERSION = "1.0";

/**
 * The shape of a parsed .map.yaml document.
 */
interface MappingYamlDocument {
  format_version?: string;
  mapping: {
    source_context: string;
    target_context: string;
    pattern: string;
    entity_mappings?: Array<{
      source_object_type: string;
      target_object_type: string;
      description?: string;
    }>;
    semantic_conflicts?: Array<{
      term: string;
      source_meaning: string;
      target_meaning: string;
      resolution: string;
    }>;
  };
}

/**
 * Serializes and deserializes ContextMapping instances to/from
 * .map.yaml format.
 */
export class MappingSerializer {
  private readonly validate;

  constructor() {
    const ajv = new Ajv({ allErrors: true });
    this.validate = ajv.compile(mappingSchema);
  }

  /**
   * Serialize a ContextMapping to YAML.
   */
  serialize(mapping: ContextMapping): string {
    const doc: MappingYamlDocument = {
      format_version: CURRENT_MAPPING_FORMAT_VERSION,
      mapping: {
        source_context: mapping.sourceContext,
        target_context: mapping.targetContext,
        pattern: mapping.pattern,
      },
    };

    if (mapping.entityMappings.length > 0) {
      doc.mapping.entity_mappings = mapping.entityMappings.map(
        (em) => ({
          source_object_type: em.sourceObjectType,
          target_object_type: em.targetObjectType,
          ...(em.description ? { description: em.description } : {}),
        }),
      );
    }

    if (mapping.semanticConflicts.length > 0) {
      doc.mapping.semantic_conflicts = mapping.semanticConflicts.map(
        (sc) => ({
          term: sc.term,
          source_meaning: sc.sourceMeaning,
          target_meaning: sc.targetMeaning,
          resolution: sc.resolution,
        }),
      );
    }

    return stringify(doc);
  }

  /**
   * Deserialize a YAML string into a ContextMapping.
   *
   * @param yaml - The .map.yaml content.
   * @param path - The file path (for the ContextMapping.path field).
   * @throws {MappingDeserializationError} if the YAML is invalid.
   */
  deserialize(yaml: string, path: string): ContextMapping {
    let parsed: unknown;
    try {
      parsed = parse(yaml);
    } catch (err) {
      throw new MappingDeserializationError(
        `Invalid YAML: ${(err as Error).message}`,
      );
    }

    const versionProblem = formatVersionProblem(parsed, CURRENT_MAPPING_FORMAT_VERSION);
    if (versionProblem) throw new MappingDeserializationError(versionProblem);

    const valid = this.validate(parsed);
    if (!valid) {
      const messages = (this.validate.errors ?? [])
        .map(
          (e: ErrorObject) => `${e.instancePath || "/"}: ${e.message ?? "unknown error"}`,
        )
        .join("; ");
      throw new MappingDeserializationError(
        `Schema validation failed: ${messages}`,
      );
    }

    const doc = parsed as MappingYamlDocument;
    return this.buildMapping(doc, path);
  }

  private buildMapping(
    doc: MappingYamlDocument,
    path: string,
  ): ContextMapping {
    const entityMappings: EntityMappingConfig[] = (
      doc.mapping.entity_mappings ?? []
    ).map((em) => ({
      sourceObjectType: em.source_object_type,
      targetObjectType: em.target_object_type,
      description: em.description,
    }));

    const semanticConflicts: SemanticConflictConfig[] = (
      doc.mapping.semantic_conflicts ?? []
    ).map((sc) => ({
      term: sc.term,
      sourceMeaning: sc.source_meaning,
      targetMeaning: sc.target_meaning,
      resolution: sc.resolution,
    }));

    const config: ContextMappingConfig = {
      path,
      sourceContext: doc.mapping.source_context,
      targetContext: doc.mapping.target_context,
      pattern: doc.mapping.pattern as MappingPattern,
      entityMappings,
      semanticConflicts,
    };

    return new ContextMapping(config);
  }
}

/**
 * Error thrown when mapping deserialization fails.
 */
export class MappingDeserializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MappingDeserializationError";
  }
}
