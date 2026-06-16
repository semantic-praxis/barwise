/**
 * Typed message protocol for the diagram webview.
 *
 * Thin envelopes over the `@barwise/diagram` presentation contract: the
 * host posts a `DiagramPresentation`'s data to the webview, and the
 * webview posts back interaction messages the host maps to a
 * `DiagramIntent`. The domain types (focus, view, graph) come from the
 * contract so there is one source of truth; `fileName` is a host concept
 * and lives only here.
 */
import type { DiagramFocus, DiagramViewInfo, PositionedGraph } from "@barwise/diagram";

/** Diagram-level metadata sent alongside every graph update. */
export interface DiagramMeta {
  readonly fileName: string;
  readonly modelName: string;
  readonly hasUnsavedChanges: boolean;
  readonly focus: DiagramFocus | null;
  readonly view: DiagramViewInfo | null;
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
