import { parse, stringify } from "yaml";
import {
  type Constraint,
  describeConstraintRepeat,
  describeConstraintRepeats,
  type ExternalConstraint,
  isExternalConstraint,
  isInternalConstraint,
  placementOf,
} from "../model/Constraint.js";
import { type PlacedFlags, storePreferredFlags } from "../model/identification.js";
import { DuplicateIdError, OrmModel } from "../model/OrmModel.js";
import { groupRepeats } from "../util/groupRepeats.js";
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

/** What reading a file changed beyond its format (`OrmYamlSerializer.migrate`). */
export type MigrationNote =
  /** A 2.0 `is_preferred` flag that identifies no entity, so it was dropped. */
  | { readonly kind: "flag-dropped"; readonly factType: string; readonly constraintId: string; }
  /**
   * A file that names elements it does not define (`missing`, their ids:
   * a fragment, or a typo, loaded leniently) and carries `is_preferred`
   * flags. Whom a flag identifies can turn on what is missing (a player, an
   * objectification), so none is placed with confidence; this is the only
   * note such a file gets, and `barwise migrate` does not rewrite it.
   */
  | { readonly kind: "flags-unplaceable"; readonly missing: readonly string[]; }
  /** An entity two or more 2.0 flags named; the reference keeps `kept`. */
  | {
    readonly kind: "identifier-chosen";
    readonly entity: string;
    readonly kept: string;
    readonly others: readonly string[];
  };

