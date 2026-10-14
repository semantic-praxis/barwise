import { parse, stringify } from "yaml";
import type { ObjectType } from "../model/ObjectType.js";
import { OrmModel } from "../model/OrmModel.js";
import {
  type SchemaError,
  type SchemaValidationResult,
  SchemaValidator,
} from "./SchemaValidator.js";
import {
  applyMigrations,
  CURRENT_ORM_VERSION,
  type MigrationPlan,
  planMigration,
} from "./schemaVersion.js";
import { decodeObjectType } from "./yaml/decodeObjectType.js";
import { deserializeDefinition, serializeDefinition } from "./yaml/definition.js";
import { deserializeDiagramLayout, serializeDiagramLayout } from "./yaml/diagram.js";
import type { OrmYamlDocument } from "./yaml/document.js";
import { deserializeFactType, serializeFactType } from "./yaml/factType.js";
import {
  deserializeObjectifiedFactType,
  serializeObjectifiedFactType,
} from "./yaml/objectified.js";
import { serializeObjectType } from "./yaml/objectType.js";
import {
  deserializeFactInstance,
  deserializePopulation,
  serializePopulation,
} from "./yaml/population.js";
import { deserializeSubtypeFact, serializeSubtypeFact } from "./yaml/subtype.js";

/**
 * Error thrown when deserialization fails due to schema validation
 * or model construction errors.
 *
 * `validationResult.errors` lists every problem found before construction,
 * one per entry: the JSON Schema's, and each object type's problems from
 * `decodeObjectType`, located by the same kind of JSON Pointer.
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
  /**
   * Compiled on first use, not in the constructor.
   *
   * Only `deserialize` validates, and `new Ajv().compile(ormModelSchema)`
   * costs about 34ms -- so every caller that constructs a serializer to
   * SERIALIZE paid for a validator it never touched. `hashModel` builds
   * one per call, which made the laws that hash a model twice per
   * generated case take 25s under coverage instrumentation and time out
   * at 120s under a parallel twelve-package run (barwise-939).
   */
  private validatorInstance?: SchemaValidator;

  private get validator(): SchemaValidator {
    this.validatorInstance ??= new SchemaValidator();
    return this.validatorInstance;
  }

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
   * The YAML is first validated against the JSON Schema, and each object
   * type is decoded by `decodeObjectType`. If either finds a problem, a
   * DeserializationError is thrown listing all of them.
   *
   * The model is then constructed from the validated document. Other
   * construction errors (e.g. referential integrity violations) are thrown
   * as they occur, as before.
   */
  /**
   * @param yaml - The YAML string to deserialize.
   * @param options - Optional settings.
   * @param options.lenient - When true, skip the constructor checks
   *   that a referenced element is present, on all FOUR kinds that make
   *   them: a fact type's role players, a subtype fact's endpoints, an
   *   objectification's object and fact types, and a population's fact
   *   type. It began as role players alone and was widened to the other
   *   three (barwise-977) so `ValidationEngine` could REPORT a dangling
   *   reference instead of the loader refusing the file.
   *
   *   Two callers, and the difference matters. `barwise merge` uses it
   *   for the incoming side, so a fragment may reference base elements
   *   it does not redefine. `barwise validate` uses it so a broken file
   *   is diagnosed rather than rejected -- which only works if nothing
   *   downstream quietly discards what it let through, and the merge
   *   used to (barwise-997).
   */
  deserialize(yaml: string, options?: { lenient?: boolean; }): OrmModel {
    const raw = parse(yaml) as unknown;

    // Bring older documents up to the current version before schema
    // validation, and reject unsupported versions with a clear message
    // rather than the schema's cryptic `const` mismatch.
    const migrated = this.migrateToCurrentVersion(raw);

    const result = this.validator.validateModel(migrated);
    const objectTypes = decodeObjectTypes(migrated);
    // The decoder checks everything the schema checks about an object type
    // and reports it naming the object type and the field, so the schema's
    // own errors inside an entry are dropped rather than reported twice.
    // Before, the schema's errors stopped the load, and the constructor's
    // checks on the same object types never ran (the D2 combined case in
    // docs/specs/effect-comparison.spec.md).
    const errors = [
      ...result.errors.filter((e) => !OBJECT_TYPE_ENTRY.test(e.path)),
      ...objectTypes.errors,
    ];
    if (errors.length > 0) {
      throw new DeserializationError(
        `YAML is not a valid ORM model: ${errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`,
        { valid: false, errors },
      );
    }

    const doc = migrated as OrmYamlDocument;
    return this.fromDocument(doc, objectTypes.values, options);
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
    objectTypes: readonly ObjectType[],
    options?: { lenient?: boolean; },
  ): OrmModel {
    const model = new OrmModel({
      name: doc.model.name,
      domainContext: doc.model.domain_context,
      note: doc.model.note,
    });

    // Add object types first (fact types reference them). A decoded record
    // is a valid config, so `addObjectType` rebuilds it to an equal value;
    // going through it keeps its duplicate-name check the only one.
    for (const ot of objectTypes) {
      model.addObjectType(ot);
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
      model.addObjectifiedFactType(
        deserializeObjectifiedFactType(oftDoc),
        { skipPlayerValidation: options?.lenient },
      );
    }

    // Add populations (after fact types, since they reference them).
    for (const popDoc of doc.model.populations ?? []) {
      const pop = model.addPopulation(
        deserializePopulation(popDoc),
        { skipPlayerValidation: options?.lenient },
      );
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

/** A JSON Pointer at or inside one entry of `model.object_types`. */
const OBJECT_TYPE_ENTRY = /^\/model\/object_types\/\d+(\/|$)/;

const escapePointer = (segment: string) => segment.replace(/~/g, "~0").replace(/\//g, "~1");

/**
 * Decode every object type in a parsed document, collecting each entry's
 * problems as errors located at the entry and field.
 *
 * Nothing is decoded when `object_types` is not a list; the schema reports
 * that. A file names every id -- fact types refer to object types by it --
 * so an entry without one is a problem here, where `addObjectType` would
 * mint one. The decoder is still given an id source, and for such an entry
 * may call it, but the load is refused before that id is used.
 */
function decodeObjectTypes(document: unknown): {
  values: ObjectType[];
  errors: SchemaError[];
} {
  const entries = (document as { model?: { object_types?: unknown; }; } | null)?.model
    ?.object_types;
  const values: ObjectType[] = [];
  const errors: SchemaError[] = [];
  if (!Array.isArray(entries)) return { values, errors };
  entries.forEach((entry: unknown, i) => {
    const at = (field: string) =>
      `/model/object_types/${i}${field === "" ? "" : `/${escapePointer(field)}`}`;
    if (typeof entry === "object" && entry !== null && !Array.isArray(entry) && !("id" in entry)) {
      const name = (entry as { name?: unknown; }).name;
      const who = typeof name === "string" && name.trim() !== ""
        ? `Object type "${name}"`
        : "An object type with no name";
      errors.push({ path: at("id"), message: `${who} must have an id.` });
    }
    const result = decodeObjectType(entry, () => "");
    if (result.ok) values.push(result.value);
    else errors.push(...result.problems.map((p) => ({ path: at(p.field), message: p.message })));
  });
  return { values, errors };
}
