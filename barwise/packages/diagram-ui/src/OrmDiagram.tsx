/**
 * React/SVG renderer for a positioned ORM graph.
 *
 * A faithful transcription of `@barwise/diagram`'s `SvgRenderer.ts`:
 * given the same `PositionedGraph`, it produces the same ORM 2 notation
 * (entity rounded-rects, dashed value ellipses, role boxes, uniqueness
 * bars, mandatory dots, frequency / ring labels, objectification boxes,
 * subtype arrows, external constraint symbols) -- but as a React tree so
 * the editor can layer interaction on individual elements.
 *
 * This component is purely presentational. Hit-testing is done by the
 * parent canvas via event delegation on the `data-id` / `data-kind`
 * attributes, exactly as the legacy webview did.
 */
import type { PositionedGraph } from "@barwise/diagram";
import * as t from "@barwise/diagram/theme";
import { ConstraintEdge } from "./parts/ConstraintEdge.js";
import { ConstraintNode } from "./parts/ConstraintNode.js";
import { FactTypeNode } from "./parts/FactTypeNode.js";
import { ObjectTypeNode } from "./parts/ObjectTypeNode.js";
import { RoleEdge } from "./parts/RoleEdge.js";
import { SubtypeEdge } from "./parts/SubtypeEdge.js";

export interface OrmDiagramProps {
  readonly graph: PositionedGraph;
  readonly ghostIds: ReadonlySet<string>;
  readonly selectedId: string | null;
  /** When non-null, elements outside the set are dimmed. */
  readonly highlightIds: ReadonlySet<string> | null;
  /** Id of the node currently being dragged (offset applied live). */
  readonly dragId: string | null;
  readonly dragDx: number;
  readonly dragDy: number;
}

function dimOpacity(
  id: string,
  highlightIds: ReadonlySet<string> | null,
): number | undefined {
  if (highlightIds === null) return undefined;
  return highlightIds.has(id) ? 1 : 0.15;
}

export function OrmDiagram(props: OrmDiagramProps): JSX.Element {
  const { graph, ghostIds, selectedId, highlightIds, dragId, dragDx, dragDy } = props;
  const hasSubtypes = graph.subtypeEdges.length > 0;

  return (
    <g className="orm-content">
      {hasSubtypes && (
        <defs>
          <marker
            id="subtype-arrow"
            viewBox={`0 0 ${t.SUBTYPE_ARROW_SIZE} ${t.SUBTYPE_ARROW_SIZE}`}
            refX={t.SUBTYPE_ARROW_SIZE}
            refY={t.SUBTYPE_ARROW_SIZE / 2}
            markerWidth={t.SUBTYPE_ARROW_SIZE}
            markerHeight={t.SUBTYPE_ARROW_SIZE}
            orient="auto-start-reverse"
          >
            <path
              d={`M 0 0 L ${t.SUBTYPE_ARROW_SIZE} ${
                t.SUBTYPE_ARROW_SIZE / 2
              } L 0 ${t.SUBTYPE_ARROW_SIZE} Z`}
              fill={t.COLOR_SUBTYPE}
            />
          </marker>
        </defs>
      )}

      {graph.edges.map((edge, i) => (
        <RoleEdge
          key={`edge-${i}`}
          edge={edge}
          ghost={ghostIds.has(edge.sourceNodeId) || ghostIds.has(edge.targetNodeId)}
          opacity={edgeOpacity(edge.sourceNodeId, edge.targetNodeId, highlightIds)}
        />
      ))}

      {graph.constraintEdges.map((ce, i) => <ConstraintEdge key={`ce-${i}`} edge={ce} />)}

      {graph.subtypeEdges.map((se, i) => (
        <SubtypeEdge
          key={`se-${i}`}
          edge={se}
          ghost={ghostIds.has(se.subtypeNodeId) || ghostIds.has(se.supertypeNodeId)}
          opacity={edgeOpacity(se.subtypeNodeId, se.supertypeNodeId, highlightIds)}
        />
      ))}

      {graph.nodes.map((node) => {
        const ghost = ghostIds.has(node.id);
        const opacity = dimOpacity(node.id, highlightIds);
        const selected = node.id === selectedId;
        const dx = node.id === dragId ? dragDx : 0;
        const dy = node.id === dragId ? dragDy : 0;
        if (node.kind === "object_type") {
          return (
            <ObjectTypeNode
              key={node.id}
              node={node}
              ghost={ghost}
              selected={selected}
              opacity={opacity}
              dx={dx}
              dy={dy}
            />
          );
        }
        if (node.kind === "fact_type") {
          return (
            <FactTypeNode
              key={node.id}
              node={node}
              ghost={ghost}
              selected={selected}
              opacity={opacity}
              dx={dx}
              dy={dy}
            />
          );
        }
        return <ConstraintNode key={node.id} node={node} opacity={opacity} />;
      })}
    </g>
  );
}

function edgeOpacity(
  sourceId: string,
  targetId: string,
  highlightIds: ReadonlySet<string> | null,
): number | undefined {
  if (highlightIds === null) return undefined;
  return highlightIds.has(sourceId) && highlightIds.has(targetId) ? 1 : 0.15;
}
