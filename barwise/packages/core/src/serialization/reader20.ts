/**
 * The 2.0 reader: a file below format 3.0 read straight into the model,
 * after validation against the frozen `orm-model-2.0.schema.json`
 * (orm-format-3 WS4b). Format 3.0 is read by the Effect decoders
 * (`src/decode/`) since effect-adoption R4.
 *
 * The `deserialize*` functions here, and `readTail`, were shared by both
 * readers until R4; they moved here unchanged, so the two readers share no
 * code only one of them is meant to change (effect-adoption, Open decision
 * 13). The `serialize*` functions stay in `yaml/` for the writer.
 */
import {
  type Constraint,
  type ExternalConstraint,
  isExternalConstraint,
  isInternalConstraint,
} from "../model/Constraint.js";
import type { Definition } from "../model/Definition.js";
import type { DiagramLayout } from "../model/DiagramLayout.js";
import type { DerivationRule, FactTypeConfig } from "../model/FactType.js";
import { type PlacedFlags, storePreferredFlags } from "../model/identification.js";
import type { ObjectifiedFactTypeConfig } from "../model/ObjectifiedFactType.js";
import type { ConceptualDataTypeName, ObjectTypeConfig, ValueRange } from "../model/ObjectType.js";
import { OrmModel } from "../model/OrmModel.js";
import type { FactInstanceConfig, PopulationConfig } from "../model/Population.js";
import type { JoinOperand, RolePath } from "../model/RolePath.js";
import type { SubtypeFactConfig } from "../model/SubtypeFact.js";
import { withDerivedIds } from "./derivedId.js";
import { refusingHeldIds } from "./deserializationError.js";
import { subtypeConstraintsFromFlags } from "./subtypeFlags.js";
import type { OrmYamlConstraint } from "./yaml/constraint.js";
import type { OrmYamlDefinition } from "./yaml/definition.js";
import type { OrmYamlDerivation } from "./yaml/derivation.js";
import type { OrmYamlDiagramLayout } from "./yaml/diagram.js";
import type { OrmYamlDocument } from "./yaml/document.js";
import type { OrmYamlFactType } from "./yaml/factType.js";
import type { OrmYamlObjectifiedFactType } from "./yaml/objectified.js";
import type { OrmYamlObjectType } from "./yaml/objectType.js";
import type { OrmYamlFactInstance, OrmYamlPopulation } from "./yaml/population.js";
import type { OrmYamlJoinOperand, OrmYamlRolePath } from "./yaml/rolePath.js";
import type { OrmYamlSubtypeFact } from "./yaml/subtype.js";
import type { OrmYamlValueConstraintBody, OrmYamlValueRange } from "./yaml/valueConstraint.js";

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

// -- The element readers, moved from yaml/ unchanged --------------------------

export function deserializeObjectType(otDoc: OrmYamlObjectType): ObjectTypeConfig {
  return {
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
  };
}

