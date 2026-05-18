/**
 * Interactive diagram canvas: pan, zoom, fit, and drag-to-reposition.
 *
 * Wraps the pure `OrmDiagram` renderer in an `<svg>` with a pan/zoom
 * transform. Hit-testing is done by event delegation against the
 * `data-id` / `data-kind` attributes emitted by `OrmDiagram`.
 */
import type { PositionedGraph } from "@barwise/diagram";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { OrmDiagram } from "./OrmDiagram";
import * as t from "./theme";

export interface DiagramCanvasProps {
  readonly graph: PositionedGraph;
  readonly ghostIds: ReadonlySet<string>;
  readonly selectedId: string | null;
  readonly highlightIds: ReadonlySet<string> | null;
  /** Bumped by the host when a fresh model loads, to trigger a re-fit. */
  readonly resetNonce: number;
  readonly onSelect: (id: string | null, kind: string | null) => void;
  readonly onNodeMoved: (nodeId: string, x: number, y: number) => void;
  readonly onToggleOrientation: (nodeId: string) => void;
  readonly onSaveLayout: () => void;
}

interface View {
  x: number;
  y: number;
  k: number;
}

interface DragState {
  nodeId: string;
  origX: number;
  origY: number;
  startClientX: number;
  startClientY: number;
  moved: boolean;
}

interface PanState {
  startClientX: number;
  startClientY: number;
  origX: number;
  origY: number;
}

const MIN_K = 0.1;
const MAX_K = 5;
const CLICK_THRESHOLD = 3;

export function DiagramCanvas(props: DiagramCanvasProps): JSX.Element {
  const {
    graph,
    ghostIds,
    selectedId,
    highlightIds,
    resetNonce,
    onSelect,
    onNodeMoved,
    onToggleOrientation,
    onSaveLayout,
  } = props;

  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dragDelta, setDragDelta] = useState<{ dx: number; dy: number; }>({ dx: 0, dy: 0 });
  const pan = useRef<PanState | null>(null);

  const fit = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const vw = el.clientWidth;
    const vh = el.clientHeight;
    if (vw === 0 || vh === 0) return;
    const margin = 24;
    const w = graph.width || 1;
    const h = graph.height || 1;
    const k = Math.max(
      MIN_K,
      Math.min(MAX_K, (vw - 2 * margin) / w, (vh - 2 * margin) / h),
    );
    setView({
      x: margin - graph.originX * k,
      y: margin - graph.originY * k,
      k,
    });
  }, [graph]);

  // Re-fit when a fresh model loads.
  useLayoutEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetNonce]);

  // Clear any live drag offset once a fresh graph arrives from the host.
  useEffect(() => {
    setDrag(null);
    setDragDelta({ dx: 0, dy: 0 });
  }, [graph]);

  // Native, non-passive wheel listener so zoom can preventDefault.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      setView((v) => {
        const k = Math.max(MIN_K, Math.min(MAX_K, v.k * factor));
        return {
          x: mx - (mx - v.x) * (k / v.k),
          y: my - (my - v.y) * (k / v.k),
          k,
        };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Window-level move/up handlers for in-progress drag or pan.
  useEffect(() => {
    if (!drag && !pan.current) return;
    const onMove = (e: MouseEvent): void => {
      if (drag) {
        const dx = (e.clientX - drag.startClientX) / view.k;
        const dy = (e.clientY - drag.startClientY) / view.k;
        setDragDelta({ dx, dy });
        if (
          !drag.moved
          && (Math.abs(e.clientX - drag.startClientX) > CLICK_THRESHOLD
            || Math.abs(e.clientY - drag.startClientY) > CLICK_THRESHOLD)
        ) {
          setDrag({ ...drag, moved: true });
        }
      } else if (pan.current) {
        const p = pan.current;
        setView((v) => ({
          ...v,
          x: p.origX + (e.clientX - p.startClientX),
          y: p.origY + (e.clientY - p.startClientY),
        }));
      }
    };
    const onUp = (): void => {
      if (drag) {
        if (drag.moved) {
          onNodeMoved(
            drag.nodeId,
            drag.origX + dragDelta.dx,
            drag.origY + dragDelta.dy,
          );
          // Keep the offset applied until the host sends a fresh graph.
        } else {
          const node = graph.nodes.find((n) => n.id === drag.nodeId);
          onSelect(drag.nodeId, node?.kind ?? null);
          setDrag(null);
          setDragDelta({ dx: 0, dy: 0 });
        }
      }
      pan.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag, dragDelta, view.k, graph, onNodeMoved, onSelect]);

  const hitNode = (target: EventTarget | null): { id: string; kind: string; } | null => {
    if (!(target instanceof Element)) return null;
    const g = target.closest<SVGGElement>("g[data-id][data-kind]");
    if (!g) return null;
    const id = g.getAttribute("data-id");
    const kind = g.getAttribute("data-kind");
    if (!id || !kind) return null;
    return { id, kind };
  };

  const onMouseDown = (e: React.MouseEvent): void => {
    if (e.button !== 0) return;
    const hit = hitNode(e.target);
    if (hit && (hit.kind === "object_type" || hit.kind === "fact_type")) {
      const node = graph.nodes.find((n) => n.id === hit.id);
      if (!node) return;
      e.stopPropagation();
      setDrag({
        nodeId: hit.id,
        origX: node.x,
        origY: node.y,
        startClientX: e.clientX,
        startClientY: e.clientY,
        moved: false,
      });
      setDragDelta({ dx: 0, dy: 0 });
    } else {
      pan.current = {
        startClientX: e.clientX,
        startClientY: e.clientY,
        origX: view.x,
        origY: view.y,
      };
      if (!hit) onSelect(null, null);
    }
  };

  const onDoubleClick = (e: React.MouseEvent): void => {
    const hit = hitNode(e.target);
    if (hit?.kind === "fact_type") {
      e.preventDefault();
      onToggleOrientation(hit.id);
    }
  };

  const zoomBy = (factor: number): void => {
    const el = wrapRef.current;
    if (!el) return;
    const cx = el.clientWidth / 2;
    const cy = el.clientHeight / 2;
    setView((v) => {
      const k = Math.max(MIN_K, Math.min(MAX_K, v.k * factor));
      return {
        x: cx - (cx - v.x) * (k / v.k),
        y: cy - (cy - v.y) * (k / v.k),
        k,
      };
    });
  };

  return (
    <div
      ref={wrapRef}
      className="diagram-canvas"
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      style={{ cursor: drag?.moved ? "move" : "default" }}
    >
      <svg width="100%" height="100%" style={{ display: "block" }}>
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          <OrmDiagram
            graph={graph}
            ghostIds={ghostIds}
            selectedId={selectedId}
            highlightIds={highlightIds}
            dragId={drag?.moved ? drag.nodeId : null}
            dragDx={dragDelta.dx}
            dragDy={dragDelta.dy}
          />
        </g>
      </svg>
      <div className="diagram-controls">
        <button title="Save layout to .orm.yaml" onClick={onSaveLayout}>Save</button>
        <button title="Zoom in" onClick={() => zoomBy(1.2)}>+</button>
        <button title="Zoom out" onClick={() => zoomBy(0.8)}>-</button>
        <button title="Fit to view" onClick={fit}>Fit</button>
      </div>
      <div className="diagram-zoomlabel">{Math.round(view.k * 100)}%</div>
      <DiagramLegend />
    </div>
  );
}

