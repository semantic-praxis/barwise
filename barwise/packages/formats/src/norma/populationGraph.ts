/**
 * Builds NORMA's sample-population instance graph from a model's flat
 * populations: ValueTypeInstance elements per distinct value,
 * EntityTypeInstance elements identified through their identifying fact,
 * role-instance declarations on the Role elements, and FactTypeInstance
 * tuples referencing them. Pure: same model, same graph; all ids derive
 * from the model's own ids plus insertion counters.
 *
 * An entity instance needs an identifying seat (the reference-scheme value
 * role) to carry its value. When the model holds the expansion explicitly
 * (a preferred internal uniqueness over a value role, as NORMA-imported
 * models do), it is reused; otherwise the expansion is synthesized here,
 * mirroring what NORMA itself persists alongside the _ReferenceMode
 * attribute. The identifying fact's own instances stay implicit, exactly
 * as NORMA writes them.
 */
import { type ObjectType, type OrmModel, referenceModeOf } from "@barwise/core";
import { derivedNormaId, type NormaId, toNormaId } from "./normaId.js";
import type {
  NormaConstraint,
  NormaEntityTypeInstance,
  NormaFactType,
  NormaFactTypeInstance,
  NormaRoleInstanceDecl,
  NormaValueType,
  NormaValueTypeInstance,
} from "./NormaXmlTypes.js";

export interface PopulationGraph {
  /** NORMA value-type id -> its ValueTypeInstance elements. */
  readonly valueInstancesByOwner: Map<string, NormaValueTypeInstance[]>;
  /** NORMA entity-type id -> its EntityTypeInstance elements. */
  readonly entityInstancesByOwner: Map<string, NormaEntityTypeInstance[]>;
  /** NORMA role id -> its role-instance declarations. */
  readonly roleDeclsByRole: Map<string, NormaRoleInstanceDecl[]>;
  /** NORMA fact id -> its FactTypeInstance elements. */
  readonly factInstancesByFact: Map<string, NormaFactTypeInstance[]>;
  /** Synthesized reference-scheme value types (no data type set yet). */
  readonly extraValueTypes: NormaValueType[];
  /** Synthesized identifying facts. */
  readonly extraFactTypes: NormaFactType[];
  /** Constraints of the synthesized identifying facts. */
  readonly extraConstraints: NormaConstraint[];
  /** NORMA entity id -> synthesized preferred-identifier constraint id. */
  readonly syntheticPreferredIdByEntity: Map<string, string>;
  /** Model object-type id -> synthesized played-role refs to append. */
  readonly extraPlayedRolesByOwner: Map<string, NormaId[]>;
}

/** The identifying value seat for a populated entity, in NORMA ids. */
interface IdentifyingSeat {
  readonly valueRoleId: NormaId;
  readonly valueTypeId: NormaId;
}

