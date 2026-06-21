import { parse, stringify } from "yaml";
import type {
  Constraint,
  ConstraintModality,
  JoinOperand,
  RingType,
  RolePath,
  ValueComparisonOperator,
} from "../model/Constraint.js";
import type { Definition } from "../model/Definition.js";
import type { DiagramLayout } from "../model/DiagramLayout.js";
import type {
  DerivationKind,
  DerivationRule,
  DerivationStorage,
  FactType,
} from "../model/FactType.js";
import type { ObjectifiedFactType } from "../model/ObjectifiedFactType.js";
import type { ConceptualDataTypeName, ObjectType, ValueRange } from "../model/ObjectType.js";
import { OrmModel } from "../model/OrmModel.js";
import type { FactInstance, Population } from "../model/Population.js";
import type { Role } from "../model/Role.js";
import type { SubtypeFact } from "../model/SubtypeFact.js";
import { type SchemaValidationResult, SchemaValidator } from "./SchemaValidator.js";
import {
  applyMigrations,
  CURRENT_ORM_VERSION,
  type MigrationPlan,
  planMigration,
} from "./schemaVersion.js";

/**
 * The shape of a parsed .orm.yaml document. This mirrors the JSON Schema
 * and is used as the intermediate representation between YAML text and
 * the in-memory OrmModel.
 */
interface OrmYamlDiagramLayout {
  name: string;
  elements?: string[];
  positions?: Record<string, { x: number; y: number; }>;
  orientations?: Record<string, "horizontal" | "vertical">;
}

interface OrmYamlDocument {
  orm_version: string;
  model: {
    name: string;
    domain_context?: string;
    note?: string;
    object_types?: OrmYamlObjectType[];
    fact_types?: OrmYamlFactType[];
    subtype_facts?: OrmYamlSubtypeFact[];
    objectified_fact_types?: OrmYamlObjectifiedFactType[];
    populations?: OrmYamlPopulation[];
    definitions?: OrmYamlDefinition[];
    diagrams?: OrmYamlDiagramLayout[];
  };
}

interface OrmYamlValueRange {
  min?: string;
  max?: string;
  min_inclusive?: boolean;
  max_inclusive?: boolean;
}

interface OrmYamlValueConstraintBody {
  values?: string[];
  ranges?: OrmYamlValueRange[];
}

/** Serialize model value ranges to the YAML shape, omitting default bounds. */
function serializeValueRanges(
  ranges: readonly ValueRange[],
): OrmYamlValueRange[] {
  return ranges.map((r) => {
    const out: OrmYamlValueRange = {};
    if (r.min !== undefined) out.min = r.min;
    if (r.max !== undefined) out.max = r.max;
    if (r.minInclusive === false) out.min_inclusive = false;
    if (r.maxInclusive === false) out.max_inclusive = false;
    return out;
  });
}

/** Parse YAML value ranges back to the model shape. */
function deserializeValueRanges(
  ranges: readonly OrmYamlValueRange[],
): ValueRange[] {
  return ranges.map((r) => {
    const out: {
      min?: string;
      max?: string;
      minInclusive?: boolean;
      maxInclusive?: boolean;
    } = {};
    if (r.min !== undefined) out.min = r.min;
    if (r.max !== undefined) out.max = r.max;
    if (r.min_inclusive === false) out.minInclusive = false;
    if (r.max_inclusive === false) out.maxInclusive = false;
    return out;
  });
}

/** Build the YAML value-constraint body, omitting empty values/ranges. */
function serializeValueConstraintBody(
  values: readonly string[],
  ranges: readonly ValueRange[] | undefined,
): OrmYamlValueConstraintBody {
  const body: OrmYamlValueConstraintBody = {};
  if (values.length > 0) body.values = [...values];
  if (ranges && ranges.length > 0) body.ranges = serializeValueRanges(ranges);
  return body;
}

/** Parse a YAML value-constraint body, defaulting a missing `values` to []. */
function deserializeValueConstraintBody(
  body: OrmYamlValueConstraintBody,
): { values: string[]; ranges?: ValueRange[]; } {
  const values = body.values ? [...body.values] : [];
  if (body.ranges && body.ranges.length > 0) {
    return { values, ranges: deserializeValueRanges(body.ranges) };
  }
  return { values };
}