function DiagramLegend(): JSX.Element {
  return (
    <div className="diagram-legend">
      <div className="diagram-legend-title">ORM 2</div>
      <LegendRow label="Entity type">
        <rect
          x={1}
          y={2}
          width={20}
          height={11}
          rx={3}
          fill={t.COLOR_ENTITY_FILL}
          stroke={t.COLOR_ENTITY_STROKE}
          strokeWidth={1.3}
        />
      </LegendRow>
      <LegendRow label="Value type">
        <ellipse
          cx={11}
          cy={7}
          rx={10}
          ry={5.5}
          fill={t.COLOR_VALUE_FILL}
          stroke={t.COLOR_VALUE_STROKE}
          strokeWidth={1.3}
          strokeDasharray="2,1.5"
        />
      </LegendRow>
      <LegendRow label="Fact type">
        <rect
          x={2}
          y={3}
          width={8}
          height={8}
          fill={t.COLOR_ROLE_FILL}
          stroke={t.COLOR_ROLE_STROKE}
        />
        <rect
          x={12}
          y={3}
          width={8}
          height={8}
          fill={t.COLOR_ROLE_FILL}
          stroke={t.COLOR_ROLE_STROKE}
        />
      </LegendRow>
      <LegendRow label="Mandatory">
        <line x1={2} y1={7} x2={13} y2={7} stroke={t.COLOR_EDGE} strokeWidth={1.2} />
        <circle cx={16} cy={7} r={3} fill={t.COLOR_MANDATORY} />
      </LegendRow>
    </div>
  );
}

function LegendRow(props: { label: string; children: React.ReactNode; }): JSX.Element {
  return (
    <div className="diagram-legend-row">
      <svg width={22} height={14}>{props.children}</svg>
      <span>{props.label}</span>
    </div>
  );
}
