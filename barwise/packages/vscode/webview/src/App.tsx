/**
 * Root of the diagram webview application.
 *
 * Owns the diagram state pushed by the extension host, drives the typed
 * message protocol, and lays out the shell: top bar, context bar, center
 * pane, right inspector, bottom strip, and the command palette. Phase 1
 * ships the diagram pane, the inspector, and the focus / views / ghost
 * affordances; the left model tree and the alternate tabs land later.
 */
import type { PositionedGraph } from "@barwise/diagram";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DiagramMeta } from "../../src/diagram/protocol";
import { buildCommands } from "./commands";
import { BottomStrip } from "./components/BottomStrip";
import { CommandPalette } from "./components/CommandPalette";
import { ContextBar } from "./components/ContextBar";
import { Inspector } from "./components/Inspector";
import { TabPlaceholder } from "./components/TabPlaceholder";
import { type TabKey, TopBar } from "./components/TopBar";
import { DiagramCanvas, type DiagramCanvasHandle } from "./diagram/DiagramCanvas";
import { onMessage, postMessage } from "./vscodeApi";

/** Node id + its directly connected neighbours, for the highlight overlay. */
function computeConnected(graph: PositionedGraph, id: string): Set<string> {
  const set = new Set<string>([id]);
  for (const e of graph.edges) {
    if (e.sourceNodeId === id) set.add(e.targetNodeId);
    if (e.targetNodeId === id) set.add(e.sourceNodeId);
  }
  for (const ce of graph.constraintEdges) {
    if (ce.constraintNodeId === id) set.add(ce.factTypeNodeId);
    if (ce.factTypeNodeId === id) set.add(ce.constraintNodeId);
  }
  for (const se of graph.subtypeEdges) {
    if (se.subtypeNodeId === id) set.add(se.supertypeNodeId);
    if (se.supertypeNodeId === id) set.add(se.subtypeNodeId);
  }
  return set;
}

