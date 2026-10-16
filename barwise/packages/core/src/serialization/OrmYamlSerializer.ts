import * as Effect from "effect/Effect";
import { parse, stringify } from "yaml";
import ormModelSchema from "../../schemas/orm-model.schema.json" with { type: "json" };
import type { ObjectType } from "../model/ObjectType.js";
import { decodeObjectTypes } from "../model/objectTypeDecoder.js";
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

/** One object type's problem, located by its position in the file. */
interface LocatedProblem {
  readonly index: number;
  readonly error: SchemaError;
}

/**
 * Decode every object type in a parsed document, whatever the JSON Schema
 * said about the document. Before, a schema error stopped the load before
 * any object type was built, so a cardinality with `max < min` was reported
 * only once the schema errors elsewhere were fixed. A document without an
 * `object_types` list has nothing to decode, and the schema check says why.
 */
function decodeObjectTypesOf(
  doc: unknown,
): { readonly decoded: ObjectType[]; readonly problems: LocatedProblem[]; } {
  const list = (doc as { model?: { object_types?: unknown; }; } | null)?.model?.object_types;
  if (!Array.isArray(list)) return { decoded: [], problems: [] };
  const decoded: ObjectType[] = [];
  const problems: LocatedProblem[] = [];
  Effect.runSync(decodeObjectTypes(list)).forEach((result, index) => {
    if (result._tag === "Success") {
      decoded.push(result.success);
      return;
    }
    for (const problem of result.failure.problems) {
      const path = `/model/object_types/${index}${problem.field ? `/${problem.field}` : ""}`;
      problems.push({ index, error: { path, message: problem.message } });
    }
  });
  return { decoded, problems };
}

/**
 * An object type's path: its index, the field under it if any, and whatever
 * sits below that field.
 */
const OBJECT_TYPE_PATH = /^\/model\/object_types\/(\d+)(?:\/([^/]+)(\/.*)?)?$/;
/**
 * The fields an object type's `then` branch (the entity variant) governs,
 * read from the schema rather than restated: it requires reference_mode and
 * forbids the value-only fields. When the decoder names any of them, the
 * schema's failed `then` says the same thing.
 */
const THEN_FIELDS: readonly string[] = (() => {
  const then = (ormModelSchema as {
    definitions: { object_type: { then: { required?: string[]; properties?: object; }; }; };
  }).definitions.object_type.then;
  return [...(then.required ?? []), ...Object.keys(then.properties ?? {})];
})();

/**
 * The schema's errors and the decoder's problems as one list.
 *
 * The decoder names top-level fields only, so a schema error is dropped only
 * when the decoder has replaced it: a field-level error at exactly a field the
 * decoder names, a required-property or unknown-property error for a property the
 * decoder names, or an entity's failed `then` branch when the decoder names a field that
 * branch governs. Errors are matched on ajv's rule, not its wording.
 * Deeper errors inside a field are kept, because the decoder cannot say which
 * nested rule it replaced: a duplicate costs a line, a dropped rule is silent.
 * Everything else at an object type's root stands, so a bare list entry keeps
 * the schema's "must be object". A missing `id` is the decoder's to report,
 * since it requires every id, and its problem replaces the schema's.
 */
function mergeObjectTypeProblems(
  schemaErrors: readonly SchemaError[],
  problems: readonly LocatedProblem[],
): SchemaError[] {
  const named = new Set<string>();
  for (const { index, error } of problems) {
    const field = OBJECT_TYPE_PATH.exec(error.path)?.[2];
    if (field !== undefined) named.add(`${index}/${field}`);
  }
  const covered = (error: SchemaError) => {
    const match = OBJECT_TYPE_PATH.exec(error.path);
    if (match === null) return false;
    const index = Number(match[1]);
    const [, , field, below] = match;
    if (field !== undefined) return below === undefined && named.has(`${index}/${field}`);
    const rule = error.rule;
    if (rule?.keyword === "required" && rule.missingProperty !== undefined) {
      return named.has(`${index}/${rule.missingProperty}`);
    }
    if (rule?.keyword === "additionalProperties" && rule.additionalProperty !== undefined) {
      return named.has(`${index}/${rule.additionalProperty}`);
    }
    if (rule?.keyword === "if" && rule.failingKeyword === "then") {
      return THEN_FIELDS.some((f) => named.has(`${index}/${f}`));
    }
    return false;
  };
  return [...schemaErrors.filter((e) => !covered(e)), ...problems.map((p) => p.error)];
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
    const objectTypes = decodeObjectTypesOf(migrated);
    const errors = mergeObjectTypeProblems(result.errors, objectTypes.problems);
    if (errors.length > 0) {
      const head = result.valid
        ? "YAML holds malformed object types"
        : "YAML does not conform to orm-model schema";
      throw new DeserializationError(
        `${head}: ${errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`,
        { valid: false, errors },
      );
    }

    const doc = migrated as OrmYamlDocument;
    return this.fromDocument(doc, objectTypes.decoded, options);
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

    // Add object types first (fact types reference them). Already decoded, so
    // every problem in the file was reported together; `addObjectType` takes
    // the record as its config, which it is.
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
