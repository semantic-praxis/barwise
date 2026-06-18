/**
 * Writes an OrmModel into a NormaDocument (intermediate representation).
 *
 * This is the inverse of NormaToOrmMapper: where the mapper resolves a
 * parsed NORMA document into model objects, the writer reconstructs the
 * NORMA document from the model. It is a pure function -- no I/O, no clock,
 * no randomness, no fresh UUIDs. NORMA element ids are derived
 * deterministically from the model's own ids ("_<model-uuid>"), so export
 * is a pure function of the model and the round-trip is id-stable.
 *
 * The writer covers the full representable conceptual subset:
 * entity/value types, reference-scheme re-expansion, fact types with all
 * reading orders, internal/external uniqueness (+ preferred identifier),
 * mandatory and disjunctive mandatory, exclusion/exclusive-or,
 * subset/equality, ring (all seven), single-role frequency, enumerated
 * value constraints, subtypes (with exclusive/exhaustive), objectification,
 * and conceptual data types (inverse of the importer's type normalization).
 *
 * We do not embed or redistribute any NORMA source code or XSD schemas.
 * These mappings are derived from publicly documented format information.
 */
import type {
  ConceptualDataTypeName,
  Constraint,
  FactType,
  ObjectType,
  OrmModel,
  Role,
  ValueRange,
} from "@barwise/core";
import type {
  NormaConstraint,
  NormaDataType,
  NormaDocument,
  NormaEntityType,
  NormaFactType,
  NormaObjectifiedType,
  NormaReadingOrder,
  NormaRingType,
  NormaRole,
  NormaSubtypeFact,
  NormaValueConstraintInline,
  NormaValueType,
} from "./NormaXmlTypes.js";

/**
 * Convert a model id into a NORMA-style id token. NORMA accepts any unique
 * token; we prefix with "_" (NORMA's convention) unless the id already
 * carries that prefix. Role ids imported from NORMA already start with "_"
 * (they pass through the mapper unchanged), so this avoids double-prefixing.
 */
function normaId(id: string): string {
  return id.startsWith("_") ? id : `_${id}`;
}

/**
 * Write an OrmModel into a NormaDocument. Pure: same model, same document.
 */
export function writeOrmToNorma(model: OrmModel): NormaDocument {
  // Fact types that are objectified are emitted as ObjectifiedType (with a
  // nested predicate) rather than EntityType; collect the objectified
  // object-type ids so the entity loop can skip them.
  const objectifiedObjectTypeIds = new Set<string>();
  const objectifiedByObjectType = new Map<string, string>(); // objectTypeId -> factTypeId
  for (const oft of model.objectifiedFactTypes) {
    objectifiedObjectTypeIds.add(oft.objectTypeId);
    objectifiedByObjectType.set(oft.objectTypeId, oft.factTypeId);
  }

  // Index roles played by each object type (across all fact types) so each
  // object element can list its PlayedRoles.
  const playedRoles = collectPlayedRoles(model);

  const entityTypes: NormaEntityType[] = [];
  const valueTypes: NormaValueType[] = [];
  const objectifiedTypes: NormaObjectifiedType[] = [];

  // Map a uniqueness constraint to the entity it preferentially identifies,
  // so the entity can carry a PreferredIdentifier link.
  const preferredIdByEntity = collectPreferredIdentifiers(model);

  for (const ot of model.objectTypes) {
    const refs = playedRoles.get(ot.id) ?? [];
    if (ot.kind === "value") {
      valueTypes.push(writeValueType(ot, refs));
      continue;
    }
    // entity
    if (objectifiedObjectTypeIds.has(ot.id)) {
      const factTypeId = objectifiedByObjectType.get(ot.id)!;
      objectifiedTypes.push({
        id: normaId(ot.id),
        name: ot.name,
        nestedFactTypeRef: normaId(factTypeId),
        referenceMode: ot.referenceMode,
        preferredIdentifier: preferredIdByEntity.get(ot.id),
        playedRoleRefs: refs,
        definition: ot.definition,
      });
    } else {
      entityTypes.push({
        id: normaId(ot.id),
        name: ot.name,
        referenceMode: ot.referenceMode,
        preferredIdentifier: preferredIdByEntity.get(ot.id),
        playedRoleRefs: refs,
        definition: ot.definition,
      });
    }
  }

  // Fact types, readings, and the constraints collected from every fact type.
  const factTypes: NormaFactType[] = [];
  const constraints: NormaConstraint[] = [];
  const seenConstraintIds = new Set<string>();

  for (const ft of model.factTypes) {
    const { norma } = writeFactType(ft, constraints, seenConstraintIds);
    factTypes.push(norma);
  }

  // Subtype facts (+ exclusion / disjunctive-mandatory for exclusive /
  // exhaustive partitions over the supertype meta-roles).
  const subtypeFacts: NormaSubtypeFact[] = [];
  writeSubtypeFacts(model, subtypeFacts, constraints);

  // Data type definitions referenced by value types.
  const dataTypes = collectDataTypes(valueTypes);

  return {
    modelId: normaId(modelIdFor(model)),
    modelName: model.name,
    entityTypes,
    valueTypes,
    objectifiedTypes,
    factTypes,
    subtypeFacts,
    constraints,
    dataTypes,
  };
}