export function App(): JSX.Element {
  const [graph, setGraph] = useState<PositionedGraph | null>(null);
  const [ghostIds, setGhostIds] = useState<ReadonlySet<string>>(new Set());
  const [meta, setMeta] = useState<DiagramMeta | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlightIds, setHighlightIds] = useState<ReadonlySet<string> | null>(null);
  const [resetNonce, setResetNonce] = useState(0);
  const [tab, setTab] = useState<TabKey>("diagram");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const canvasRef = useRef<DiagramCanvasHandle>(null);

  useEffect(() => {
    const unsubscribe = onMessage((msg) => {
      if (msg.type === "setGraph") {
        setGraph(msg.graph);
        setGhostIds(new Set(msg.ghostNodeIds));
        setMeta(msg.meta);
        if (msg.resetView) setResetNonce((n) => n + 1);
      } else if (msg.type === "highlight") {
        setGraph((g) => {
          setHighlightIds(g ? computeConnected(g, msg.elementId) : new Set([msg.elementId]));
          return g;
        });
        setSelectedId(msg.elementId);
      } else if (msg.type === "clearHighlight") {
        setHighlightIds(null);
      }
    });
    postMessage({ type: "ready" });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (e.key === "Escape") {
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleSelect = useCallback((id: string | null, _kind: string | null): void => {
    setSelectedId(id);
    postMessage({ type: "selectElement", elementId: id });
    setHighlightIds(id && graph ? computeConnected(graph, id) : null);
  }, [graph]);

  const handleNodeMoved = useCallback((nodeId: string, x: number, y: number): void => {
    postMessage({ type: "nodeMoved", nodeId, x, y });
  }, []);

  const handleToggleOrientation = useCallback((nodeId: string): void => {
    postMessage({ type: "toggleOrientation", nodeId });
  }, []);

  const handleSaveLayout = useCallback((): void => {
    postMessage({ type: "saveLayout" });
  }, []);

  const handleFocus = useCallback((nodeId: string, hopCount: number): void => {
    postMessage({ type: "focusEntity", nodeId, hopCount });
  }, []);

  const handleClearFocus = useCallback((): void => {
    postMessage({ type: "clearFocus" });
  }, []);

  const handleShowNeighbors = useCallback((nodeId: string): void => {
    postMessage({ type: "showNeighbors", nodeId });
  }, []);

  const handleAddToView = useCallback((nodeId: string): void => {
    postMessage({ type: "addGhostToView", nodeId });
  }, []);

  const handleClearGhosts = useCallback((): void => {
    postMessage({ type: "clearGhosts" });
  }, []);

  const handleSaveView = useCallback((): void => {
    postMessage({ type: "saveView" });
  }, []);

  const handleLoadView = useCallback((viewName: string): void => {
    postMessage({ type: "loadView", viewName });
  }, []);

  const fit = useCallback((): void => canvasRef.current?.fit(), []);
  const zoomIn = useCallback((): void => canvasRef.current?.zoomIn(), []);
  const zoomOut = useCallback((): void => canvasRef.current?.zoomOut(), []);

  const selectedNode = useMemo(
    () => graph?.nodes.find((n) => n.id === selectedId) ?? null,
    [graph, selectedId],
  );
  const isSelectedGhost = selectedId != null && ghostIds.has(selectedId);

  const commands = useMemo(
    () =>
      buildCommands({
        meta,
        selectedNode,
        isSelectedGhost,
        actions: {
          focusEntity: handleFocus,
          clearFocus: handleClearFocus,
          showNeighbors: handleShowNeighbors,
          addGhostToView: handleAddToView,
          clearGhosts: handleClearGhosts,
          saveView: handleSaveView,
          loadView: handleLoadView,
          saveLayout: handleSaveLayout,
          fit,
          zoomIn,
          zoomOut,
          setTab,
        },
      }),
    [
      meta,
      selectedNode,
      isSelectedGhost,
      handleFocus,
      handleClearFocus,
      handleShowNeighbors,
      handleAddToView,
      handleClearGhosts,
      handleSaveView,
      handleLoadView,
      handleSaveLayout,
      fit,
      zoomIn,
      zoomOut,
    ],
  );

  return (
    <div className="app">
      <TopBar
        modelName={meta?.modelName ?? "ORM Model"}
        activeTab={tab}
        onTabChange={setTab}
        availableViews={meta?.availableViews ?? []}
        activeView={meta?.view?.viewName ?? null}
        onLoadView={handleLoadView}
        onSaveView={handleSaveView}
        onShowFull={handleClearFocus}
        onOpenPalette={() => setPaletteOpen(true)}
      />
      {tab === "diagram" && meta && (
        <ContextBar
          meta={meta}
          onSetHop={handleFocus}
          onClearFocus={handleClearFocus}
          onClearGhosts={handleClearGhosts}
        />
      )}
      <div className="main-row">
        <div className="center">
          {tab === "diagram"
            ? (
              graph
                ? (
                  <DiagramCanvas
                    ref={canvasRef}
                    graph={graph}
                    ghostIds={ghostIds}
                    selectedId={selectedId}
                    highlightIds={highlightIds}
                    resetNonce={resetNonce}
                    onSelect={handleSelect}
                    onNodeMoved={handleNodeMoved}
                    onToggleOrientation={handleToggleOrientation}
                    onSaveLayout={handleSaveLayout}
                  />
                )
                : <div className="empty-state">Loading model…</div>
            )
            : <TabPlaceholder tab={tab} />}
        </div>
        <div className="inspector">
          <Inspector
            node={selectedNode}
            graph={graph}
            meta={meta}
            isGhost={isSelectedGhost}
            onFocus={handleFocus}
            onShowNeighbors={handleShowNeighbors}
            onAddToView={handleAddToView}
          />
        </div>
      </div>
      <BottomStrip graph={graph} meta={meta} />
      {paletteOpen && <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}
