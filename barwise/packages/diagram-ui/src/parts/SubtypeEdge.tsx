import type { PositionedSubtypeEdge } from "@barwise/diagram";
import * as t from "@barwise/diagram/theme";
import { pathData } from "./pathData.js";

export function SubtypeEdge(props: {
  edge: PositionedSubtypeEdge;
  ghost: boolean;
  opacity: number | undefined;
}): JSX.Element | null {
  const { edge, ghost, opacity } = props;
  if (edge.points.length < 2) return null;
  return (
    <path
      data-kind="subtype"
      data-source={edge.subtypeNodeId}
      data-target={edge.supertypeNodeId}
      d={pathData(edge.points)}
      fill="none"
      stroke={t.COLOR_SUBTYPE}
      strokeWidth={t.SUBTYPE_STROKE_WIDTH}
      markerEnd="url(#subtype-arrow)"
      style={{ opacity: ghost ? 0.35 : opacity }}
    />
  );
}
