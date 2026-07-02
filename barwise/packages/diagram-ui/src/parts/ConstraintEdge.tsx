import type { PositionedConstraintEdge } from "@barwise/diagram";
import * as t from "@barwise/diagram/theme";
import { pathData } from "./pathData.js";

export function ConstraintEdge(props: { edge: PositionedConstraintEdge; }): JSX.Element | null {
  const { edge } = props;
  if (edge.points.length < 2) return null;
  return (
    <path
      data-kind="constraint-edge"
      d={pathData(edge.points)}
      fill="none"
      stroke={t.COLOR_CONSTRAINT_STROKE}
      strokeWidth={t.CONSTRAINT_STROKE_WIDTH}
      strokeDasharray={t.CONSTRAINT_EDGE_DASH}
    />
  );
}