/** A file read into the model, with the version it stated and its notes. */
export interface MigrationResult {
  readonly model: OrmModel;
  /** The `orm_version` the file stated; a file without one fails to load. */
  readonly from: string;
  readonly notes: readonly MigrationNote[];
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
    return this.migrate(yaml, options).model;
  }

  /**
   * `deserialize`, saying where the file came from and what reading it
   * changed beyond its format: the version it states, and each 2.0
   * `is_preferred` flag the model could not carry as written
   * (`MigrationNote`). A 3.0 file has no notes. `barwise migrate` reports
   * them; every other caller wants only the model (orm-format-3 WS4b-iii).
   */
  migrate(yaml: string, options?: { lenient?: boolean; }): MigrationResult {
    return refusingHeldIds(() => this.read(yaml, options));
  }

  private read(yaml: string, options?: { lenient?: boolean; }): MigrationResult {
    const raw = parse(yaml) as unknown;
    const { doc, version, stated: from } = this.bringToReadableVersion(raw);

    // A 2.0 file is read by the 2.0 reader, against the 2.0 schema frozen
    // when 3.0 landed; a 3.0 file by the 3.0 reader. Reading 2.0 directly
    // into the model is the migration: the model is what both formats
    // state, and a 2.0 file saved writes 3.0 (orm-format-3 WS4b).
    if (version === LEGACY_ORM_VERSION) {
      this.check(this.validator.validateLegacyModel(doc));
      const { model, placed, flags } = readLegacy(doc as OrmYamlDocument, options);
      return { model, from: from!, notes: migrationNotes(model, placed, flags) };
    }
    if (version === CURRENT_ORM_VERSION) refuseMisplacedConstraints(doc);
    this.check(this.validator.validateModel(doc));
    return { model: this.fromDocument(doc as OrmYamlDocument, options), from: from!, notes: [] };
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
  private bringToReadableVersion(
    raw: unknown,
  ): { doc: unknown; version: unknown; stated: string | undefined; } {
    if (typeof raw !== "object" || raw === null) {
      return { doc: raw, version: undefined, stated: undefined };
    }
    const doc = raw as Record<string, unknown>;
    const version = doc.orm_version;
    if (typeof version !== "string") return { doc: raw, version, stated: undefined };
    if (version === CURRENT_ORM_VERSION) return { doc: raw, version, stated: version };
    if (compareOrmVersions(version, CURRENT_ORM_VERSION) > 0) {
      throw new DeserializationError(versionErrorMessage(version, { ok: false, reason: "newer" }));
    }
    if (version === LEGACY_ORM_VERSION) return { doc: raw, version, stated: version };
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
    return {
      doc: applyMigrations(doc, plan.steps),
      version: LEGACY_ORM_VERSION,
      stated: version,
    };
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
    // model-wide, so a 3.0 file holding a repeat is refused, lenient or
    // not, before anything is added. Read from what the file states, not
    // from the built model: two fact types sharing an id collapse into one
    // in the id-keyed store, and the dropped one's constraints would go
    // with it unreported. The lenient refusal is load-bearing: `barwise
    // migrate` re-reads its own 3.0 output leniently to refuse writing a
    // file a strict load would reject. A 2.0 file and a model built in code
    // are reported by `structural/duplicate-constraint-id` instead, which
    // asks the same `groupRepeats` of the built model. Holders whose fact
    // types also share an id never reach it: the store refuses the second
    // fact type (`DuplicateIdError`, model-invariants WS3).
    const factTypes = (doc.model.fact_types ?? []).map((ftDoc) => deserializeFactType(ftDoc));
    const modelConstraints = (doc.model.constraints ?? []).map((cDoc) =>
      deserializeConstraint(cDoc)
    );
    const stated = [
      ...factTypes.flatMap(({ config, constraints }) =>
        constraints.map((c) => [c, config.name] as const)
      ),
      ...modelConstraints.map((c) => [c, undefined] as const),
    ];
    const repeats = [...groupRepeats(stated, ([c]) => c.id)];
    if (repeats.length > 0) {
      const named = describeConstraintRepeats(
        repeats.map(([id, holders]) => describeConstraintRepeat(id, holders)),
      );
      throw new DeserializationError(
        `Constraint ids are held by more than one constraint: ${named}. `
          + "A constraint id names one constraint.",
      );
    }

    for (const { config, constraints } of factTypes) {
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

    for (const c of modelConstraints) {
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
  return refusingHeldIds(() => readLegacy(doc, options).model);
}

/**
 * Run a reader, reporting a file that states two elements of one kind
 * under one id as a `DeserializationError`. The model refuses the second
 * (`DuplicateIdError`), lenient or not, since it has nowhere to hold it,
 * and a reader reports a file it cannot load as a `DeserializationError`,
 * which is what every caller catches. Both entry points go through here:
 * `migrate` (so `deserialize`) and the exported 2.0 reader.
 */
function refusingHeldIds<T>(read: () => T): T {
  try {
    return read();
  } catch (err) {
    if (err instanceof DuplicateIdError) throw new DeserializationError(err.message);
    throw err;
  }
}

/** `readDocument20`, with what step 4 made of the file's flags. */
function readLegacy(
  doc: OrmYamlDocument,
  options?: { lenient?: boolean; },
): { readonly model: OrmModel; readonly placed: PlacedFlags; readonly flags: number; } {
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
  const placed = storePreferredFlags(model, (c) => c.id !== undefined && flagged.has(c.id));
  return { model, placed, flags: flagged.size };
}

/** The ids a leniently loaded model names and does not define, sorted. */
function missingReferences(model: OrmModel): string[] {
  const missing = new Set<string>();
  const object = (id: string) => {
    if (!model.getObjectType(id)) missing.add(id);
  };
  for (const ft of model.factTypes) for (const r of ft.roles) object(r.playerId);
  for (const sf of model.subtypeFacts) {
    object(sf.subtypeId);
    object(sf.supertypeId);
  }
  for (const oft of model.objectifiedFactTypes) {
    object(oft.objectTypeId);
    if (!model.getFactType(oft.factTypeId)) missing.add(oft.factTypeId);
  }
  for (const p of model.populations) {
    if (!model.getFactType(p.factTypeId)) missing.add(p.factTypeId);
  }
  return [...missing].sort();
}

/**
 * What the 2.0 reader made of the flags it could not carry into the model
 * as they stood: a flag that identifies no entity, and an entity two or
 * more flags name, of which the stored reference keeps one. In a file that
 * names elements it does not define, the flags are not judged at all.
 */
function migrationNotes(model: OrmModel, placed: PlacedFlags, flags: number): MigrationNote[] {
  const missing = missingReferences(model);
  if (flags > 0 && missing.length > 0) return [{ kind: "flags-unplaceable", missing }];
  const notes: MigrationNote[] = [];
  for (const c of placed.dropped) {
    const factType = c.id === undefined ? undefined : model.getConstraintInView(c.id)?.[1];
    notes.push({ kind: "flag-dropped", factType: factType?.name ?? "", constraintId: c.id ?? "" });
  }
  for (const [entityId, candidates] of placed.candidates) {
    if (candidates.length < 2) continue;
    const kept = placed.byEntity.get(entityId)!.constraint.id ?? "";
    notes.push({
      kind: "identifier-chosen",
      entity: model.getObjectType(entityId)?.name ?? entityId,
      kept,
      others: candidates.flatMap((at) =>
        at.constraint.id !== undefined && at.constraint.id !== kept ? [at.constraint.id] : []
      ),
    });
  }
  return notes;
}
