import type { PositionedConstraintNode } from "@barwise/diagram";
import * as t from "@barwise/diagram/theme";

export function ConstraintNode(props: {
  node: PositionedConstraintNode;
  opacity: number | undefined;
}): JSX.Element {
  const { node, opacity } = props;
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const r = t.CONSTRAINT_RADIUS;
  const stroke = t.COLOR_CONSTRAINT_STROKE;
  const sw = t.CONSTRAINT_STROKE_WIDTH;
  const h = r * 0.55;

  return (
    <g
      data-id={node.id}
      data-kind="constraint"
      data-constraint-kind={node.constraintKind}
      style={{ opacity }}
    >
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill={t.COLOR_CONSTRAINT_FILL}
        stroke={stroke}
        strokeWidth={sw}
      />
      {node.constraintKind === "external_uniqueness" && (
        <rect
          x={cx - (r * 1.2) / 2}
          y={cy - 1}
          width={r * 1.2}
          height={2}
          fill={stroke}
        />
      )}
      {(node.constraintKind === "exclusion" || node.constraintKind === "exclusive_or") && (
        <>
          <line x1={cx - h} y1={cy - h} x2={cx + h} y2={cy + h} stroke={stroke} strokeWidth={sw} />
          <line x1={cx + h} y1={cy - h} x2={cx - h} y2={cy + h} stroke={stroke} strokeWidth={sw} />
        </>
      )}
      {node.constraintKind === "exclusive_or" && (
        <circle cx={cx} cy={cy + r + 5} r={3} fill={stroke} />
      )}
      {node.constraintKind === "disjunctive_mandatory" && (
        <circle cx={cx} cy={cy} r={h} fill={stroke} />
      )}
      {node.constraintKind === "subset" && (
        <>
          <path d={`M ${cx - h} ${cy} L ${cx + h} ${cy}`} stroke={stroke} strokeWidth={sw} />
          <path
            d={`M ${cx + h * 0.3} ${cy - h * 0.6} L ${cx + h} ${cy} L ${cx + h * 0.3} ${
              cy + h * 0.6
            }`}
            stroke={stroke}
            strokeWidth={sw}
            fill="none"
          />
        </>
      )}
      {node.constraintKind === "equality" && (
        <>
          <line
            x1={cx - (r * 1.0) / 2}
            y1={cy - h * 0.4}
            x2={cx + (r * 1.0) / 2}
            y2={cy - h * 0.4}
            stroke={stroke}
            strokeWidth={sw}
          />
          <line
            x1={cx - (r * 1.0) / 2}
            y1={cy + h * 0.4}
            x2={cx + (r * 1.0) / 2}
            y2={cy + h * 0.4}
            stroke={stroke}
            strokeWidth={sw}
          />
        </>
      )}
    </g>
  );
}
