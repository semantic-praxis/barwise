import { parse, stringify } from "yaml";
import { OrmModel } from "../model/OrmModel.js";
import { type SchemaValidationResult, SchemaValidator } from "./SchemaValidator.js";
import {
  applyMigrations,
  CURRENT_ORM_VERSION,
  type MigrationPlan,
  planMigration,
} from "./schemaVersion.js";
import { deserializeDefinition, serializeDefinition } from "./yaml/definition.js";
import { deserializeDiagramLayout, serializeDiagramLayout } from "./yaml/diagram.js";
import type { OrmYamlDocument } from "./yaml/document.js";
import { deserializeFactType, serializeFactType } from "./yaml/factType.js";
import {
  deserializeObjectifiedFactType,
  serializeObjectifiedFactType,
} from "./yaml/objectified.js";
import { deserializeObjectType, serializeObjectType } from "./yaml/objectType.js";
import {
  deserializeFactInstance,
  deserializePopulation,
  serializePopulation,
} from "./yaml/population.js";
import { deserializeSubtypeFact, serializeSubtypeFact } from "./yaml/subtype.js";

/**
 * Error thrown when deserialization fails due to schema validation
 * or model construction errors.
 */
export class DeserializationError extends Error {
  constructor(
    message: string,
    readonly validationResult?: SchemaValidationResult,
  ) {
    super(message);
    this.name = "DeserializationError";
  }
}

/**
 * Build a clear, actionable message for a document whose `orm_version`
 * cannot be brought to the current version.
 */
function versionErrorMessage(
  version: string,
  plan: Extract<MigrationPlan, { ok: false; }>,
): string {
  const advice = {
    newer: "the file was written by a newer barwise; upgrade barwise to read it.",
    unknown: "no migration path is available; re-export from a compatible version.",
    cycle: "the migration registry loops back on itself, which is a bug in barwise.",
  };
  const head = `Unsupported orm_version "${version}" (this build reads ${CURRENT_ORM_VERSION}):`;
  return `${head} ${advice[plan.reason]}`;
}

/**
 * Serializes OrmModel instances to YAML strings and deserializes
 * YAML strings back to OrmModel instances.
 *
 * The serializer produces YAML that conforms to the orm-model.schema.json
 * schema. The deserializer validates incoming YAML against the schema
 * before constructing the model.
 */
export class OrmYamlSerializer {
  private readonly validator = new SchemaValidator();

  /**
   * Serialize an OrmModel to a YAML string.
   *
   * The output includes the orm_version header and conforms to
   * the orm-model.schema.json schema.
   */
  serialize(model: OrmModel): string {
    const doc = this.toDocument(model);
    return stringify(doc, { lineWidth: 0 });
  }

  /**
   * Deserialize a YAML string into an OrmModel.
   *
   * The YAML is first validated against the JSON Schema. If validation
   * fails, a DeserializationError is thrown with the validation errors.
   *
   * The model is then constructed from the validated document. Construction
   * errors (e.g. referential integrity violations) are thrown as
   * DeserializationError.
   */
  /**
   * @param yaml - The YAML string to deserialize.
   * @param options - Optional settings.
   * @param options.lenient - When true, skip role player reference
   *   validation.  Used for merge fragments that reference types from
   *   a base model not present in the fragment.
   */
  deserialize(yaml: string, options?: { lenient?: boolean; }): OrmModel {
    const raw = parse(yaml) as unknown;

    // Bring older documents up to the current version before schema
    // validation, and reject unsupported versions with a clear message
    // rather than the schema's cryptic `const` mismatch.
    const migrated = this.migrateToCurrentVersion(raw);

    const result = this.validator.validateModel(migrated);
    if (!result.valid) {
      throw new DeserializationError(
        `YAML does not conform to orm-model schema: ${
          result.errors.map((e) => `${e.path}: ${e.message}`).join("; ")
        }`,
        result,
      );
    }

    const doc = migrated as OrmYamlDocument;
    return this.fromDocument(doc, options);
  }

