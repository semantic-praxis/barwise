import { parse, stringify } from "yaml";
import {
  type Constraint,
  type ExternalConstraint,
  isExternalConstraint,
  isInternalConstraint,
  placementOf,
} from "../model/Constraint.js";
import { storePreferredFlags } from "../model/identification.js";
import { OrmModel } from "../model/OrmModel.js";
import { withDerivedIds } from "./derivedId.js";
import { type SchemaValidationResult, SchemaValidator } from "./SchemaValidator.js";
import {
  applyMigrations,
  compareOrmVersions,
  CURRENT_ORM_VERSION,
  LEGACY_ORM_VERSION,
  type MigrationPlan,
  planMigration,
} from "./schemaVersion.js";
import { subtypeConstraintsFromFlags } from "./subtypeFlags.js";
import { deserializeConstraint, serializeConstraint } from "./yaml/constraint.js";
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
    const { doc, version } = this.bringToReadableVersion(raw);

    // A 2.0 file is read by the 2.0 reader, against the 2.0 schema frozen
    // when 3.0 landed; a 3.0 file by the 3.0 reader. Reading 2.0 directly
    // into the model is the migration: the model is what both formats
    // state, and a 2.0 file saved writes 3.0 (orm-format-3 WS4b).
    if (version === LEGACY_ORM_VERSION) {
      this.check(this.validator.validateLegacyModel(doc));
      return readDocument20(doc as OrmYamlDocument, options);
    }
    if (version === CURRENT_ORM_VERSION) refuseMisplacedConstraints(doc);
    this.check(this.validator.validateModel(doc));
    return this.fromDocument(doc as OrmYamlDocument, options);
  }

  private check(result: SchemaValidationResult): void {
    if (!result.valid) {
      throw new DeserializationError(
        `YAML does not conform to orm-model schema: ${
          result.errors.map((e) => `${e.path}: ${e.message}`).join("; ")
        }`,
        result,
      );
    }
  }

  /**
   * Bring a freshly parsed document to a version a reader exists for:
   * 3.0, read as it is, or 2.0, which older documents migrate to first.
   *
   * Documents whose `orm_version` is missing or malformed are passed
   * through untouched so that schema validation reports those cases as it
   * always has. A present-but-unsupported version throws a
   * {@link DeserializationError} describing whether the file is too new or
   * simply unreachable.
   */
  private bringToReadableVersion(raw: unknown): { doc: unknown; version: unknown; } {
    if (typeof raw !== "object" || raw === null) return { doc: raw, version: undefined };
    const doc = raw as Record<string, unknown>;
    const version = doc.orm_version;
    if (typeof version !== "string" || version === CURRENT_ORM_VERSION) {
      return { doc: raw, version };
    }
    if (compareOrmVersions(version, CURRENT_ORM_VERSION) > 0) {
      throw new DeserializationError(versionErrorMessage(version, { ok: false, reason: "newer" }));
    }
    if (version === LEGACY_ORM_VERSION) return { doc: raw, version };
    // Between 2.0 and 3.0 there is nothing to read: no release wrote it.
    if (compareOrmVersions(version, LEGACY_ORM_VERSION) > 0) {
      throw new DeserializationError(
        versionErrorMessage(version, { ok: false, reason: "unknown" }),
      );
    }
    const plan = planMigration(version, LEGACY_ORM_VERSION);
    if (!plan.ok) {
      throw new DeserializationError(versionErrorMessage(version, plan));
    }
    return { doc: applyMigrations(doc, plan.steps), version: LEGACY_ORM_VERSION };
  }

  // -- Internal: model -> document --

  private toDocument(model: OrmModel): OrmYamlDocument {
    return writeDocument(model);
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

    for (const otDoc of doc.model.object_types ?? []) {
      model.addObjectType(deserializeObjectType(otDoc));
    }

    // Every constraint id is stated (the schema requires it) and is
    // model-wide: another element, another file, a diff or a merge names a
    // constraint by it, so two constraints sharing one is refused, naming it.
    const seen = new Set<string>();
    const claim = (c: { id?: string; }) => {
      if (c.id === undefined) return;
      if (seen.has(c.id)) {
        throw new DeserializationError(
          `Two constraints share the id "${c.id}"; a constraint id names one constraint.`,
        );
      }
      seen.add(c.id);
    };

    for (const ftDoc of doc.model.fact_types ?? []) {
      const { config, constraints } = deserializeFactType(ftDoc);
      constraints.forEach(claim);
      model.addFactType(
        { ...config, constraints: constraints.filter(isInternalConstraint) },
        { skipPlayerValidation: options?.lenient },
      );
    }

    for (const sfDoc of doc.model.subtype_facts ?? []) {
      model.addSubtypeFact(
        deserializeSubtypeFact(sfDoc),
        { skipPlayerValidation: options?.lenient },
      );
    }

    for (const cDoc of doc.model.constraints ?? []) {
      const c = deserializeConstraint(cDoc);
      claim(c);
      if (isExternalConstraint(c)) model.addConstraint(c);
    }

    // After every constraint, so a reference resolves whatever order the
    // file lists them in. A reference to a constraint that does not exist,
    // or does not identify the entity, is validation's to report.
    for (const otDoc of doc.model.object_types ?? []) {
      if (otDoc.kind === "entity" && otDoc.preferred_identifier !== undefined) {
        model.setPreferredIdentifier(otDoc.id, otDoc.preferred_identifier);
      }
    }

    readTail(model, doc, options);
    return model;
  }
}

