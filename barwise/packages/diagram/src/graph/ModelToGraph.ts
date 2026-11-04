import {
  absorbedReferenceModes,
  type Constraint,
  type OrmModel,
  pureObjectifyingEntityIds,
  referenceModeOf,
  type RingType,
  subtypeFactRef,
} from "@barwise/core";
import type {
  ConstraintEdge,
  ConstraintKind,
  ConstraintNode,
  FactTypeNode,
  GraphEdge,
  ObjectTypeNode,
  OrmGraph,
  RingTypeLabel,
  RoleBox,
  SubtypeEdge,
} from "./GraphTypes.js";

/**
 * Constraint kinds deliberately not drawn as dedicated constraint
 * nodes, each with the reason. A new Constraint member must be added
 * either to the drawn cases in the constraint-node switch or here: the
 * record is total over every kind that is not a drawn `ConstraintKind`,
 * internal kinds included, so leaving one out of both is a compile error.
 * The internal kinds never reach the switch, which walks
 * `model.constraints`; their entries document where each is drawn, and
 * nothing checks that a badge loop actually draws it.
 */
const NOT_DRAWN: Record<Exclude<Constraint["type"], ConstraintKind>, string> = {
  internal_uniqueness: "Phase 1: rendered inline as a uniqueness bar on the fact type",
  mandatory: "Phase 1: rendered inline as a mandatory dot on the role connector",
  value_constraint: "Phase 1: rendered inline on the object type",
  frequency: "rendered inline on the role box",
  ring: "rendered inline on the fact type node",
  value_comparison: "not drawn: no ORM 2 glyph wired yet; verbalization carries it",
  cardinality: "not drawn: no ORM 2 glyph wired yet; verbalization carries it",
  join_subset: "not drawn: join-path glyphs are not wired yet; verbalization carries it",
  join_equality: "not drawn: join-path glyphs are not wired yet; verbalization carries it",
  join_exclusion: "not drawn: join-path glyphs are not wired yet; verbalization carries it",
  join_ring: "not drawn: join-path glyphs are not wired yet; verbalization carries it",
};

/** Map core RingType values to short diagram labels. */
const RING_TYPE_LABELS: Record<RingType, RingTypeLabel> = {
  irreflexive: "ir",
  asymmetric: "as",
  antisymmetric: "ans",
  intransitive: "it",
  acyclic: "ac",
  symmetric: "sym",
  transitive: "tr",
  purely_reflexive: "pr",
};

/**
 * Options for modelToGraph conversion.
 */
export interface ModelToGraphOptions {
  /**
   * Per-element annotation messages, keyed by element ID.
   * When present, the corresponding graph node gets an `annotations`
   * array and the SVG renderer can add visual markers.
   */
  readonly annotations?: ReadonlyMap<string, readonly string[]>;
  /**
   * When set, only include elements whose IDs are in these sets.
   * Used for N-hop neighborhood filtering.
   */
  readonly includeFilter?: {
    readonly objectTypeIds: ReadonlySet<string>;
    readonly factTypeIds: ReadonlySet<string>;
    readonly subtypeFactIds: ReadonlySet<string>;
  };
}

/**
 * The node id of every constraint across fact types, decided once from the
 * whole model, so a constraint's node has the same id in every view and
 * whether or not the view draws it.
 *
 * A constraint keeps its own id when no other constraint across fact types
 * and no element of the model (object type, fact type, subtype fact) holds
 * it. Otherwise, for a second constraint with the same id (barwise-b2s) or
 * one colliding with an element, it gets the first `#2`, `#3` free of
 * every id reserved here. An internal constraint's id is not reserved: its
 * badge has no node id to collide with, and reserving it would rename an
 * existing node whenever an internal constraint with that id was added.
 * Nor is that of a kind never drawn (`NOT_DRAWN`), which no view shows.
 *
 * Which of two same-id constraints is suffixed follows file order. An
 * id-less constraint, which construction rules out
 * (barwise-nkq) though the type allows it until WS3c, is numbered.
 */
