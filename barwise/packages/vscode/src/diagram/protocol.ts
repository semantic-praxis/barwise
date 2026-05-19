/**
 * Typed message protocol for the diagram webview.
 *
 * Shared by the extension host (`DiagramPanel`) and the React webview.
 * Replaces the legacy ad-hoc `{ command, nodeId, x, y }` messages.
 *
 * `PositionedGraph` is imported as a type only -- it is plain serializable
 * data, so it crosses `postMessage` unchanged, and the import is erased at
 * build time (the webview links no `@barwise/*` runtime code).
 */
import type { PositionedGraph } from "@barwise/diagram";

/** Active focus (hop-count) neighborhood state. */
export interface DiagramFocusState {
  readonly entityId: string;
  readonly entityName: string;
  readonly hopCount: number;
}

/** Active named-view state. */
export interface DiagramViewState {
  readonly viewName: string;
  readonly hasGhosts: boolean;
}

/** Diagram-level metadata sent alongside every graph update. */
export interface DiagramMeta {
  readonly fileName: string;
  readonly modelName: string;
  readonly hasUnsavedChanges: boolean;
  readonly focus: DiagramFocusState | null;
  readonly view: DiagramViewState | null;
  /** Names of every saved layout in the model's `diagrams:` section. */
  readonly availableViews: readonly string[];
}

/** Messages sent from the extension host to the webview. */
export type InboundMessage =
  | {
    readonly type: "setGraph";
    readonly graph: PositionedGraph;
    readonly ghostNodeIds: readonly string[];
    readonly meta: DiagramMeta;
    /** When true, the webview re-fits the diagram to the viewport. */
    readonly resetView: boolean;
  }
  | {
    readonly type: "highlight";
    readonly elementId: string;
    readonly elementKind: string;
  }
  | { readonly type: "clearHighlight"; };

/** Messages sent from the webview to the extension host. */
export type OutboundMessage =
  | { readonly type: "ready"; }
  | {
    readonly type: "nodeMoved";
    readonly nodeId: string;
    /** New top-left coordinates of the node, in graph units. */
    readonly x: number;
    readonly y: number;
  }
  | { readonly type: "toggleOrientation"; readonly nodeId: string; }
  | { readonly type: "saveLayout"; }
  | { readonly type: "selectElement"; readonly elementId: string | null; }
  | { readonly type: "focusEntity"; readonly nodeId: string; readonly hopCount: number; }
  | { readonly type: "clearFocus"; }
  | { readonly type: "saveView"; }
  | { readonly type: "loadView"; readonly viewName: string; }
  | { readonly type: "showNeighbors"; readonly nodeId: string; }
  | { readonly type: "addGhostToView"; readonly nodeId: string; }
  | { readonly type: "clearGhosts"; };
