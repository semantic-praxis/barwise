import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import * as Effect from "effect/Effect";
import { parse, stringify } from "yaml";
import ormModelSchema from "../../schemas/orm-model.schema.json" with { type: "json" };
import type { Constraint } from "../model/Constraint.js";
import { decodeConstraints } from "../model/constraintDecoder.js";
import { generateId } from "../model/id.js";
import type { ObjectType } from "../model/ObjectType.js";
import { decodeObjectTypes } from "../model/objectTypeDecoder.js";
import { OrmModel } from "../model/OrmModel.js";
import {
  type SchemaError,
  schemaErrorOf,
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

/** Every fact type's constraints, decoded, and every problem with them. */
interface DecodedConstraints {
  /** By fact type position; a fact type with any bad constraint is absent. */
  readonly byFactType: ReadonlyMap<number, readonly Constraint[]>;
  readonly problems: readonly SchemaError[];
  /** Each constraint the decoder found a problem in, by `f/c`. */
  readonly refused: ReadonlyMap<string, RefusedConstraint>;
}

interface RefusedConstraint {
  readonly raw: unknown;
  /** What the decoder's problems call this constraint; kept errors say it too. */
  readonly subject: string;
  /** Where the decoder reported, as JSON pointers below the constraint. */
  readonly reported: ReadonlySet<string>;
}

/**
 * Decode every constraint of every fact type, filling a missing or empty id
 * first: the file format lets a constraint omit its id, and decision 8 puts
 * the fill at the loader, not in the decoder. Like the object types, this
 * runs whatever the JSON Schema said, so a file's constraint problems are
 * reported with everything else.
 */
function decodeConstraintsOf(doc: unknown): DecodedConstraints {
  const byFactType = new Map<number, readonly Constraint[]>();
  const problems: SchemaError[] = [];
  const refused = new Map<string, RefusedConstraint>();
  const list = (doc as { model?: { fact_types?: unknown; }; } | null)?.model?.fact_types;
  if (!Array.isArray(list)) return { byFactType, problems, refused };
  // Every fact type in one run, so a load starts one fiber, not one per fact type.
  const decodedLists = Effect.runSync(
    Effect.forEach(list, (ft: unknown, f) => {
      const docs = ft !== null && typeof ft === "object"
        ? (ft as { constraints?: unknown; }).constraints
        : undefined;
      return Array.isArray(docs)
        ? decodeConstraints(docs, factTypeLabel(ft as object, f), generateId)
        : Effect.succeed(undefined);
    }),
  );
  decodedLists.forEach((results, f) => {
    if (results === undefined) return;
    const docs = (list[f] as { constraints: readonly unknown[]; }).constraints;
    const decoded: Constraint[] = [];
    results.forEach((result, c) => {
      if (result._tag === "Success") {
        decoded.push(result.success as Constraint);
        return;
      }
      const reported = new Set<string>();
      for (const problem of result.failure.problems) {
        const below = problem.path.map((k) => `/${pointerSegment(k)}`).join("");
        reported.add(below);
        problems.push({
          path: `/model/fact_types/${f}/constraints/${c}${below}`,
          message: problem.message,
        });
      }
      refused.set(`${f}/${c}`, {
        raw: docs[c],
        subject: result.failure.subject,
        reported,
      });
    });
    if (decoded.length === results.length) byFactType.set(f, decoded);
  });
  return { byFactType, problems, refused };
}

/** A JSON Pointer segment, escaped as ajv's `instancePath` escapes it. */
function pointerSegment(key: PropertyKey): string {
  return String(key).replace(/~/g, "~0").replace(/\//g, "~1");
}

/** What a constraint's problem calls its fact type: name, id, or position. */
function factTypeLabel(ft: object, index: number): string {
  const { name, id } = ft as { name?: unknown; id?: unknown; };
  if (typeof name === "string" && name.trim() !== "") return `Fact type "${name.trim()}"`;
  if (typeof id === "string" && id !== "") return `Fact type with id "${id}"`;
  return `Fact type at fact_types/${index}`;
}

/**
 * The schema's errors with the decoder's constraint problems in their place,
 * on each constraint the decoder refused.
 *
 * The whole-document check reports a bad constraint once per `oneOf` branch
 * it failed -- 56 errors for one constraint missing a field, none naming the
 * kind it was meant to be. So on a constraint the decoder refused, those are
 * dropped, and the constraint is checked again against its own kind's branch
 * of the schema alone. Every error from that check the decoder did not report
 * at the same place is kept: through the mapping the whole-document check
 * uses, so with the same rule, but worded with the subject the decoder gave
 * the constraint and the field below it, in the words the decoder uses
 * (`problemWording.ts`).
 *
 * A constraint the decoder accepted keeps every schema error on it. The load
 * is refused either way.
 *
 * "Reported at the same place" does not compare rules, because the decoder's
 * problems do not carry one: an error at a place the decoder reported is
 * taken as said. So a schema rule is lost only if the decoder stops stating
 * it AND reports something else at that same place. The first half is what
 * the decoder's field-by-field test against this schema fails on.
 */
function mergeConstraintProblems(
  schemaErrors: readonly SchemaError[],
  decoded: DecodedConstraints,
  document: unknown,
): SchemaError[] {
  const owned = (e: SchemaError) => {
    const match = CONSTRAINT_PATH.exec(e.path);
    return match !== null && decoded.refused.has(`${match[1]}/${match[2]}`);
  };
  const kept: SchemaError[] = [];
  for (const [key, refused] of decoded.refused) {
    const [f, c] = key.split("/");
    for (const error of unreportedBranchErrors(refused)) {
      kept.push(
        schemaErrorOf(error, document, `/model/fact_types/${f}/constraints/${c}`, refused.subject),
      );
    }
  }
  return [...schemaErrors.filter((e) => !owned(e)), ...decoded.problems, ...kept];
}

const CONSTRAINT_PATH = /^\/model\/fact_types\/(\d+)\/constraints\/(\d+)(?:\/|$)/;

type ConstraintBranch = { readonly properties: { readonly type: { readonly const: string; }; }; };
const constraintSchemas = ormModelSchema as {
  definitions: { constraint: { oneOf: readonly ConstraintBranch[]; }; };
};

/** One validator per constraint kind, compiled on first use: most loads refuse nothing. */
let branchValidators: ReadonlyMap<string, ValidateFunction> | undefined;

function branchValidator(type: unknown): ValidateFunction | undefined {
  if (typeof type !== "string") return undefined;
  branchValidators ??= (() => {
    const ajv = new Ajv({ allErrors: true });
    const { definitions } = constraintSchemas;
    const constraintLevel = Object.fromEntries(
      Object.entries(definitions.constraint).filter(([keyword]) => keyword !== "oneOf"),
    );
    return new Map(
      definitions.constraint.oneOf.map((branch) => [
        branch.properties.type.const,
        // The constraint definition's own keywords beside `oneOf` apply to
        // every kind, so they are checked with the branch, not restated.
        // `type: object` at the root as well: strict mode reads each allOf
        // member on its own and printed a warning per branch to the console.
        ajv.compile({ definitions, type: "object", allOf: [constraintLevel, branch] }),
      ]),
    );
  })();
  return branchValidators.get(type);
}

/**
 * The errors of a refused constraint's own branch that the decoder did not
 * report. A constraint whose type names no kind, or that is not a mapping,
 * has no branch: the decoder's report of that is the whole story.
 *
 * Covered means reported at the same place: at the error's own path; for a
 * missing or unknown key, at that key; and for a "one of these keys" rule,
 * at the place itself or at any of its keys.
 */
function unreportedBranchErrors(refused: RefusedConstraint): ErrorObject[] {
  const raw = refused.raw;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return [];
  const validate = branchValidator((raw as { type?: unknown; }).type);
  if (validate === undefined || validate(raw)) return [];
  const errors = validate.errors ?? [];
  const at = refused.reported;
  // An anyOf's keys, by the place and schema path of the anyOf.
  const groupOf = (e: ErrorObject) => {
    const cut = e.schemaPath.lastIndexOf("/anyOf");
    return cut < 0 ? undefined : `${e.instancePath}|${e.schemaPath.slice(0, cut)}`;
  };
  const groupKeys = new Map<string, string[]>();
  for (const e of errors) {
    const group = groupOf(e);
    const missing = (e.params as { missingProperty?: string; }).missingProperty;
    if (group !== undefined && missing !== undefined) {
      groupKeys.set(group, [...(groupKeys.get(group) ?? []), missing]);
    }
  }
  const covered = (e: ErrorObject) => {
    const params = e.params as { missingProperty?: string; additionalProperty?: string; };
    const group = groupOf(e);
    if (group !== undefined) {
      return at.has(e.instancePath)
        || (groupKeys.get(group) ?? []).some((k) =>
          at.has(`${e.instancePath}/${pointerSegment(k)}`)
        );
    }
    if (params.missingProperty !== undefined) {
      return at.has(`${e.instancePath}/${pointerSegment(params.missingProperty)}`);
    }
    if (params.additionalProperty !== undefined) {
      return at.has(`${e.instancePath}/${pointerSegment(params.additionalProperty)}`);
    }
    return at.has(e.instancePath);
  };
  return errors.filter((e) => !covered(e));
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
    const constraints = decodeConstraintsOf(migrated);
    const errors = mergeConstraintProblems(
      mergeObjectTypeProblems(result.errors, objectTypes.problems),
      constraints,
      migrated,
    );
    if (errors.length > 0) {
      const head = result.valid
        ? "YAML holds malformed object types or constraints"
        : "YAML does not conform to orm-model schema";
      throw new DeserializationError(
        `${head}: ${errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`,
        { valid: false, errors },
      );
    }

    const doc = migrated as OrmYamlDocument;
    return this.fromDocument(doc, objectTypes.decoded, constraints.byFactType, options);
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
    constraints: ReadonlyMap<number, readonly Constraint[]>,
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
    // Their constraints are already decoded, ids filled, so the fact type is
    // read without them rather than having `deserializeConstraint` mint a
    // second set of ids.
    (doc.model.fact_types ?? []).forEach((ftDoc, f) => {
      model.addFactType(
        {
          ...deserializeFactType({ ...ftDoc, constraints: [] }),
          constraints: [...(constraints.get(f) ?? [])],
        },
        { skipPlayerValidation: options?.lenient },
      );
    });

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