/**
 * The parts of a document both readers read alike: objectifications,
 * populations, definitions and diagrams.
 */
function readTail(model: OrmModel, doc: OrmYamlDocument, options?: { lenient?: boolean; }): void {
  for (const oftDoc of doc.model.objectified_fact_types ?? []) {
    model.addObjectifiedFactType(
      deserializeObjectifiedFactType(oftDoc),
      { skipPlayerValidation: options?.lenient },
    );
  }
  for (const popDoc of doc.model.populations ?? []) {
    const pop = model.addPopulation(
      deserializePopulation(popDoc),
      { skipPlayerValidation: options?.lenient },
    );
    for (const instDoc of popDoc.instances) {
      pop.addInstance(deserializeFactInstance(instDoc));
    }
  }
  for (const defDoc of doc.model.definitions ?? []) {
    model.addDefinition(deserializeDefinition(defDoc));
  }
  for (const dlDoc of doc.model.diagrams ?? []) {
    model.addDiagramLayout(deserializeDiagramLayout(dlDoc));
  }
}

/**
 * The 3.0 document for a model (orm-format-3, Target architecture): each
 * fact type with its own constraints, the model's constraints in one list,
 * and each entity's preferred identifier by constraint id.
 */
export function writeDocument(model: OrmModel): OrmYamlDocument {
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
    doc.model.object_types = objectTypes.map((ot) =>
      serializeObjectType(ot, model.preferredIdentifierOf(ot.id))
    );
  }

  const factTypes = model.factTypes;
  if (factTypes.length > 0) {
    doc.model.fact_types = factTypes.map((ft) => serializeFactType(ft));
  }

  if (model.constraints.length > 0) {
    doc.model.constraints = model.constraints.map((c) => serializeConstraint(c));
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

/**
 * Refuse a 3.0 document that puts a constraint where its kind does not
 * live, naming the constraint and where it belongs. The schema refuses
 * both too, as a `oneOf` mismatch that names neither.
 */
function refuseMisplacedConstraints(raw: unknown): void {
  const model = (raw as { model?: { fact_types?: unknown; constraints?: unknown; }; })?.model;
  if (typeof model !== "object" || model === null) return;
  const name = (c: { id?: unknown; type?: unknown; }) =>
    `The ${String(c.type)} constraint${typeof c.id === "string" ? ` "${c.id}"` : ""}`;
  const fts = Array.isArray(model.fact_types) ? model.fact_types : [];
  for (const ft of fts as { name?: unknown; constraints?: unknown; }[]) {
    for (const c of Array.isArray(ft?.constraints) ? ft.constraints : []) {
      if (isPlacedKind(c, "external")) {
        throw new DeserializationError(
          `${name(c)} is listed under fact type "${String(ft.name)}", but its kind lives in the `
            + "model: move it to model.constraints.",
        );
      }
    }
  }
  for (const c of Array.isArray(model.constraints) ? model.constraints : []) {
    if (isPlacedKind(c, "internal")) {
      throw new DeserializationError(
        `${name(c)} is listed in model.constraints, but its kind lives in its fact type: `
          + "move it under the fact type whose roles it names.",
      );
    }
  }
}

/** `c` without the 2.0 flag `readDocument20` adds for deriving its id. */
function withoutFlag(c: Constraint): Constraint {
  const { isPreferred: _, ...rest } = c as Constraint & { isPreferred?: boolean; };
  return rest as Constraint;
}

function isPlacedKind(c: unknown, where: "internal" | "external"): c is { type: string; } {
  if (typeof c !== "object" || c === null) return false;
  const type = (c as { type?: unknown; }).type;
  return typeof type === "string" && placementOf(type) === where;
}

/**
 * Read a 2.0 document into the model: what 3.0 states, from how 2.0 states
 * it (orm-format-3, the migration's steps 1 to 4).
 *
 * - An id a constraint omits is derived from its fact type and content
 *   (step 1, `withDerivedIds`), so one unchanged file loads to the same
 *   ids every time.
 * - A constraint across fact types, nested under one of its fact types,
 *   is stored on the model (step 2).
 * - The subtype flags become constraints over the subtype facts (step 3,
 *   `subtypeConstraintsFromFlags`).
 * - Each `is_preferred` flag names the entity it identifies, by Open
 *   decision 8's rule (step 4, `storePreferredFlags`). A flag that names
 *   no entity is dropped; two naming one entity resolve as that rule says.
 */
export function readDocument20(doc: OrmYamlDocument, options?: { lenient?: boolean; }): OrmModel {
  const model = new OrmModel({
    name: doc.model.name,
    domainContext: doc.model.domain_context,
    note: doc.model.note,
  });

  for (const otDoc of doc.model.object_types ?? []) {
    model.addObjectType(deserializeObjectType(otDoc));
  }

  const fts = doc.model.fact_types ?? [];
  const factTypes = fts.map(deserializeFactType);
  // Every id the file states, then each one derived as it is.
  const takenConstraintIds = new Set(
    factTypes.flatMap((ft) => ft.constraints.flatMap((c) => c.id === undefined ? [] : [c.id])),
  );
  const across: ExternalConstraint[] = [];
  const flagged = new Set<string>();
  factTypes.forEach(({ config, constraints }, at) => {
    // The list is the file's, position for position. A flag is part of the
    // content an id is derived from, as it was when the model held it, so
    // a 2.0 file that omits ids loads to the ids earlier releases gave it;
    // the field is dropped again once the id is fixed.
    const isFlagged = (fts[at]!.constraints ?? []).map((cDoc) =>
      (cDoc as { is_preferred?: boolean; }).is_preferred === true
    );
    const derived = withDerivedIds(
      config.id!,
      constraints.map((
        c,
        k,
      ) => (isFlagged[k] ? { ...c, isPreferred: true } as unknown as Constraint : c)),
      takenConstraintIds,
    ).map((c, k) => (isFlagged[k] ? withoutFlag(c) : c));
    derived.forEach((c, k) => {
      if (isFlagged[k] && c.id !== undefined) flagged.add(c.id);
    });
    model.addFactType(
      { ...config, constraints: derived.filter(isInternalConstraint) },
      { skipPlayerValidation: options?.lenient },
    );
    across.push(...derived.filter(isExternalConstraint));
  });
  for (const c of across) model.addConstraint(c);

  for (const sfDoc of doc.model.subtype_facts ?? []) {
    model.addSubtypeFact(
      deserializeSubtypeFact(sfDoc),
      { skipPlayerValidation: options?.lenient },
    );
  }
  for (const c of subtypeConstraintsFromFlags(doc.model.subtype_facts ?? [])) {
    model.addConstraint(c);
  }

  // Objectifications before the flags: an objectified fact type's flag
  // names the objectifying type.
  readTail(model, doc, options);
  storePreferredFlags(model, (c) => c.id !== undefined && flagged.has(c.id));
  return model;
}
