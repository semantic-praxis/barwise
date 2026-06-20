import type { OrmModel, RingType } from "@barwise/core";
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

  // Identify absorbed reference mode patterns: when an entity type has a
  // reference mode, its identifying value type and identifying fact type
  // are shown as "EntityName (.ref_mode)" on the entity node, not as
  // separate nodes and edges on the diagram.
  const absorbedValueTypeIds = new Set<string>();
  const absorbedFactTypeIds = new Set<string>();

  for (const ot of model.objectTypes) {
    if (ot.kind !== "entity" || !ot.referenceMode) continue;

    // Find fact types with is_preferred uniqueness connecting this entity
    // to a value type.
    for (const ft of model.factTypes) {
      if (ft.arity !== 2) continue;

      const hasPreferred = ft.constraints.some(
        (c) => c.type === "internal_uniqueness" && c.isPreferred,
      );
      if (!hasPreferred) continue;

      // Check if this fact type connects our entity to a value type.
      const role0Player = model.getObjectType(ft.roles[0]!.playerId);
      const role1Player = model.getObjectType(ft.roles[1]!.playerId);
      if (!role0Player || !role1Player) continue;

      let valueTypeId: string | undefined;
      if (role0Player.id === ot.id && role1Player.kind === "value") {
        valueTypeId = role1Player.id;
      } else if (role1Player.id === ot.id && role0Player.kind === "value") {
        valueTypeId = role0Player.id;
      }

      if (valueTypeId) {
        absorbedValueTypeIds.add(valueTypeId);
        absorbedFactTypeIds.add(ft.id);
      }
    }
  }

  // Build a lookup from fact type id to objectified entity name, and
  // collect objectified entity IDs that don't play roles in any other
  // fact type.  Pure objectifications are already represented by their
  // fact type node (with the rounded-rectangle envelope) so rendering
  // them as separate entity nodes produces disconnected "island" nodes.
  const objectifiedMap = new Map<string, string>();
  const objectifiedEntityIds = new Set<string>();
  for (const oft of model.objectifiedFactTypes) {
    const entityType = model.getObjectType(oft.objectTypeId);
    if (entityType) {
      objectifiedMap.set(oft.factTypeId, entityType.name);
      objectifiedEntityIds.add(oft.objectTypeId);
    }
  }

  // Remove objectified entities that also play roles in other fact
  // types -- they need to stay as visible nodes with edges.
  for (const ft of model.factTypes) {
    for (const role of ft.roles) {
      if (objectifiedEntityIds.has(role.playerId)) {
        objectifiedEntityIds.delete(role.playerId);
      }
    }
  }

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
      referenceMode: ot.referenceMode,
      aliases: ot.aliases?.length ? ot.aliases : undefined,
      annotations: otAnnotations?.length ? otAnnotations : undefined,
    });
  }

  // Create fact type nodes and edges (skip absorbed and filtered-out facts).
  for (const ft of model.factTypes) {
    if (absorbedFactTypeIds.has(ft.id)) continue;
    if (filter && !filter.factTypeIds.has(ft.id)) continue;
    // Determine which roles have single-role internal uniqueness.
    const singleRoleUniqueIds = new Set<string>();
    let hasSpanning = false;

    for (const c of ft.constraints) {
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
    for (const c of ft.constraints) {
      if (c.type === "mandatory") {
        mandatoryRoleIds.add(c.roleId);
      }
    }

    // Collect frequency constraints per role.
    const frequencyByRole = new Map<string, { min: number; max: number | "unbounded"; }>();
    for (const c of ft.constraints) {
      // Single-role frequency renders as a per-role badge; a multi-role
      // (role-sequence) frequency has no single-role anchor and is skipped.
      if (c.type === "frequency" && c.roleIds.length === 1) {
        frequencyByRole.set(c.roleIds[0]!, { min: c.min, max: c.max });
      }
    }

    // Detect ring constraint (at most one per fact type).
    let ringConstraint: FactTypeNode["ringConstraint"];
    for (const c of ft.constraints) {
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
  // disjunctive mandatory, subset, and equality constraints.
  let constraintIndex = 0;

  /** Helper: create a constraint node and edges for a set of role ids. */
  function addConstraintNode(
    kind: ConstraintKind,
    roleIds: readonly string[],
    supersetRoleIds?: readonly string[],
  ): void {
    const constraintId = `constraint-${constraintIndex++}`;
    const node: ConstraintNode = {
      kind: "constraint",
      id: constraintId,
      constraintKind: kind,
      roleIds: [...roleIds],
      supersetRoleIds: supersetRoleIds ? [...supersetRoleIds] : undefined,
    };
    nodes.push(node);

    // Create edges to all covered roles (both sides for subset/equality).
    const allRoleIds = supersetRoleIds
      ? [...roleIds, ...supersetRoleIds]
      : roleIds;
    for (const roleId of allRoleIds) {
      const factTypeId = roleToFactType.get(roleId);
      if (factTypeId) {
        constraintEdges.push({
          constraintNodeId: constraintId,
          factTypeNodeId: factTypeId,
          roleId,
        });
      }
    }
  }

  for (const ft of model.factTypes) {
    if (absorbedFactTypeIds.has(ft.id)) continue;
    for (const c of ft.constraints) {
      switch (c.type) {
        case "external_uniqueness":
          addConstraintNode("external_uniqueness", c.roleIds);
          break;
        case "exclusion":
          addConstraintNode("exclusion", c.roleIds);
          break;
        case "exclusive_or":
          addConstraintNode("exclusive_or", c.roleIds);
          break;
        case "disjunctive_mandatory":
          addConstraintNode("disjunctive_mandatory", c.roleIds);
          break;
        case "subset":
          addConstraintNode("subset", c.subsetRoleIds, c.supersetRoleIds);
          break;
        case "equality":
          addConstraintNode("equality", c.roleIds1, c.roleIds2);
          break;
          // frequency and ring are handled inline on role boxes / fact type nodes.
          // internal_uniqueness, mandatory, and value_constraint are Phase 1.
      }
    }
  }

  // Create subtype edges (skip filtered-out subtypes).
  for (const sf of model.subtypeFacts) {
    if (filter && !filter.subtypeFactIds.has(sf.id)) continue;
    subtypeEdges.push({
      subtypeNodeId: sf.subtypeId,
      supertypeNodeId: sf.supertypeId,
      providesIdentification: sf.providesIdentification,
    });
  }

  return { nodes, edges, constraintEdges, subtypeEdges };
}