  /**
   * Migrate a freshly parsed document to {@link CURRENT_ORM_VERSION}.
   *
   * Documents already at the current version, and documents whose
   * `orm_version` is missing or malformed, are passed through untouched
   * so that schema validation reports those cases as it always has.
   * A present-but-unsupported version throws a {@link DeserializationError}
   * describing whether the file is too new or simply unreachable.
   */
  private migrateToCurrentVersion(raw: unknown): unknown {
    if (typeof raw !== "object" || raw === null) {
      return raw;
    }
    const doc = raw as Record<string, unknown>;
    const version = doc.orm_version;
    if (typeof version !== "string" || version === CURRENT_ORM_VERSION) {
      return raw;
    }

    const plan = planMigration(version);
    if (!plan.ok) {
      throw new DeserializationError(versionErrorMessage(version, plan));
    }
    return applyMigrations(doc, plan.steps);
  }

  // -- Internal: model -> document --

  private toDocument(model: OrmModel): OrmYamlDocument {
    const doc: OrmYamlDocument = {
      orm_version: CURRENT_ORM_VERSION,
      model: {
        name: model.name,
      },
    };

    if (model.domainContext) {
      doc.model.domain_context = model.domainContext;
    }
    if (model.note) {
      doc.model.note = model.note;
    }

    const objectTypes = model.objectTypes;
    if (objectTypes.length > 0) {
      doc.model.object_types = objectTypes.map((ot) => serializeObjectType(ot));
    }

    const factTypes = model.factTypes;
    if (factTypes.length > 0) {
      doc.model.fact_types = factTypes.map((ft) => serializeFactType(ft));
    }

    const subtypeFacts = model.subtypeFacts;
    if (subtypeFacts.length > 0) {
      doc.model.subtype_facts = subtypeFacts.map((sf) => serializeSubtypeFact(sf));
    }

    const objectifiedFactTypes = model.objectifiedFactTypes;
    if (objectifiedFactTypes.length > 0) {
      doc.model.objectified_fact_types = objectifiedFactTypes.map((oft) =>
        serializeObjectifiedFactType(oft)
      );
    }

    const populations = model.populations;
    if (populations.length > 0) {
      doc.model.populations = populations.map((p) => serializePopulation(p));
    }

    const definitions = model.definitions;
    if (definitions.length > 0) {
      doc.model.definitions = definitions.map((d) => serializeDefinition(d));
    }

    const diagrams = model.diagramLayouts;
    if (diagrams.length > 0) {
      doc.model.diagrams = diagrams.map((dl) => serializeDiagramLayout(dl));
    }

    return doc;
  }

  // -- Internal: document -> model --

  private fromDocument(
    doc: OrmYamlDocument,
    options?: { lenient?: boolean; },
  ): OrmModel {
    const model = new OrmModel({
      name: doc.model.name,
      domainContext: doc.model.domain_context,
      note: doc.model.note,
    });

    // Add object types first (fact types reference them).
    for (const otDoc of doc.model.object_types ?? []) {
      model.addObjectType(deserializeObjectType(otDoc));
    }

    // Add fact types.
    for (const ftDoc of doc.model.fact_types ?? []) {
      model.addFactType(
        deserializeFactType(ftDoc),
        { skipPlayerValidation: options?.lenient },
      );
    }

    // Add subtype facts (after object types and fact types).
    for (const sfDoc of doc.model.subtype_facts ?? []) {
      model.addSubtypeFact(
        deserializeSubtypeFact(sfDoc),
        { skipPlayerValidation: options?.lenient },
      );
    }

    // Add objectified fact types (after object types and fact types).
    for (const oftDoc of doc.model.objectified_fact_types ?? []) {
      model.addObjectifiedFactType(deserializeObjectifiedFactType(oftDoc));
    }

    // Add populations (after fact types, since they reference them).
    for (const popDoc of doc.model.populations ?? []) {
      const pop = model.addPopulation(deserializePopulation(popDoc));
      for (const instDoc of popDoc.instances) {
        pop.addInstance(deserializeFactInstance(instDoc));
      }
    }

    // Add definitions.
    for (const defDoc of doc.model.definitions ?? []) {
      model.addDefinition(deserializeDefinition(defDoc));
    }

    // Add diagram layouts.
    for (const dlDoc of doc.model.diagrams ?? []) {
      model.addDiagramLayout(deserializeDiagramLayout(dlDoc));
    }

    return model;
  }
}