function constraintNodeIds(
  model: OrmModel,
  constraints: readonly Constraint[],
): ReadonlyMap<Constraint, string> {
  const taken = new Set<string>([
    ...model.objectTypes.map((ot) => ot.id),
    ...model.factTypes.map((ft) => ft.id),
    ...model.subtypeFacts.map(subtypeFactRef),
  ]);
  const uses = new Map<string, number>();
  for (const c of constraints) {
    if (c.id !== undefined) uses.set(c.id, (uses.get(c.id) ?? 0) + 1);
  }
  // A stated id held by exactly one constraint and no element is that
  // constraint's own, reserved before any suffix is handed out.
  const own = new Set<string>();
  for (const [id, count] of uses) {
    if (count === 1 && !taken.has(id)) own.add(id);
  }
  for (const id of own) taken.add(id);

  const ids = new Map<Constraint, string>();
  const free = (base: string) => {
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}#${n}`;
    taken.add(id);
    return id;
  };
  // Every stated id is settled before any id-less constraint is numbered,
  // so a number never takes an id constraints share, wherever in the file
  // the id-less one sits.
  for (const c of constraints) {
    if (c.id !== undefined) ids.set(c, own.has(c.id) ? c.id : free(c.id));
  }
  let unnamed = 0;
  for (const c of constraints) {
    if (c.id !== undefined) continue;
    let id: string;
    do id = `constraint-${unnamed++}`; while (taken.has(id));
    taken.add(id);
    ids.set(c, id);
  }
  return ids;
}

/**
 * Convert an OrmModel into an OrmGraph suitable for layout and rendering.
 *
 * This is the bridge between the semantic model and the visual representation.
 * Each object type becomes an ObjectTypeNode, each fact type becomes a
 * FactTypeNode with RoleBox children, and each role-player relationship
 * becomes a GraphEdge.
 */