interface OrmYamlRolePath {
  root: string;
  steps: { entry: string; exit: string; }[];
}

interface OrmYamlJoinOperand {
  path: OrmYamlRolePath;
  projection: number[];
}

/** Serialize a role path (root + ordered entry/exit hops). */
function serializeRolePath(p: RolePath): OrmYamlRolePath {
  return {
    root: p.root,
    steps: p.steps.map((s) => ({ entry: s.entry, exit: s.exit })),
  };
}

/** Parse a role path back into the model shape. */
function deserializeRolePath(p: OrmYamlRolePath): RolePath {
  return {
    root: p.root,
    steps: p.steps.map((s) => ({ entry: s.entry, exit: s.exit })),
  };
}

/** Serialize a join operand (path + projection node indices). */
function serializeJoinOperand(o: JoinOperand): OrmYamlJoinOperand {
  return { path: serializeRolePath(o.path), projection: [...o.projection] };
}

/** Parse a join operand back into the model shape. */
function deserializeJoinOperand(o: OrmYamlJoinOperand): JoinOperand {
  return { path: deserializeRolePath(o.path), projection: [...o.projection] };
}

/** Serialize a derivation rule, omitting the default storage and absent flags. */
function serializeDerivation(d: DerivationRule): OrmYamlDerivation {
  const out: OrmYamlDerivation = { kind: d.kind, expression: d.expression };
  if (d.storage && d.storage !== "derive_on_request") {
    out.storage = d.storage;
  }
  if (d.isFormal) {
    out.is_formal = true;
  }
  return out;
}

/** Parse a derivation rule, dropping the default storage and false flags. */
function deserializeDerivation(d: OrmYamlDerivation): DerivationRule {
  const rule: DerivationRule = { kind: d.kind, expression: d.expression };
  return {
    ...rule,
    ...(d.storage ? { storage: d.storage } : {}),
    ...(d.is_formal ? { isFormal: true } : {}),
  };
}

interface OrmYamlObjectType {
  id: string;
  name: string;
  kind: "entity" | "value";
  reference_mode?: string;
  definition?: string;
  source_context?: string;
  value_constraint?: OrmYamlValueConstraintBody;
  data_type?: { name: string; length?: number; scale?: number; };
  aliases?: string[];
  independent?: boolean;
  default_value?: string;
  note?: string;
  cardinality?: { min: number; max: number | "unbounded"; };
}

interface OrmYamlDerivation {
  kind: DerivationKind;
  storage?: DerivationStorage;
  expression: string;
  is_formal?: boolean;
}

interface OrmYamlFactType {
  id: string;
  name: string;
  definition?: string;
  note?: string;
  roles: OrmYamlRole[];
  readings: string[];
  constraints?: OrmYamlConstraint[];
  derivation?: OrmYamlDerivation;
}

interface OrmYamlRole {
  id: string;
  player: string;
  role_name: string;
}

type OrmYamlConstraintBody =
  | { type: "internal_uniqueness"; roles: string[]; is_preferred?: boolean; }
  | { type: "mandatory"; role: string; }
  | { type: "external_uniqueness"; roles: string[]; }
  | ({ type: "value_constraint"; role?: string; } & OrmYamlValueConstraintBody)
  | { type: "disjunctive_mandatory"; roles: string[]; }
  | { type: "exclusion"; roles: string[]; }
  | { type: "exclusive_or"; roles: string[]; }
  | { type: "subset"; subset_roles: string[]; superset_roles: string[]; }
  | { type: "equality"; roles_1: string[]; roles_2: string[]; }
  | { type: "ring"; role_1: string; role_2: string; ring_type: RingType; }
  | { type: "frequency"; role?: string; roles?: string[]; min: number; max: number | "unbounded"; }
  | {
    type: "value_comparison";
    role_1: string;
    role_2: string;
    operator: ValueComparisonOperator;
  }
  | { type: "cardinality"; role: string; min: number; max: number | "unbounded"; }
  | { type: "join_subset"; subset: OrmYamlJoinOperand; superset: OrmYamlJoinOperand; }
  | { type: "join_equality"; operands: OrmYamlJoinOperand[]; }
  | { type: "join_exclusion"; operands: OrmYamlJoinOperand[]; };

