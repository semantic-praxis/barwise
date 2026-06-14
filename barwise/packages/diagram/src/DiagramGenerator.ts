import type { OrmModel } from "@barwise/core";
import type { OrmGraph } from "./graph/GraphTypes.js";
import { modelToGraph, type ModelToGraphOptions } from "./graph/ModelToGraph.js";
import { computeNeighborhood } from "./graph/NeighborhoodFilter.js";
import {
  layoutGraph,
  type OrientationOverrides,
  type PositionOverrides,
} from "./layout/ElkLayoutEngine.js";
import type { PositionedGraph } from "./layout/LayoutTypes.js";

/**
 * The result of diagram generation: the positioned layout and the
 * unpositioned graph. Rendering to SVG is a separate, presentation-layer
 * step -- the CLI and MCP render the layout with `@barwise/diagram-ui`'s
 * `renderDiagramSvg`, and the VS Code webview renders it interactively.
 */
export interface DiagramResult {
  /** The positioned graph (for rendering, hit testing, overlays). */
  readonly layout: PositionedGraph;
  /** The unpositioned graph (for analysis). */
  readonly graph: OrmGraph;
}

/**
 * Options for diagram generation.
 */
export interface DiagramOptions extends ModelToGraphOptions {
  /** Manual position overrides for entity nodes (from drag). */
  readonly positionOverrides?: PositionOverrides;
  /** Manual orientation overrides for fact type nodes (from click toggle). */
  readonly orientationOverrides?: OrientationOverrides;
  /** Focus entity ID for neighborhood filtering. */
  readonly focusEntityId?: string;
  /** Number of hops from the focus entity (1, 2, 3, ...). Requires focusEntityId. */
  readonly hopCount?: number;
}

/**
 * Generate the positioned layout for an ORM diagram from a model.
 *
 * This is the main entry point for the diagram package. It runs the
 * pipeline up to layout: model -> graph -> positioned layout. Turning
 * the layout into SVG is a presentation-layer concern (see
 * `DiagramResult`).
 */
export async function generateDiagram(
  model: OrmModel,
  options?: DiagramOptions,
): Promise<DiagramResult> {
  // Compute neighborhood filter if a focus entity is specified.
  let graphOptions: ModelToGraphOptions | undefined = options;
  if (options?.focusEntityId) {
    const hops = options.hopCount ?? 1;
    const neighborhood = computeNeighborhood(model, options.focusEntityId, hops);
    graphOptions = {
      ...options,
      includeFilter: neighborhood,
    };
  }

  const graph = modelToGraph(model, graphOptions);
  const layout = await layoutGraph(
    graph,
    options?.positionOverrides,
    options?.orientationOverrides,
  );
  return { layout, graph };
}
