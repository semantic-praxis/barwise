import type { PositionedEdge } from "@barwise/diagram";
import * as t from "@barwise/diagram/theme";
import { pathData } from "./pathData.js";

export function RoleEdge(props: {
  edge: PositionedEdge;
  ghost: boolean;
  opacity: number | undefined;
}): JSX.Element | null {
  const { edge, ghost, opacity } = props;
  if (edge.points.length < 2) return null;

  const rc = edge.points[edge.points.length - 1]!;
  const ep = edge.points[0]!;
  let dot: JSX.Element | null = null;
  if (edge.isMandatory) {
    const dx = ep.x - rc.x;
    const dy = ep.y - rc.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 1) {
      const offset = 20;
      dot = (
        <circle
          cx={rc.x + (dx / dist) * offset}
          cy={rc.y + (dy / dist) * offset}
          r={t.MANDATORY_DOT_RADIUS}
          fill={t.COLOR_MANDATORY}
        />
      );
    }
  }

  return (
    <g style={{ opacity: ghost ? 0.35 : opacity }}>
      <path
        data-kind="edge"
        data-source={edge.sourceNodeId}
        data-target={edge.targetNodeId}
        d={pathData(edge.points)}
        fill="none"
        stroke={t.COLOR_EDGE}
        strokeWidth={1.2}
      />
      {dot}
    </g>
  );
}