export function buildPopulationGraph(model: OrmModel): PopulationGraph {
  const graph: PopulationGraph = {
    valueInstancesByOwner: new Map(),
    entityInstancesByOwner: new Map(),
    roleDeclsByRole: new Map(),
    factInstancesByFact: new Map(),
    extraValueTypes: [],
    extraFactTypes: [],
    extraConstraints: [],
    syntheticPreferredIdByEntity: new Map(),
    extraPlayedRolesByOwner: new Map(),
  };

  const counters = new Map<string, number>();
  const nextId = (prefix: NormaId): NormaId => {
    const n = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, n);
    return derivedNormaId(prefix, String(n));
  };
  const push = <T>(map: Map<string, T[]>, key: string, item: T): void => {
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  };

  // Interners: one instance per (owner, value); one declaration per
  // (role, object instance).
  // Keyed by a composite string; the VALUE is a NORMA id, which is what
  // lets the intern helpers return NormaId without a cast.
  const valueInstanceByKey = new Map<string, NormaId>();
  const entityInstanceByKey = new Map<string, NormaId>();
  const declByKey = new Map<string, NormaId>();
  const seatByEntity = new Map<string, IdentifyingSeat>();

  const internValueInstance = (ownerNormaId: NormaId, value: string): NormaId => {
    const key = `${ownerNormaId} ${value}`;
    const existing = valueInstanceByKey.get(key);
    if (existing) return existing;
    const id = nextId(derivedNormaId(ownerNormaId, "_pi"));
    valueInstanceByKey.set(key, id);
    push(graph.valueInstancesByOwner, ownerNormaId, { id, value });
    return id;
  };

  const internDecl = (
    roleNormaId: NormaId,
    objectInstanceRef: NormaId,
    consumer: "entity" | "fact",
  ): NormaId => {
    const key = `${roleNormaId} ${objectInstanceRef} ${consumer}`;
    const existing = declByKey.get(key);
    if (existing) return existing;
    const id = nextId(derivedNormaId(roleNormaId, "_ri"));
    declByKey.set(key, id);
    push(graph.roleDeclsByRole, roleNormaId, { id, objectInstanceRef, consumer });
    return id;
  };

  // Mutable views of the entity instances so unary role refs can be
  // appended after interning.
  const entityRecordByInstanceId = new Map<
    string,
    { id: string; roleInstanceRefs: string[]; unaryRoleRefs: string[]; }
  >();
  const unaryMarksSeen = new Set<string>();

  const internEntityInstance = (entity: ObjectType, value: string): NormaId => {
    const ownerNormaId = toNormaId(entity.id);
    const key = `${ownerNormaId} ${value}`;
    const existing = entityInstanceByKey.get(key);
    if (existing) return existing;
    let seat = seatByEntity.get(entity.id);
    if (!seat) {
      seat = findIdentifyingSeat(model, entity.id) ?? synthesizeExpansion(graph, entity);
      seatByEntity.set(entity.id, seat);
    }
    const valueInstanceId = internValueInstance(seat.valueTypeId, value);
    const declId = internDecl(seat.valueRoleId, valueInstanceId, "entity");
    const id = nextId(derivedNormaId(ownerNormaId, "_pi"));
    entityInstanceByKey.set(key, id);
    const record = { id, roleInstanceRefs: [declId], unaryRoleRefs: [] as NormaId[] };
    entityRecordByInstanceId.set(id, record);
    push(graph.entityInstancesByOwner, ownerNormaId, record);
    return id;
  };

  /** Mark an entity instance as populating a unary role (deduplicated). */
  const markUnary = (entityInstanceId: string, roleNormaId: string): void => {
    const key = `${entityInstanceId} ${roleNormaId}`;
    if (unaryMarksSeen.has(key)) return;
    unaryMarksSeen.add(key);
    entityRecordByInstanceId.get(entityInstanceId)?.unaryRoleRefs.push(roleNormaId);
  };

  for (const population of model.populations) {
    const ft = model.getFactType(population.factTypeId);
    if (!ft) continue;
    // Unary facts populate through the entity instance itself
    // (EntityTypeUnaryRoleInstance); NORMA has no seat for a value-typed
    // unary player, so those rows are skipped.
    if (ft.roles.length === 1) {
      const role = ft.roles[0]!;
      const player = model.getObjectType(role.playerId);
      if (player?.kind !== "entity") continue;
      for (const instance of population.instances) {
        const value = instance.roleValues[role.id];
        if (value === undefined) continue;
        markUnary(internEntityInstance(player, value), toNormaId(role.id));
      }
      continue;
    }
    for (const instance of population.instances) {
      const refs: NormaId[] = [];
      for (const role of ft.roles) {
        const value = instance.roleValues[role.id];
        if (value === undefined) continue;
        const player = model.getObjectType(role.playerId);
        if (!player) continue;
        const objectInstanceId = player.kind === "value"
          ? internValueInstance(toNormaId(player.id), value)
          : internEntityInstance(player, value);
        refs.push(internDecl(toNormaId(role.id), objectInstanceId, "fact"));
      }
      if (refs.length > 0) {
        push(graph.factInstancesByFact, toNormaId(ft.id), {
          id: nextId(derivedNormaId(toNormaId(ft.id), "_fi")),
          roleInstanceRefs: refs,
        });
      }
    }
  }

  return graph;
}

