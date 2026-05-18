/**
 * Root of the diagram webview application.
 *
 * Owns the diagram state pushed by the extension host, drives the typed
 * message protocol, and lays out the shell: top bar, center pane, right
 * inspector, bottom strip. Phase 1 ships the diagram pane and inspector;
 * the left model tree and the alternate tabs land in later phases.
 */
import type { PositionedGraph } from "@barwise/diagram";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DiagramMeta } from "../../src/diagram/protocol";
import { BottomStrip } from "./components/BottomStrip";
import { Inspector } from "./components/Inspector";
import { TabPlaceholder } from "./components/TabPlaceholder";
import { type TabKey, TopBar } from "./components/TopBar";
import { DiagramCanvas } from "./diagram/DiagramCanvas";
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

  const selectedNode = useMemo(
    () => graph?.nodes.find((n) => n.id === selectedId) ?? null,
    [graph, selectedId],
  );

  return (
    <div className="app">
      <TopBar
        modelName={meta?.modelName ?? "ORM Model"}
        activeTab={tab}
        onTabChange={setTab}
      />
      <div className="main-row">
        <div className="center">
          {tab === "diagram"
            ? (
              graph
                ? (
                  <DiagramCanvas
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
          <Inspector node={selectedNode} graph={graph} />
        </div>
      </div>
      <BottomStrip graph={graph} meta={meta} />
    </div>
  );
}