/** Stable model id token derived from the model name (NORMA needs an id). */
function modelIdFor(model: OrmModel): string {
  // The mapper does not read the model id back, so any stable token works.
  // Derive it deterministically from the (slugified) model name.
  const slug = model.name.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `model_${slug || "model"}`;
}

// ---------------------------------------------------------------------------
// Object types
// ---------------------------------------------------------------------------

/** Build a map from object-type id to the NORMA-style ids of roles it plays. */
function collectPlayedRoles(model: OrmModel): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const ft of model.factTypes) {
    for (const role of ft.roles) {
      const list = result.get(role.playerId) ?? [];
      list.push(normaId(role.id));
      result.set(role.playerId, list);
    }
  }
  return result;
}

/**
 * Map each entity (or objectified entity) id to the NORMA id of the
 * uniqueness constraint that is its preferred identifier, if any.
 *
 * The preferred internal uniqueness constraint sits on the role played by
 * the injected reference value type; the entity is the player of the OTHER
 * role in that same fact type.
 */
function collectPreferredIdentifiers(model: OrmModel): Map<string, string> {
  const result = new Map<string, string>();
  for (const ft of model.factTypes) {
    for (const c of ft.constraints) {
      if (c.type !== "internal_uniqueness" || !c.isPreferred) continue;
      const constrainedRoleIds = new Set(c.roleIds);
      // The identified entity plays the role(s) NOT in the uniqueness set.
      for (const role of ft.roles) {
        if (constrainedRoleIds.has(role.id)) continue;
        const player = model.getObjectType(role.playerId);
        if (player && player.kind === "entity" && c.id) {
          result.set(player.id, normaId(c.id));
        }
      }
    }
  }
  return result;
}

function writeValueType(ot: ObjectType, playedRoleRefs: string[]): NormaValueType {
  const dt = ot.dataType;
  const valueConstraint = toInlineValueConstraint(ot.valueConstraint);
  return {
    id: normaId(ot.id),
    name: ot.name,
    playedRoleRefs,
    definition: ot.definition,
    valueConstraint,
    dataTypeRef: dt ? dataTypeIdFor(dt.name) : undefined,
    dataTypeLength: dt?.length,
    dataTypeScale: dt?.scale,
  };
}

function toInlineValueConstraint(
  vc: { readonly values: readonly string[]; readonly ranges?: readonly ValueRange[]; } | undefined,
): NormaValueConstraintInline | undefined {
  if (!vc) return undefined;
  if (vc.values.length === 0 && (vc.ranges?.length ?? 0) === 0) return undefined;
  return vc.ranges && vc.ranges.length > 0
    ? { values: [...vc.values], ranges: vc.ranges.map((r) => ({ ...r })) }
    : { values: [...vc.values] };
}

// ---------------------------------------------------------------------------
// Fact types
// ---------------------------------------------------------------------------

