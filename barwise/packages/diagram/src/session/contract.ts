/**
 * The diagram presentation contract.
 *
 * Plain, serializable data a `DiagramSession` produces and a front end
 * renders. No class instances, no functions -- these cross `postMessage`,
 * a JSON file, or a function return identically. See
 * `docs/specs/diagram-presentation-contract.spec.md`.
 */
import type { PositionedGraph } from "../layout/LayoutTypes.js";

/** Active focus (hop-count) neighborhood state. */
export interface DiagramFocus {
  readonly entityId: string;
  readonly entityName: string;
  readonly hopCount: number;
}

/** Active named-view state. */
export interface DiagramViewInfo {
  readonly viewName: string;
  readonly hasGhosts: boolean;
}

/** The full payload a front end renders for one diagram state. */
export interface DiagramPresentation {
  readonly graph: PositionedGraph;
  /** Node ids to render as dimmed ghost (preview) nodes. */
  readonly ghostNodeIds: readonly string[];
  readonly focus: DiagramFocus | null;
  readonly view: DiagramViewInfo | null;
  /** Names of every saved layout in the model's `diagrams:` section. */
  readonly availableViews: readonly string[];
  readonly hasUnsavedLayout: boolean;
  readonly modelName: string;
}

/**
 * The closed set of operations a front end may request. Save operations
 * are separate (they need a host file path), as is element highlighting
 * from the model tree.
 */
export type DiagramIntent =
  | {
    readonly type: "moveNode";
    readonly nodeId: string;
    /** New top-left coordinates of the node, in graph units. */
    readonly x: number;
    readonly y: number;
  }
  | { readonly type: "toggleOrientation"; readonly nodeId: string; }
  | { readonly type: "selectElement"; readonly elementId: string | null; }
  | { readonly type: "focusEntity"; readonly nodeId: string; readonly hopCount: number; }
  | { readonly type: "clearFocus"; }
  | { readonly type: "loadView"; readonly viewName: string; }
  | { readonly type: "showNeighbors"; readonly nodeId: string; }
  | { readonly type: "clearGhosts"; };
