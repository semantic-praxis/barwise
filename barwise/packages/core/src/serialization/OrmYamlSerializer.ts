import { parse, stringify } from "yaml";
import {
  type DecodedExternalConstraint,
  type DecodedInternalConstraint,
  modelConstraint,
} from "../decode/constraint.js";
import { DecodeError } from "../decode/decoder.js";
import { type DecodedDocument, runDocumentDecode } from "../decode/document.js";
import { type DecodedDocument40, runDocument40Decode } from "../decode/document40.js";
import type { DecodeProblem } from "../decode/problems.js";
import { describeConstraintRepeat, describeConstraintRepeats } from "../model/Constraint.js";
import type { IdKind } from "../model/idIndex.js";
import { OrmModel } from "../model/OrmModel.js";
import { groupRepeats } from "../util/groupRepeats.js";
import { DeserializationError, refusingHeldIds } from "./deserializationError.js";
import { type MigrationNote, migrationNotes, readLegacy } from "./reader20.js";
import { type SchemaValidationResult, SchemaValidator } from "./SchemaValidator.js";
import {
  applyMigrations,
  CURRENT_ORM_VERSION,
  LEGACY_ORM_VERSION,
  planRead,
  unsupportedVersionMessage,
} from "./schemaVersion.js";
import { serializeConstraint } from "./yaml/constraint.js";
import { serializeDefinition } from "./yaml/definition.js";
import { serializeDiagramLayout } from "./yaml/diagram.js";
import type { OrmYamlDocument } from "./yaml/document.js";
import { serializeFactType } from "./yaml/factType.js";
import { serializeObjectifiedFactType } from "./yaml/objectified.js";
import { serializeObjectType } from "./yaml/objectType.js";
import { serializePopulation } from "./yaml/population.js";
import { serializeSubtypeFact } from "./yaml/subtype.js";

export { DeserializationError } from "./deserializationError.js";
export { type MigrationNote, readDocument20 } from "./reader20.js";

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
 * schema. The deserializer reads a 3.0 file through the Effect decoders in
 * `src/decode/`, and a file below 3.0 through the 2.0 reader, which
 * validates it against the frozen 2.0 schema, before constructing the model.
 */
