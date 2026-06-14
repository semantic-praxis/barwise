// Graph types and conversion.
export type {
  ConstraintEdge,
  ConstraintKind,
  ConstraintNode,
  FactTypeNode,
  GraphEdge,
  GraphNode,
  ObjectTypeNode,
  OrmGraph,
  RingTypeLabel,
  RoleBox,
  SubtypeEdge,
} from "./graph/GraphTypes.js";
export { modelToGraph, type ModelToGraphOptions } from "./graph/ModelToGraph.js";
export { computeNeighborhood, type Neighborhood } from "./graph/NeighborhoodFilter.js";

// Layout types and engine.
export {
  layoutGraph,
  type OrientationOverrides,
  type PositionOverrides,
} from "./layout/ElkLayoutEngine.js";
export type {
  Dimensions,
  FactTypeOrientation,
  Position,
  PositionedConstraintEdge,
  PositionedConstraintNode,
  PositionedEdge,
  PositionedFactTypeNode,
  PositionedGraph,
  PositionedNode,
  PositionedObjectTypeNode,
  PositionedRoleBox,
  PositionedSubtypeEdge,
} from "./layout/LayoutTypes.js";

// Theme constants (also exposed via the ./theme subpath for renderers).
export * as theme from "./render/theme.js";

// Main entry point.
export { generateDiagram } from "./DiagramGenerator.js";
export type { DiagramOptions, DiagramResult } from "./DiagramGenerator.js";

// Interactive session + presentation contract.
export type {
  DiagramFocus,
  DiagramIntent,
  DiagramPresentation,
  DiagramViewInfo,
} from "./session/contract.js";
export { DiagramSession } from "./session/DiagramSession.js";