/** Parse YAML value ranges back to the model shape. */
export function deserializeValueRanges(
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

/** Parse a YAML value-constraint body, defaulting a missing `values` to []. */
export function deserializeValueConstraintBody(
  body: OrmYamlValueConstraintBody,
): { values: string[]; ranges?: ValueRange[]; } {
  const values = body.values ? [...body.values] : [];
  if (body.ranges && body.ranges.length > 0) {
    return { values, ranges: deserializeValueRanges(body.ranges) };
  }
  return { values };
}

/** Parse a role path back into the model shape. */
export function deserializeRolePath(p: OrmYamlRolePath): RolePath {
  return {
    root: p.root,
    steps: p.steps.map((s) => ({ entry: s.entry, exit: s.exit })),
  };
}

/** Parse a join operand back into the model shape. */
export function deserializeJoinOperand(o: OrmYamlJoinOperand): JoinOperand {
  return { path: deserializeRolePath(o.path), projection: [...o.projection] };
}

/** Parse a derivation rule, dropping the default storage and false flags. */
export function deserializeDerivation(d: OrmYamlDerivation): DerivationRule {
  const rule: DerivationRule = { kind: d.kind, expression: d.expression };
  return {
    ...rule,
    ...(d.storage ? { storage: d.storage } : {}),
    ...(d.is_formal ? { isFormal: true } : {}),
  };
}

export function deserializeConstraint(c: OrmYamlConstraint): Constraint {
  let result: Constraint;
  const id = (c as { id?: string; }).id;

  switch (c.type) {
    case "internal_uniqueness": {
      // A 2.0 file's `is_preferred` is the 2.0 reader's to place on an
      // entity (`storePreferredFlags`); the constraint does not carry it.
      result = { type: "internal_uniqueness", roleIds: c.roles };
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
      result = c.subtype_facts
        ? { type: "disjunctive_mandatory", subtypeFactIds: c.subtype_facts }
        : { type: "disjunctive_mandatory", roleIds: c.roles };
      break;
    case "exclusion":
      result = c.subtype_facts
        ? { type: "exclusion", subtypeFactIds: c.subtype_facts }
        : { type: "exclusion", roleIds: c.roles };
      break;
    case "exclusive_or":
      result = c.subtype_facts
        ? { type: "exclusive_or", subtypeFactIds: c.subtype_facts }
        : { type: "exclusive_or", roleIds: c.roles };
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
    case "join_ring":
      result = {
        type: "join_ring",
        operand: deserializeJoinOperand(c.operand),
        ringType: c.ring_type,
      };
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

/**
 * A fact type as a 2.0 file states it: its config, and every constraint
 * nested under it, of either placement, in file order. The loader splits
 * them, since one across fact types belongs to the model (orm-format-3
 * WS3c).
 */
export interface NestedFactType {
  readonly config: Omit<FactTypeConfig, "constraints">;
  readonly constraints: readonly Constraint[];
}

/**
 * A constraint the file leaves without an id comes back without one; the
 * model loader derives it (`withDerivedIds`), since constraint ids are
 * model-wide and one fact type cannot see the others' stated ids.
 */
export function deserializeFactType(ftDoc: OrmYamlFactType): NestedFactType {
  const config: Omit<FactTypeConfig, "constraints"> = {
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
    derivation: ftDoc.derivation ? deserializeDerivation(ftDoc.derivation) : undefined,
  };
  return { config, constraints: (ftDoc.constraints ?? []).map(deserializeConstraint) };
}

export function deserializeSubtypeFact(sfDoc: OrmYamlSubtypeFact): SubtypeFactConfig {
  return {
    id: sfDoc.id,
    subtypeId: sfDoc.subtype,
    supertypeId: sfDoc.supertype,
    providesIdentification: sfDoc.provides_identification ?? true,
    definingRule: sfDoc.defining_rule
      ? deserializeDerivation(sfDoc.defining_rule)
      : undefined,
  };
}

export function deserializeObjectifiedFactType(
  oftDoc: OrmYamlObjectifiedFactType,
): ObjectifiedFactTypeConfig {
  return {
    id: oftDoc.id,
    factTypeId: oftDoc.fact_type,
    objectTypeId: oftDoc.object_type,
  };
}

/**
 * Translate a population's header fields. The instances are added
 * separately (via {@link deserializeFactInstance}) so the orchestrator
 * keeps the model-mutation order.
 */
export function deserializePopulation(popDoc: OrmYamlPopulation): PopulationConfig {
  return {
    id: popDoc.id,
    factTypeId: popDoc.fact_type,
    description: popDoc.description,
    ...(popDoc.sample !== undefined ? { sample: popDoc.sample } : {}),
  };
}

export function deserializeFactInstance(instDoc: OrmYamlFactInstance): FactInstanceConfig {
  return {
    id: instDoc.id,
    roleValues: instDoc.role_values,
  };
}

export function deserializeDefinition(defDoc: OrmYamlDefinition): Definition {
  return {
    term: defDoc.term,
    definition: defDoc.definition,
    context: defDoc.context,
  };
}

export function deserializeDiagramLayout(dlDoc: OrmYamlDiagramLayout): DiagramLayout {
  return {
    name: dlDoc.name,
    elements: dlDoc.elements,
    positions: dlDoc.positions ?? {},
    orientations: dlDoc.orientations ?? {},
  };
}

// -- The document -------------------------------------------------------------

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

/** `c` without the 2.0 flag `readDocument20` adds for deriving its id. */
function withoutFlag(c: Constraint): Constraint {
  const { isPreferred: _, ...rest } = c as Constraint & { isPreferred?: boolean; };
  return rest as Constraint;
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

/** `readDocument20`, with what step 4 made of the file's flags. */
export function readLegacy(
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
export function migrationNotes(
  model: OrmModel,
  placed: PlacedFlags,
  flags: number,
): MigrationNote[] {
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