/**
 * The model's explicit identifying seat for an entity: a binary fact where
 * a preferred single-role internal uniqueness covers a value-typed role and
 * the entity plays the other role.
 */
function findIdentifyingSeat(
  model: OrmModel,
  entityId: string,
): IdentifyingSeat | undefined {
  for (const ft of model.factTypes) {
    if (ft.roles.length !== 2) continue;
    for (const c of ft.constraints) {
      if (c.type !== "internal_uniqueness" || !c.isPreferred || c.roleIds.length !== 1) {
        continue;
      }
      const valueRole = ft.roles.find((r) => r.id === c.roleIds[0]);
      const entityRole = ft.roles.find((r) => r.id !== c.roleIds[0]);
      if (!valueRole || !entityRole || entityRole.playerId !== entityId) continue;
      const player = model.getObjectType(valueRole.playerId);
      if (player?.kind !== "value") continue;
      return {
        valueRoleId: toNormaId(valueRole.id),
        valueTypeId: toNormaId(player.id),
      };
    }
  }
  return undefined;
}

/**
 * Synthesize the reference-scheme expansion NORMA persists for an
 * identified entity: the injected value type, the identifying fact, its
 * preferred uniqueness (value role) plus uniqueness + simple mandatory
 * (entity role), and the PreferredIdentifier link.
 */
function synthesizeExpansion(
  graph: PopulationGraph,
  entity: ObjectType,
): IdentifyingSeat {
  const base = toNormaId(entity.id);
  const valueTypeId = derivedNormaId(base, "_idvt");
  const factId = derivedNormaId(base, "_idfact");
  const entityRoleId = derivedNormaId(factId, "_r0");
  const valueRoleId = derivedNormaId(factId, "_r1");
  const preferredUcId = derivedNormaId(factId, "_puc");
  const valueTypeName = `${entity.name}_${referenceModeOf(entity) || "id"}`;

  graph.extraValueTypes.push({
    id: valueTypeId,
    name: valueTypeName,
    playedRoleRefs: [valueRoleId],
  });
  graph.extraFactTypes.push({
    id: factId,
    name: `${entity.name}Has${valueTypeName}`,
    roles: [
      {
        id: entityRoleId,
        name: "",
        playerRef: base,
        isMandatory: true,
        multiplicity: "Unspecified",
      },
      {
        id: valueRoleId,
        name: "",
        playerRef: valueTypeId,
        isMandatory: false,
        multiplicity: "Unspecified",
      },
    ],
    readingOrders: [
      {
        id: derivedNormaId(factId, "_ro0"),
        readings: [{ id: derivedNormaId(factId, "_rd0"), data: "{0} has {1}" }],
        roleSequence: [entityRoleId, valueRoleId],
      },
    ],
    internalConstraintRefs: [
      preferredUcId,
      derivedNormaId(factId, "_uc"),
      derivedNormaId(factId, "_mc"),
    ],
  });
  graph.extraConstraints.push(
    {
      type: "uniqueness",
      id: preferredUcId,
      name: "",
      isInternal: true,
      isPreferred: true,
      roleRefs: [valueRoleId],
    },
    {
      type: "uniqueness",
      id: derivedNormaId(factId, "_uc"),
      name: "",
      isInternal: true,
      isPreferred: false,
      roleRefs: [entityRoleId],
    },
    {
      type: "mandatory",
      id: derivedNormaId(factId, "_mc"),
      name: "",
      isSimple: true,
      isImplied: false,
      roleRefs: [entityRoleId],
    },
  );
  graph.syntheticPreferredIdByEntity.set(base, preferredUcId);
  graph.extraPlayedRolesByOwner.set(entity.id, [entityRoleId]);

  return { valueRoleId, valueTypeId };
}