export function modelToGraph(
  model: OrmModel,
  options?: ModelToGraphOptions,
): OrmGraph {
  const annotationMap = options?.annotations;
  const filter = options?.includeFilter;
  const nodes: (ObjectTypeNode | FactTypeNode | ConstraintNode)[] = [];
  const edges: GraphEdge[] = [];
  const constraintEdges: ConstraintEdge[] = [];
  const subtypeEdges: SubtypeEdge[] = [];

  // Reference-mode patterns folded into the entity's "(.ref_mode)" label.
  // The rule lives in core, shared with the NORMA exporter.
  const absorbed = absorbedReferenceModes(model);
  const absorbedValueTypeIds = absorbed.valueTypeIds;
  const absorbedFactTypeIds = absorbed.factTypeIds;

  // Build a lookup from fact type id to objectified entity name, and
  // collect objectified entity IDs that don't play roles in any other
  // fact type.  Pure objectifications are already represented by their
  // fact type node (with the rounded-rectangle envelope) so rendering
  // them as separate entity nodes produces disconnected "island" nodes.
  const objectifiedMap = new Map<string, string>();
  for (const oft of model.objectifiedFactTypes) {
    const entityType = model.getObjectType(oft.objectTypeId);
    if (entityType) objectifiedMap.set(oft.factTypeId, entityType.name);
  }
  // Shared with the NORMA exporter (core), so both hide the same entities.
  const objectifiedEntityIds = pureObjectifyingEntityIds(model);

  // Create object type nodes (skip absorbed value types, pure
  // objectified entities, and filtered-out types).
  for (const ot of model.objectTypes) {
    if (absorbedValueTypeIds.has(ot.id)) continue;
    if (objectifiedEntityIds.has(ot.id)) continue;
    if (filter && !filter.objectTypeIds.has(ot.id)) continue;
    const otAnnotations = annotationMap?.get(ot.id);
    nodes.push({
      kind: "object_type",
      id: ot.id,
      name: ot.name,
      objectTypeKind: ot.kind,
      referenceMode: referenceModeOf(ot),
      aliases: ot.aliases.length > 0 ? ot.aliases : undefined,
      annotations: otAnnotations?.length ? otAnnotations : undefined,
    });
  }

  // The fact types that get a node: a constraint attaches only to these.
  const drawnFactTypeIds = new Set<string>();

  // Create fact type nodes and edges (skip absorbed and filtered-out facts).
  for (const ft of model.factTypes) {
    if (absorbedFactTypeIds.has(ft.id)) continue;
    if (filter && !filter.factTypeIds.has(ft.id)) continue;
    // The badges read the kinds that live in the fact type, once.
    const internal = ft.internalConstraints;
    // Determine which roles have single-role internal uniqueness.
    const singleRoleUniqueIds = new Set<string>();
    let hasSpanning = false;

    for (const c of internal) {
      if (c.type === "internal_uniqueness") {
        if (c.roleIds.length === 1 && c.roleIds[0]) {
          singleRoleUniqueIds.add(c.roleIds[0]);
        } else if (c.roleIds.length === ft.arity) {
          hasSpanning = true;
        }
      }
    }

    // Determine which roles are mandatory.
    const mandatoryRoleIds = new Set<string>();
    for (const c of internal) {
      if (c.type === "mandatory") {
        mandatoryRoleIds.add(c.roleId);
      }
    }

    // Collect frequency constraints per role.
    const frequencyByRole = new Map<string, { min: number; max: number | "unbounded"; }>();
    for (const c of internal) {
      // Single-role frequency renders as a per-role badge; a multi-role
      // (role-sequence) frequency has no single-role anchor and is skipped.
      if (c.type === "frequency" && c.roleIds.length === 1) {
        frequencyByRole.set(c.roleIds[0]!, { min: c.min, max: c.max });
      }
    }

    // Detect ring constraint (at most one per fact type).
    let ringConstraint: FactTypeNode["ringConstraint"];
    for (const c of internal) {
      if (c.type === "ring") {
        ringConstraint = {
          label: RING_TYPE_LABELS[c.ringType],
          roleId1: c.roleId1,
          roleId2: c.roleId2,
        };
        break;
      }
    }

    // Build role boxes.
    const roleBoxes: RoleBox[] = ft.roles.map((role) => {
      const player = model.getObjectType(role.playerId);
      const freq = frequencyByRole.get(role.id);
      return {
        roleId: role.id,
        roleName: role.name,
        playerId: role.playerId,
        playerName: player?.name ?? "?",
        hasUniqueness: singleRoleUniqueIds.has(role.id),
        isMandatory: mandatoryRoleIds.has(role.id),
        frequencyMin: freq?.min,
        frequencyMax: freq?.max,
      };
    });

    const objectifiedEntityName = objectifiedMap.get(ft.id);
    const ftAnnotations = annotationMap?.get(ft.id);

    drawnFactTypeIds.add(ft.id);
    nodes.push({
      kind: "fact_type",
      id: ft.id,
      name: ft.name,
      roles: roleBoxes,
      hasSpanningUniqueness: hasSpanning,
      ringConstraint,
      isObjectified: objectifiedEntityName !== undefined,
      objectifiedEntityName,
      annotations: ftAnnotations?.length ? ftAnnotations : undefined,
    });

    // Create edges from each role's player object type to the fact type.
    for (const role of ft.roles) {
      edges.push({
        sourceNodeId: role.playerId,
        targetNodeId: ft.id,
        roleId: role.id,
      });
    }
  }

  // Build role-to-fact-type lookup for constraint edge routing.
  const roleToFactType = new Map<string, string>();
  for (const ft of model.factTypes) {
    for (const role of ft.roles) {
      roleToFactType.set(role.id, ft.id);
    }
  }

  // Extract constraints that are rendered as circled symbol nodes.
  // This covers external uniqueness, exclusion, exclusive-or,
  // disjunctive mandatory, subset, and equality constraints. Each node
  // takes its constraint's own id, so a selection, a view or a diff names
  // the same node whatever order the file lists constraints in
  // (orm-format-3, Open decision 9); a counter used to number them.
  // Drawn only where it attaches to a fact type with a node, with edges to
  // those fact types only: none floats, and no edge points at a fact type
  // absorbed into a reference mode or left out of a neighbourhood view.

  const across = model.constraints;
  const nodeIds = constraintNodeIds(
    model,
    across.filter((c) => !Object.hasOwn(NOT_DRAWN, c.type)),
  );

  /**
   * Draw a constraint as a node with an edge to each of its roles whose fact
   * type got a node (both sides for subset/equality). One with no such role
   * has nothing to attach to, absorbed, filtered out or dangling, and is not
   * drawn.
   */
  function addConstraintNode(
    c: Constraint,
    kind: ConstraintKind,
    roleIds: readonly string[],
    supersetRoleIds?: readonly string[],
  ): void {
    const allRoleIds = supersetRoleIds
      ? [...roleIds, ...supersetRoleIds]
      : roleIds;
    const attached = allRoleIds.flatMap((roleId) => {
      const factTypeId = roleToFactType.get(roleId);
      return factTypeId && drawnFactTypeIds.has(factTypeId) ? [{ factTypeId, roleId }] : [];
    });
    if (attached.length === 0) return;

    const constraintId = nodeIds.get(c)!;
    nodes.push(
      {
        kind: "constraint",
        id: constraintId,
        constraintKind: kind,
        roleIds: [...roleIds],
        supersetRoleIds: supersetRoleIds ? [...supersetRoleIds] : undefined,
      } satisfies ConstraintNode,
    );
    for (const { factTypeId, roleId } of attached) {
      constraintEdges.push({ constraintNodeId: constraintId, factTypeNodeId: factTypeId, roleId });
    }
  }

  // Every constraint across fact types, once, wherever a 2.0 file nests
  // it: the nesting fact type used to decide whether it was drawn at all.
  for (const c of across) {
    switch (c.type) {
      case "external_uniqueness":
        addConstraintNode(c, "external_uniqueness", c.roleIds);
        break;
      // A constraint over subtypes has no roles to attach to. It is not
      // drawn, as the 2.0 subtype flags it replaces never were; drawing it
      // across the subtype arrows is barwise-yeq.
      case "exclusion":
        if (c.roleIds) addConstraintNode(c, "exclusion", c.roleIds);
        break;
      case "exclusive_or":
        if (c.roleIds) addConstraintNode(c, "exclusive_or", c.roleIds);
        break;
      case "disjunctive_mandatory":
        if (c.roleIds) addConstraintNode(c, "disjunctive_mandatory", c.roleIds);
        break;
      case "subset":
        addConstraintNode(c, "subset", c.subsetRoleIds, c.supersetRoleIds);
        break;
      case "equality":
        addConstraintNode(c, "equality", c.roleIds1, c.roleIds2);
        break;
      default: {
        // Narrowed to the external kinds not drawn, the join kinds today.
        // NOT_DRAWN's type is the compile check for every kind, internal
        // ones included: a new member missing from both the cases above
        // and that record fails to compile instead of silently not
        // rendering (barwise-869).
        const reason: string = NOT_DRAWN[c.type];
        void reason;
        break;
      }
    }
  }

  // Create subtype edges (skip filtered-out subtypes).
  for (const sf of model.subtypeFacts) {
    if (filter && !filter.subtypeFactIds.has(subtypeFactRef(sf))) continue;
    subtypeEdges.push({
      subtypeNodeId: sf.subtypeId,
      supertypeNodeId: sf.supertypeId,
      providesIdentification: sf.providesIdentification,
    });
  }

  return { nodes, edges, constraintEdges, subtypeEdges };
}
