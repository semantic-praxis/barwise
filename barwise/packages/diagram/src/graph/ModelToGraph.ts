import {
  absorbedReferenceModes,
  type OrmModel,
  pureObjectifyingEntityIds,
  referenceModeOf,
  type RingType,
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
 * either to the drawn cases in the constraint-node switch or here --
 * the switch's default indexes this record over the exact complement
 * of the drawn kinds, so leaving it out of both is a compile error.
 */
const NOT_DRAWN: Record<
  | "internal_uniqueness"
  | "mandatory"
  | "value_constraint"
  | "frequency"
  | "ring"
  | "value_comparison"
  | "cardinality"
  | "join_subset"
  | "join_equality"
  | "join_exclusion",
  string
> = {
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
        default: {
          // Narrowed to exactly the kinds declared not-drawn below; a
          // new Constraint member missing from both the cases above
          // and NOT_DRAWN fails to compile instead of silently not
          // rendering (barwise-869: the join/comparison/cardinality
          // kinds were undrawn with nothing recording the intent).
          const reason: string = NOT_DRAWN[c.type];
          void reason;
          break;
        }
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
