/**
 * Positioned graph types produced by the layout engine.
 *
 * These carry x/y coordinates and dimensions assigned by ELK,
 * ready for direct SVG rendering.
 */

import type { ConstraintKind, RingTypeLabel } from "../graph/GraphTypes.js";

export type FactTypeOrientation = "horizontal" | "vertical";

export interface Position {
  readonly x: number;
  readonly y: number;
}

export interface Dimensions {
  readonly width: number;
  readonly height: number;
}

export interface PositionedRoleBox {
  readonly roleId: string;
  readonly roleName: string;
  readonly playerName: string;
  readonly hasUniqueness: boolean;
  readonly isMandatory: boolean;
  readonly frequencyMin?: number;
  readonly frequencyMax?: number | "unbounded";
  /** Position relative to the parent fact type node. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PositionedObjectTypeNode {
  readonly kind: "object_type";
  readonly id: string;
  readonly name: string;
  readonly objectTypeKind: "entity" | "value";
  readonly referenceMode?: string;
  /** Alternative names / synonyms for this object type. */
  readonly aliases?: readonly string[];
  /** Annotation messages for visual markers. */
  readonly annotations?: readonly string[];
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PositionedFactTypeNode {
  readonly kind: "fact_type";
  readonly id: string;
  readonly name: string;
  readonly roles: readonly PositionedRoleBox[];
  readonly hasSpanningUniqueness: boolean;
  readonly ringConstraint?: {
    readonly label: RingTypeLabel;
    readonly roleId1: string;
    readonly roleId2: string;
  };
  /** Whether this fact type is objectified as an entity type. */
  readonly isObjectified?: boolean;
  /** The name of the entity type created by objectification. */
  readonly objectifiedEntityName?: string;
  /** Annotation messages for visual markers. */
  readonly annotations?: readonly string[];
  /** Layout orientation of the role box strip. */
  readonly orientation: FactTypeOrientation;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PositionedConstraintNode {
  readonly kind: "constraint";
  readonly id: string;
  readonly constraintKind: ConstraintKind;
  readonly roleIds: readonly string[];
  readonly supersetRoleIds?: readonly string[];
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type PositionedNode =
  | PositionedObjectTypeNode
  | PositionedFactTypeNode
  | PositionedConstraintNode;

export interface PositionedEdge {
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly roleId: string;
  /** Whether the role played by this edge's entity is mandatory. */
  readonly isMandatory: boolean;
  readonly points: readonly Position[];
}

/**
 * A positioned subtype edge with routing points for the arrow path.
 */
export interface PositionedSubtypeEdge {
  readonly subtypeNodeId: string;
  readonly supertypeNodeId: string;
  readonly providesIdentification: boolean;
  readonly points: readonly Position[];
}

/**
 * A positioned edge from a constraint node to a role box.
 */
export interface PositionedConstraintEdge {
  readonly constraintNodeId: string;
  readonly factTypeNodeId: string;
  readonly roleId: string;
  readonly points: readonly Position[];
}

export interface PositionedGraph {
  readonly nodes: readonly PositionedNode[];
  readonly edges: readonly PositionedEdge[];
  readonly constraintEdges: readonly PositionedConstraintEdge[];
  readonly subtypeEdges: readonly PositionedSubtypeEdge[];
  /** Minimum x coordinate of all content (for viewBox origin). */
  readonly originX: number;
  /** Minimum y coordinate of all content (for viewBox origin). */
  readonly originY: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Optional position overrides for entity nodes.
 * Keys are entity node IDs, values are {x, y} positions.
 * When provided, the layout engine uses these positions instead of
 * computing them via ELK, then re-runs fact type placement and edge
 * routing around the fixed positions.
 */
export interface PositionOverrides {
  readonly [nodeId: string]: { readonly x: number; readonly y: number; };
}

/**
 * Manual orientation overrides for fact type nodes.
 * Keys are fact type node IDs, values are the desired orientation.
 */
export interface OrientationOverrides {
  readonly [factTypeId: string]: "horizontal" | "vertical";
}