function writeFactType(
  ft: FactType,
  constraints: NormaConstraint[],
  seen: Set<string>,
): { norma: NormaFactType; internalRefs: string[]; } {
  const roles: NormaRole[] = ft.roles.map((role) => writeRole(ft, role));
  const readingOrders: NormaReadingOrder[] = ft.readings.map((reading, i) => ({
    id: `${normaId(ft.id)}_ro${i}`,
    readings: [{ id: `${normaId(ft.id)}_rd${i}`, data: reading.template }],
    roleSequence: ft.roles.map((r) => normaId(r.id)),
  }));

  const internalRefs: string[] = [];
  ft.constraints.forEach((c, i) => {
    // Constraints attached through the FactType constructor carry an id;
    // those attached later by the importer (external uniqueness, role-level
    // value constraints) do not. Derive a deterministic, collision-free id
    // from the fact type id and the constraint's position so every emitted
    // constraint has a unique id token.
    const fallbackId = `${normaId(ft.id)}_c${i}`;
    const written = writeConstraint(c, fallbackId);
    if (!written) return;
    if (!seen.has(written.id)) {
      seen.add(written.id);
      constraints.push(written);
    }
    // Internal (single-fact) constraints are referenced from the fact's
    // InternalConstraints; multi-fact constraints are top-level only.
    if (isInternalConstraint(c)) {
      internalRefs.push(written.id);
    }
  });

  return {
    norma: {
      id: normaId(ft.id),
      name: ft.name,
      roles,
      readingOrders,
      internalConstraintRefs: internalRefs,
      definition: ft.definition,
    },
    internalRefs,
  };
}

function writeRole(ft: FactType, role: Role): NormaRole {
  const isMandatory = ft.constraints.some(
    (c) => c.type === "mandatory" && c.roleId === role.id,
  );
  return {
    id: normaId(role.id),
    name: role.name,
    playerRef: normaId(role.playerId),
    isMandatory,
    multiplicity: "Unspecified",
  };
}

/**
 * A constraint is "internal" (lives in a fact's InternalConstraints and is
 * derived from a single fact type) when it is internal uniqueness, simple
 * mandatory, single-role frequency, a role-level value constraint, or a ring.
 * External uniqueness and the set-comparison/partition constraints span fact
 * types and are emitted only at the top level.
 */
