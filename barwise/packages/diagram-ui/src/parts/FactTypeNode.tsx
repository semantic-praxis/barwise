import type { PositionedFactTypeNode } from "@barwise/diagram";
import * as t from "@barwise/diagram/theme";
import { RoleBox } from "./RoleBox.js";

export function FactTypeNode(props: {
  node: PositionedFactTypeNode;
  ghost: boolean;
  selected: boolean;
  opacity: number | undefined;
  dx: number;
  dy: number;
}): JSX.Element {
  const { node, ghost, selected, opacity, dx, dy } = props;
  const hasAnnotations = (node.annotations?.length ?? 0) > 0;
  const vertical = node.orientation === "vertical";
  const first = node.roles[0];
  const last = node.roles[node.roles.length - 1];

  return (
    <g
      data-id={node.id}
      data-kind="fact_type"
      data-ghost={ghost ? "true" : undefined}
      transform={dx || dy ? `translate(${dx},${dy})` : undefined}
      style={{ opacity: ghost ? 0.45 : opacity, cursor: "move" }}
    >
      {hasAnnotations && <title>{node.annotations!.join("\n")}</title>}
      {selected && (
        <rect
          x={node.x - 6}
          y={node.y - 10}
          width={node.width + 12}
          height={node.height + 20}
          rx={5}
          fill="none"
          stroke={t.COLOR_SELECTION}
          strokeWidth={1.5}
          strokeDasharray="4,3"
        />
      )}
      {node.isObjectified && (
        <rect
          data-kind="objectification"
          x={node.x - t.OBJECTIFICATION_PADDING}
          y={node.y - t.OBJECTIFICATION_PADDING}
          width={node.width + t.OBJECTIFICATION_PADDING * 2}
          height={node.height + t.OBJECTIFICATION_PADDING * 2}
          rx={t.OBJECTIFICATION_CORNER_RADIUS}
          ry={t.OBJECTIFICATION_CORNER_RADIUS}
          fill={t.COLOR_OBJECTIFICATION_FILL}
          stroke={t.COLOR_OBJECTIFICATION_STROKE}
          strokeWidth={t.OBJECTIFICATION_STROKE_WIDTH}
        />
      )}
      {node.roles.map((role) => (
        <RoleBox
          key={role.roleId}
          parentX={node.x}
          parentY={node.y}
          role={role}
          vertical={vertical}
        />
      ))}
      {node.hasSpanningUniqueness && first && last && (
        vertical
          ? (
            <rect
              x={node.x - t.UNIQUENESS_BAR_OFFSET - t.UNIQUENESS_BAR_HEIGHT}
              y={node.y + first.y + 4}
              width={t.UNIQUENESS_BAR_HEIGHT}
              height={last.y + last.height - first.y - 8}
              fill={t.COLOR_SPANNING}
              rx={1}
            />
          )
          : (
            <rect
              x={node.x + first.x + 4}
              y={node.y - t.UNIQUENESS_BAR_OFFSET - t.UNIQUENESS_BAR_HEIGHT}
              width={last.x + last.width - first.x - 8}
              height={t.UNIQUENESS_BAR_HEIGHT}
              fill={t.COLOR_SPANNING}
              rx={1}
            />
          )
      )}
      {!node.isObjectified && (
        <text
          x={vertical ? node.x + node.width + 8 : node.x + node.width / 2}
          y={vertical ? node.y + node.height / 2 : node.y + node.height + 14}
          textAnchor={vertical ? "start" : "middle"}
          dominantBaseline={vertical ? "central" : undefined}
          fill={t.COLOR_TEXT}
          fontSize={t.FONT_SIZE_ROLE}
          fontStyle="italic"
        >
          {node.name}
        </text>
      )}
      {node.ringConstraint && (
        <text
          x={vertical ? node.x + node.width + 8 : node.x + node.width / 2}
          y={vertical ? node.y + node.height / 2 + 14 : node.y + node.height + 28}
          textAnchor={vertical ? "start" : "middle"}
          dominantBaseline={vertical ? "central" : undefined}
          fontSize={t.FONT_SIZE_ANNOTATION}
          fill={t.COLOR_ANNOTATION}
        >
          {node.ringConstraint.label}
        </text>
      )}
      {node.isObjectified && node.objectifiedEntityName && (
        <text
          x={vertical ? node.x + node.width + 8 : node.x + node.width / 2}
          y={vertical
            ? node.y + node.height / 2 + (node.ringConstraint ? 28 : 14)
            : node.y + node.height + (node.ringConstraint ? 42 : 28)}
          textAnchor={vertical ? "start" : "middle"}
          dominantBaseline={vertical ? "central" : undefined}
          fill={t.COLOR_OBJECTIFICATION_STROKE}
          fontSize={t.FONT_SIZE_LABEL}
          fontWeight={600}
        >
          {node.objectifiedEntityName}
        </text>
      )}
    </g>
  );
}