export class OrmYamlSerializer {
  /**
   * Compiled on first use, not in the constructor.
   *
   * Only the 2.0 reader validates with ajv, and an ajv compile costs
   * about 34ms -- so every caller that constructs a serializer to
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
   * A 3.0 document is first decoded by the Effect decoders, and a document
   * below 3.0 validated against the frozen 2.0 schema. If either fails, a
   * DeserializationError is thrown with every problem found.
   *
   * The model is then constructed from the decoded document. A held id or a
   * repeated constraint id is thrown as DeserializationError; a check only an
   * element's constructor makes is thrown as that constructor throws it.
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
    // Every other document is read as 3.0, by the Effect decoders alone
    // (effect-adoption 1r, R4): every problem the file has, each named by
    // its element and field, in one pass. A document with no orm_version
    // comes here too, and is told it is missing.
    return { model: fromDecoded(decodeOrRefuse(doc), options), from: from!, notes: [] };
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
   * the current version, which earlier minors of its major migrate to, or
   * 2.0, which older documents migrate to first (`planRead`).
   *
   * Documents whose `orm_version` is missing or malformed are passed
   * through untouched so that the reader reports them: the decoders for
   * 3.0, which name the missing or malformed version as a problem. A present-but-unsupported version throws a
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
    const plan = planRead(version);
    if (!plan.ok) {
      throw new DeserializationError(
        unsupportedVersionMessage("orm_version", version, CURRENT_ORM_VERSION, plan.reason),
      );
    }
    return {
      doc: applyMigrations(doc, plan.steps),
      version: plan.target,
      stated: version,
    };
  }

  // -- Internal: model -> document --

  private toDocument(model: OrmModel): OrmYamlDocument {
    return writeDocument(model);
  }
}

/**
 * Decode a 3.0 document (or, given its decoder, a 4.0 one), or refuse it
 * with every problem it has, each
 * naming its element and field. The message is one line, its problems
 * sentences one after another, because surfaces print it after a file name
 * (`barwise migrate` gives one line per file); a line break inside a name
 * the file states is written as `\n` there, and kept in `validationResult`. The problems are also kept
 * as a `validationResult`, its paths JSON Pointers into the file, "/" for
 * the document itself, as ajv's were (effect-adoption 1r, R4).
 */
function decodeOrRefuse(doc: unknown): DecodedDocument;
function decodeOrRefuse<D>(doc: unknown, decode: (doc: unknown) => D, version: string): D;
function decodeOrRefuse(
  doc: unknown,
  decode: (doc: unknown) => unknown = runDocumentDecode,
  version = "3.0",
): unknown {
  try {
    return decode(doc);
  } catch (err) {
    if (!(err instanceof DecodeError)) throw err;
    const pointer = (p: DecodeProblem) =>
      [...p.at, ...p.path].map((s) => `/${String(s).replace(/~/g, "~0").replace(/\//g, "~1")}`)
        .join("") || "/";
    throw new DeserializationError(
      `The model file does not conform to format ${version}: ${
        err.problems.map((p) => p.message.replace(/\r?\n/g, "\\n")).join(" ")
      }`,
      {
        valid: false,
        errors: err.problems.map((p) => ({ path: pointer(p), message: p.message })),
      },
    );
  }
}

/**
 * Build the model from a decoded 3.0 or 4.0 document, with the ids a 4.0
 * file states reserved for the load. What decoding cannot see is
 * checked here, as it was on the validated document: constraint ids
 * repeated across the file, and, unless `lenient`, the references the
 * model's constructors check.
 */
function fromDecoded(
  doc: DecodedDocument | DecodedDocument40,
  options?: { lenient?: boolean; },
  reserved: Iterable<string> = [],
  idsAcrossKinds = false,
): OrmModel {
  // `imports` is decoded and not yet kept: the model carries it with 6b-3's
  // header change (iri-identity WS6), and nothing writes a 4.0 file yet.
  const { imports: _notKept, ...header } = doc.header as DecodedDocument40["header"];
  const model = new OrmModel({ ...header, idsAcrossKinds });
  return model.withReserved(reserved, () => addDecoded(model, doc, options));
}

function addDecoded(
  model: OrmModel,
  doc: DecodedDocument | DecodedDocument40,
  options?: { lenient?: boolean; },
): OrmModel {
  for (const ot of doc.objectTypes) model.addObjectType(ot.record);

  // Every constraint id is stated (the format requires it) and is
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
  const stated = [
    ...doc.factTypes.flatMap((ft) => ft.constraints.map((c) => [c, ft.name] as const)),
    ...doc.constraints.map((c) => [c, undefined] as const),
  ];
  // `groupRepeats` passes over an absent key, so a 4.0 constraint that
  // leaves its id to the model is never a repeat.
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

  for (const ft of doc.factTypes) {
    model.addFactType(
      {
        ...ft,
        constraints: ft.constraints.map((c) => modelConstraint(c as DecodedInternalConstraint)),
      },
      { skipPlayerValidation: options?.lenient },
    );
  }
  for (const sf of doc.subtypeFacts) {
    model.addSubtypeFact(sf, { skipPlayerValidation: options?.lenient });
  }
  for (const c of doc.constraints) {
    model.addConstraint(modelConstraint(c as DecodedExternalConstraint));
  }

  // After every constraint, so a reference resolves whatever order the
  // file lists them in. A reference to a constraint that does not exist,
  // or does not identify the entity, is validation's to report.
  for (const ot of doc.objectTypes) {
    if (ot.preferredIdentifier !== undefined) {
      model.setPreferredIdentifier(ot.record.id, ot.preferredIdentifier);
    }
  }

  for (const oft of doc.objectifiedFactTypes) {
    model.addObjectifiedFactType(oft, { skipPlayerValidation: options?.lenient });
  }
  for (const { config, instances } of doc.populations) {
    const pop = model.addPopulation(config, { skipPlayerValidation: options?.lenient });
    for (const inst of instances) pop.addInstance(inst);
  }
  for (const d of doc.definitions) model.addDefinition(d);
  for (const dl of doc.diagrams) model.addDiagramLayout(dl);
  return model;
}

/**
 * Read a format 4.0 document into the model (iri-identity WS6, 6b-2b-1):
 * decoded by the 4.0 decoders, every problem at once; then every id the
 * file states collected before the first add. An id stated by two
 * elements is refused, whatever their kinds, because in 4.0 an id names
 * one element; the rest are reserved for the load, so a name the model
 * mints for an element the file gives no id skips them, and the element
 * stating each takes it wherever it sits in the file.
 *
 * Not yet reached from `deserialize`: `planRead` refuses 4.0 until 6b-2b-2
 * writes it, so a 4.0 file is never saved as 3.0.
 */
export function readDocument40(doc: unknown, options?: { lenient?: boolean; }): OrmModel {
  const decoded = decodeOrRefuse(doc, runDocument40Decode, "4.0");
  const stated = statedIds40(decoded);
  const repeats = [...groupRepeats(stated, ([id]) => id)];
  if (repeats.length > 0) {
    const named = repeats.map(([id, holders]) => `"${id}" (${holdersOf(holders)})`).join("; ");
    throw new DeserializationError(
      `Ids are stated by more than one element: ${named}. An id names one element.`,
    );
  }
  // The pre-pass names every repeat in one message; the model refuses
  // across kinds as well, for an id added in code after the load.
  return refusingHeldIds(() => fromDecoded(decoded, options, stated.map(([id]) => id), true));
}

/** "an object type and a fact type", or "2 fact types". */
function holdersOf(holders: readonly (readonly [string, IdKind])[]): string {
  const kinds = [...new Set(holders.map(([, kind]) => kind))];
  if (kinds.length === 1) return `${holders.length} ${kinds[0]}s`;
  const article = (kind: string) => (/^[aeiou]/.test(kind) ? `an ${kind}` : `a ${kind}`);
  return kinds.map(article).join(" and ");
}

/** Every id a 4.0 document states, with the kind of element stating it. */
function statedIds40(doc: DecodedDocument40): (readonly [string, IdKind])[] {
  const ids: (readonly [string, IdKind])[] = [];
  const add = (id: string | undefined, kind: IdKind) => {
    if (id !== undefined) ids.push([id, kind]);
  };
  for (const ot of doc.objectTypes) add(ot.record.id, "object type");
  for (const ft of doc.factTypes) {
    add(ft.id, "fact type");
    for (const r of ft.roles) add(r.id, "role");
    for (const c of ft.constraints) add(c.id, "constraint");
  }
  for (const c of doc.constraints) add(c.id, "constraint");
  for (const sf of doc.subtypeFacts) add(sf.id, "subtype fact");
  for (const o of doc.objectifiedFactTypes) add(o.id, "objectification");
  for (const p of doc.populations) add(p.config.id, "population");
  return ids;
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
  if (model.namespace) {
    doc.model.namespace = model.namespace;
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