function isInternalConstraint(c: Constraint): boolean {
  switch (c.type) {
    case "internal_uniqueness":
    case "mandatory":
    case "frequency":
    case "value_constraint":
    case "ring":
      return true;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Constraints
// ---------------------------------------------------------------------------

function writeConstraint(c: Constraint, fallbackId: string): NormaConstraint | undefined {
  const id = c.id ? normaId(c.id) : fallbackId;
  switch (c.type) {
    case "internal_uniqueness":
      return {
        type: "uniqueness",
        id,
        name: "",
        isInternal: true,
        isPreferred: c.isPreferred ?? false,
        roleRefs: c.roleIds.map(normaId),
      };
    case "external_uniqueness":
      return {
        type: "uniqueness",
        id,
        name: "",
        isInternal: false,
        isPreferred: false,
        roleRefs: c.roleIds.map(normaId),
      };
    case "mandatory":
      return {
        type: "mandatory",
        id,
        name: "",
        isSimple: true,
        isImplied: false,
        roleRefs: [normaId(c.roleId)],
      };
    case "disjunctive_mandatory":
      return {
        type: "mandatory",
        id,
        name: "",
        isSimple: false,
        isImplied: false,
        roleRefs: c.roleIds.map(normaId),
      };
    case "frequency":
      return {
        type: "frequency",
        id,
        name: "",
        min: c.min,
        max: c.max,
        roleRefs: [normaId(c.roleId)],
      };
    case "value_constraint":
      return {
        type: "value_constraint",
        id,
        name: "",
        roleRefs: c.roleId ? [normaId(c.roleId)] : [],
        values: [...c.values],
        ...(c.ranges && c.ranges.length > 0 ? { ranges: c.ranges.map((r) => ({ ...r })) } : {}),
      };
    case "subset":
      return {
        type: "subset",
        id,
        name: "",
        subsetRoleRefs: c.subsetRoleIds.map(normaId),
        supersetRoleRefs: c.supersetRoleIds.map(normaId),
      };
    case "equality":
      return {
        type: "equality",
        id,
        name: "",
        roleSequences: [c.roleIds1.map(normaId), c.roleIds2.map(normaId)],
      };
    case "exclusion":
      return {
        type: "exclusion",
        id,
        name: "",
        roleSequences: c.roleIds.map((r) => [normaId(r)]),
      };
    case "exclusive_or":
      // NORMA models exclusive-or as a paired exclusion + disjunctive
      // mandatory. The importer collapses an exclusion back to "exclusion";
      // here we emit the exclusion half so the disjunction is preserved.
      return {
        type: "exclusion",
        id,
        name: "",
        roleSequences: c.roleIds.map((r) => [normaId(r)]),
      };
    case "ring":
      return {
        type: "ring",
        id,
        name: "",
        ringType: c.ringType as NormaRingType,
        roleRefs: [normaId(c.roleId1), normaId(c.roleId2)],
      };
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Subtype facts
// ---------------------------------------------------------------------------

function writeSubtypeFacts(
  model: OrmModel,
  out: NormaSubtypeFact[],
  constraints: NormaConstraint[],
): void {
  // Group subtype facts by supertype so exclusive/exhaustive partitions can
  // be re-expressed as exclusion / disjunctive-mandatory constraints over the
  // supertype meta-roles.
  const bySupertype = new Map<
    string,
    { supertypeRoleIds: string[]; isExclusive: boolean; isExhaustive: boolean; }
  >();

  for (const sf of model.subtypeFacts) {
    const id = normaId(sf.id);
    const subtypeRoleId = `${id}_sub`;
    const supertypeRoleId = `${id}_super`;
    out.push({
      id,
      subtypeRoleId,
      subtypePlayerRef: normaId(sf.subtypeId),
      supertypeRoleId,
      supertypePlayerRef: normaId(sf.supertypeId),
      providesIdentification: sf.providesIdentification,
    });

    const group = bySupertype.get(sf.supertypeId) ?? {
      supertypeRoleIds: [],
      isExclusive: false,
      isExhaustive: false,
    };
    group.supertypeRoleIds.push(supertypeRoleId);
    group.isExclusive = group.isExclusive || sf.isExclusive;
    group.isExhaustive = group.isExhaustive || sf.isExhaustive;
    bySupertype.set(sf.supertypeId, group);
  }

  for (const [supertypeId, group] of bySupertype) {
    if (group.supertypeRoleIds.length < 2) continue;
    if (group.isExclusive) {
      constraints.push({
        type: "exclusion",
        id: `_subtype_excl_${supertypeId}`,
        name: "",
        roleSequences: group.supertypeRoleIds.map((r) => [r]),
      });
    }
    if (group.isExhaustive) {
      constraints.push({
        type: "mandatory",
        id: `_subtype_exh_${supertypeId}`,
        name: "",
        isSimple: false,
        isImplied: false,
        roleRefs: group.supertypeRoleIds,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

/**
 * Canonical NORMA DataType tag-derived kind for each portable conceptual
 * type. Several NORMA kinds collapse to one conceptual name on import; the
 * inverse picks one representative kind per conceptual name. The conceptual
 * name (and length/scale) is what round-trips, not the original NORMA tag.
 */
const conceptualToNormaKind: Record<ConceptualDataTypeName, string> = {
  text: "variable_length_text",
  integer: "signed_integer_numeric",
  decimal: "decimal_numeric",
  money: "money_numeric",
  float: "floating_point_numeric",
  boolean: "true_or_false_logical",
  date: "date_temporal",
  time: "time_temporal",
  datetime: "date_and_time_temporal",
  timestamp: "auto_timestamp_temporal",
  auto_counter: "auto_counter_numeric",
  binary: "variable_length_raw_data",
  uuid: "unique_identifier",
  other: "variable_length_text",
};

/** Stable DataType element id for a conceptual type. */
function dataTypeIdFor(name: ConceptualDataTypeName): string {
  return `_dt_${conceptualToNormaKind[name]}`;
}

/** Collect the distinct DataType definitions referenced by value types. */
function collectDataTypes(valueTypes: readonly NormaValueType[]): NormaDataType[] {
  const byId = new Map<string, NormaDataType>();
  for (const vt of valueTypes) {
    if (!vt.dataTypeRef) continue;
    if (byId.has(vt.dataTypeRef)) continue;
    const kind = vt.dataTypeRef.replace(/^_dt_/, "");
    byId.set(vt.dataTypeRef, { id: vt.dataTypeRef, kind });
  }
  return [...byId.values()];
}