/** A serialized constraint carries the shared optional `modality`. */
type OrmYamlConstraint = OrmYamlConstraintBody & { modality?: ConstraintModality; };

interface OrmYamlSubtypeFact {
  id: string;
  subtype: string;
  supertype: string;
  provides_identification?: boolean;
  is_exclusive?: boolean;
  is_exhaustive?: boolean;
  defining_rule?: OrmYamlDerivation;
}

interface OrmYamlObjectifiedFactType {
  id: string;
  fact_type: string;
  object_type: string;
}

interface OrmYamlPopulation {
  id: string;
  fact_type: string;
  description?: string;
  instances: OrmYamlFactInstance[];
}

interface OrmYamlFactInstance {
  id: string;
  role_values: Record<string, string>;
}

interface OrmYamlDefinition {
  term: string;
  definition: string;
  context?: string;
}

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
      doc.model.object_types = objectTypes.map((ot) => this.serializeObjectType(ot));
    }

    const factTypes = model.factTypes;
    if (factTypes.length > 0) {
      doc.model.fact_types = factTypes.map((ft) => this.serializeFactType(ft));
    }

    const subtypeFacts = model.subtypeFacts;
    if (subtypeFacts.length > 0) {
      doc.model.subtype_facts = subtypeFacts.map((sf) => this.serializeSubtypeFact(sf));
    }

    const objectifiedFactTypes = model.objectifiedFactTypes;
    if (objectifiedFactTypes.length > 0) {
      doc.model.objectified_fact_types = objectifiedFactTypes.map((oft) =>
        this.serializeObjectifiedFactType(oft)
      );
    }

    const populations = model.populations;
    if (populations.length > 0) {
      doc.model.populations = populations.map((p) => this.serializePopulation(p));
    }

    const definitions = model.definitions;
    if (definitions.length > 0) {
      doc.model.definitions = definitions.map((d) => this.serializeDefinition(d));
    }

    const diagrams = model.diagramLayouts;
    if (diagrams.length > 0) {
      doc.model.diagrams = diagrams.map((dl) => this.serializeDiagramLayout(dl, model));
    }

    return doc;
  }

  private serializeObjectType(ot: ObjectType): OrmYamlObjectType {
    const result: OrmYamlObjectType = {
      id: ot.id,
      name: ot.name,
      kind: ot.kind,
    };

    if (ot.referenceMode) {
      result.reference_mode = ot.referenceMode;
    }
    if (ot.definition) {
      result.definition = ot.definition;
    }
    if (ot.sourceContext) {
      result.source_context = ot.sourceContext;
    }
    if (ot.valueConstraint) {
      result.value_constraint = serializeValueConstraintBody(
        ot.valueConstraint.values,
        ot.valueConstraint.ranges,
      );
    }
    if (ot.dataType) {
      const dt: { name: string; length?: number; scale?: number; } = { name: ot.dataType.name };
      if (ot.dataType.length !== undefined) dt.length = ot.dataType.length;
      if (ot.dataType.scale !== undefined) dt.scale = ot.dataType.scale;
      result.data_type = dt;
    }
    if (ot.aliases && ot.aliases.length > 0) {
      result.aliases = [...ot.aliases];
    }
    if (ot.independent) {
      result.independent = true;
    }
    if (ot.defaultValue !== undefined) {
      result.default_value = ot.defaultValue;
    }
    if (ot.note) {
      result.note = ot.note;
    }
    if (ot.cardinality) {
      result.cardinality = { min: ot.cardinality.min, max: ot.cardinality.max };
    }

    return result;
  }

  private serializeFactType(ft: FactType): OrmYamlFactType {
    const result: OrmYamlFactType = {
      id: ft.id,
      name: ft.name,
      roles: ft.roles.map((r) => this.serializeRole(r)),
      readings: ft.readings.map((ro) => ro.template),
    };

    if (ft.definition) {
      result.definition = ft.definition;
    }
    if (ft.note) {
      result.note = ft.note;
    }

    if (ft.constraints.length > 0) {
      result.constraints = ft.constraints.map((c) => this.serializeConstraint(c));
    }
    if (ft.derivation) {
      result.derivation = serializeDerivation(ft.derivation);
    }

    return result;
  }

  private serializeRole(role: Role): OrmYamlRole {
    return {
      id: role.id,
      player: role.playerId,
      role_name: role.name,
    };
  }

  private serializeConstraint(c: Constraint): OrmYamlConstraint {
    let result: OrmYamlConstraint;
    switch (c.type) {
      case "internal_uniqueness": {
        const iuc: OrmYamlConstraint = { type: "internal_uniqueness", roles: [...c.roleIds] };
        if (c.isPreferred) {
          (iuc as { type: "internal_uniqueness"; roles: string[]; is_preferred?: boolean; })
            .is_preferred = true;
        }
        result = iuc;
        break;
      }
      case "mandatory":
        result = { type: "mandatory", role: c.roleId };
        break;
      case "external_uniqueness":
        result = { type: "external_uniqueness", roles: [...c.roleIds] };
        break;
      case "value_constraint": {
        const vc: Extract<OrmYamlConstraint, { type: "value_constraint"; }> = {
          type: "value_constraint",
          ...serializeValueConstraintBody(c.values, c.ranges),
        };
        if (c.roleId) {
          vc.role = c.roleId;
        }
        result = vc;
        break;
      }
      case "disjunctive_mandatory":
        result = { type: "disjunctive_mandatory", roles: [...c.roleIds] };
        break;
      case "exclusion":
        result = { type: "exclusion", roles: [...c.roleIds] };
        break;
      case "exclusive_or":
        result = { type: "exclusive_or", roles: [...c.roleIds] };
        break;
      case "subset":
        result = {
          type: "subset",
          subset_roles: [...c.subsetRoleIds],
          superset_roles: [...c.supersetRoleIds],
        };
        break;
      case "equality":
        result = { type: "equality", roles_1: [...c.roleIds1], roles_2: [...c.roleIds2] };
        break;
      case "ring":
        result = { type: "ring", role_1: c.roleId1, role_2: c.roleId2, ring_type: c.ringType };
        break;
      case "frequency":
        result = c.roleIds.length === 1
          ? { type: "frequency", role: c.roleIds[0]!, min: c.min, max: c.max }
          : { type: "frequency", roles: [...c.roleIds], min: c.min, max: c.max };
        break;
      case "value_comparison":
        result = {
          type: "value_comparison",
          role_1: c.roleId1,
          role_2: c.roleId2,
          operator: c.operator,
        };
        break;
      case "cardinality":
        result = { type: "cardinality", role: c.roleId, min: c.min, max: c.max };
        break;
      case "join_subset":
        result = {
          type: "join_subset",
          subset: serializeJoinOperand(c.subset),
          superset: serializeJoinOperand(c.superset),
        };
        break;
      case "join_equality":
        result = { type: "join_equality", operands: c.operands.map(serializeJoinOperand) };
        break;
      case "join_exclusion":
        result = { type: "join_exclusion", operands: c.operands.map(serializeJoinOperand) };
        break;
    }
    // Add constraint ID if present
    if (c.id) {
      (result as { id?: string; }).id = c.id;
    }
    // Modality round-trips only when deontic; alethic is the omitted default.
    if (c.modality === "deontic") {
      result.modality = "deontic";
    }
    return result;
  }

  private serializeSubtypeFact(sf: SubtypeFact): OrmYamlSubtypeFact {
    const result: OrmYamlSubtypeFact = {
      id: sf.id,
      subtype: sf.subtypeId,
      supertype: sf.supertypeId,
    };
    if (!sf.providesIdentification) {
      result.provides_identification = false;
    }
    if (sf.isExclusive) {
      result.is_exclusive = true;
    }
    if (sf.isExhaustive) {
      result.is_exhaustive = true;
    }
    if (sf.definingRule) {
      result.defining_rule = serializeDerivation(sf.definingRule);
    }
    return result;
  }

  private serializeObjectifiedFactType(
    oft: ObjectifiedFactType,
  ): OrmYamlObjectifiedFactType {
    return {
      id: oft.id,
      fact_type: oft.factTypeId,
      object_type: oft.objectTypeId,
    };
  }

  private serializePopulation(pop: Population): OrmYamlPopulation {
    const result: OrmYamlPopulation = {
      id: pop.id,
      fact_type: pop.factTypeId,
      instances: pop.instances.map((inst) => this.serializeFactInstance(inst)),
    };
    if (pop.description) {
      result.description = pop.description;
    }
    return result;
  }

  private serializeFactInstance(inst: FactInstance): OrmYamlFactInstance {
    return {
      id: inst.id,
      role_values: { ...inst.roleValues },
    };
  }

  private serializeDefinition(d: Definition): OrmYamlDefinition {
    const result: OrmYamlDefinition = {
      term: d.term,
      definition: d.definition,
    };
    if (d.context) {
      result.context = d.context;
    }
    return result;
  }

  private serializeDiagramLayout(
    dl: DiagramLayout,
    _model: OrmModel,
  ): OrmYamlDiagramLayout {
    const result: OrmYamlDiagramLayout = { name: dl.name };
    if (dl.elements && dl.elements.length > 0) {
      result.elements = [...dl.elements];
    }
    if (Object.keys(dl.positions).length > 0) {
      const positions: Record<string, { x: number; y: number; }> = {};
      for (const [name, pos] of Object.entries(dl.positions)) {
        positions[name] = {
          x: Math.round(pos.x),
          y: Math.round(pos.y),
        };
      }
      result.positions = positions;
    }
    if (Object.keys(dl.orientations).length > 0) {
      result.orientations = { ...dl.orientations };
    }
    return result;
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
      model.addObjectType({
        id: otDoc.id,
        name: otDoc.name,
        kind: otDoc.kind,
        referenceMode: otDoc.reference_mode,
        definition: otDoc.definition,
        sourceContext: otDoc.source_context,
        valueConstraint: otDoc.value_constraint
          ? deserializeValueConstraintBody(otDoc.value_constraint)
          : undefined,
        dataType: otDoc.data_type
          ? {
            name: otDoc.data_type.name as ConceptualDataTypeName,
            length: otDoc.data_type.length,
            scale: otDoc.data_type.scale,
          }
          : undefined,
        aliases: otDoc.aliases,
        independent: otDoc.independent,
        defaultValue: otDoc.default_value,
        note: otDoc.note,
        cardinality: otDoc.cardinality,
      });
    }

    // Add fact types.
    for (const ftDoc of doc.model.fact_types ?? []) {
      const constraints = (ftDoc.constraints ?? []).map((c) => this.deserializeConstraint(c));

      model.addFactType(
        {
          id: ftDoc.id,
          name: ftDoc.name,
          definition: ftDoc.definition,
          note: ftDoc.note,
          roles: ftDoc.roles.map((r) => ({
            id: r.id,
            name: r.role_name,
            playerId: r.player,
          })),
          readings: ftDoc.readings,
          constraints,
          derivation: ftDoc.derivation ? deserializeDerivation(ftDoc.derivation) : undefined,
        },
        { skipPlayerValidation: options?.lenient },
      );
    }

    // Add subtype facts (after object types and fact types).
    for (const sfDoc of doc.model.subtype_facts ?? []) {
      model.addSubtypeFact(
        {
          id: sfDoc.id,
          subtypeId: sfDoc.subtype,
          supertypeId: sfDoc.supertype,
          providesIdentification: sfDoc.provides_identification ?? true,
          isExclusive: sfDoc.is_exclusive ?? false,
          isExhaustive: sfDoc.is_exhaustive ?? false,
          definingRule: sfDoc.defining_rule
            ? deserializeDerivation(sfDoc.defining_rule)
            : undefined,
        },
        { skipPlayerValidation: options?.lenient },
      );
    }

    // Add objectified fact types (after object types and fact types).
    for (const oftDoc of doc.model.objectified_fact_types ?? []) {
      model.addObjectifiedFactType({
        id: oftDoc.id,
        factTypeId: oftDoc.fact_type,
        objectTypeId: oftDoc.object_type,
      });
    }

    // Add populations (after fact types, since they reference them).
    for (const popDoc of doc.model.populations ?? []) {
      const pop = model.addPopulation({
        id: popDoc.id,
        factTypeId: popDoc.fact_type,
        description: popDoc.description,
      });
      for (const instDoc of popDoc.instances) {
        pop.addInstance({
          id: instDoc.id,
          roleValues: instDoc.role_values,
        });
      }
    }

    // Add definitions.
    for (const defDoc of doc.model.definitions ?? []) {
      model.addDefinition({
        term: defDoc.term,
        definition: defDoc.definition,
        context: defDoc.context,
      });
    }

    // Add diagram layouts.
    for (const dlDoc of doc.model.diagrams ?? []) {
      model.addDiagramLayout({
        name: dlDoc.name,
        elements: dlDoc.elements,
        positions: dlDoc.positions ?? {},
        orientations: dlDoc.orientations ?? {},
      });
    }

    return model;
  }

  private deserializeConstraint(c: OrmYamlConstraint): Constraint {
    let result: Constraint;
    const id = (c as { id?: string; }).id;

    switch (c.type) {
      case "internal_uniqueness": {
        result = { type: "internal_uniqueness", roleIds: c.roles };
        if (c.is_preferred) {
          result = { ...result, isPreferred: true } as Constraint;
        }
        break;
      }
      case "mandatory":
        result = { type: "mandatory", roleId: c.role };
        break;
      case "external_uniqueness":
        result = { type: "external_uniqueness", roleIds: c.roles };
        break;
      case "value_constraint": {
        const body = deserializeValueConstraintBody(c);
        result = body.ranges
          ? { type: "value_constraint", roleId: c.role, values: body.values, ranges: body.ranges }
          : { type: "value_constraint", roleId: c.role, values: body.values };
        break;
      }
      case "disjunctive_mandatory":
        result = { type: "disjunctive_mandatory", roleIds: c.roles };
        break;
      case "exclusion":
        result = { type: "exclusion", roleIds: c.roles };
        break;
      case "exclusive_or":
        result = { type: "exclusive_or", roleIds: c.roles };
        break;
      case "subset":
        result = {
          type: "subset",
          subsetRoleIds: c.subset_roles,
          supersetRoleIds: c.superset_roles,
        };
        break;
      case "equality":
        result = { type: "equality", roleIds1: c.roles_1, roleIds2: c.roles_2 };
        break;
      case "ring":
        result = { type: "ring", roleId1: c.role_1, roleId2: c.role_2, ringType: c.ring_type };
        break;
      case "frequency":
        result = {
          type: "frequency",
          roleIds: c.roles ?? (c.role !== undefined ? [c.role] : []),
          min: c.min,
          max: c.max,
        };
        break;
      case "value_comparison":
        result = {
          type: "value_comparison",
          roleId1: c.role_1,
          roleId2: c.role_2,
          operator: c.operator,
        };
        break;
      case "cardinality":
        result = { type: "cardinality", roleId: c.role, min: c.min, max: c.max };
        break;
      case "join_subset":
        result = {
          type: "join_subset",
          subset: deserializeJoinOperand(c.subset),
          superset: deserializeJoinOperand(c.superset),
        };
        break;
      case "join_equality":
        result = { type: "join_equality", operands: c.operands.map(deserializeJoinOperand) };
        break;
      case "join_exclusion":
        result = { type: "join_exclusion", operands: c.operands.map(deserializeJoinOperand) };
        break;
    }

    // Preserve ID if present in serialized form
    if (id) {
      result = { ...result, id };
    }
    // Preserve deontic modality (alethic is the omitted default).
    if (c.modality === "deontic") {
      result = { ...result, modality: "deontic" };
    }

    return result;
  }
}
