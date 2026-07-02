import type { PositionedObjectTypeNode } from "@barwise/diagram";
import * as t from "@barwise/diagram/theme";

export function ObjectTypeNode(props: {
  node: PositionedObjectTypeNode;
  ghost: boolean;
  selected: boolean;
  opacity: number | undefined;
  dx: number;
  dy: number;
}): JSX.Element {
  const { node, ghost, selected, opacity, dx, dy } = props;
  const isEntity = node.objectTypeKind === "entity";
  const hasAnnotations = (node.annotations?.length ?? 0) > 0;
  const fill = isEntity ? t.COLOR_ENTITY_FILL : t.COLOR_VALUE_FILL;
  const stroke = hasAnnotations
    ? t.COLOR_ANNOTATION_STROKE
    : isEntity
    ? t.COLOR_ENTITY_STROKE
    : t.COLOR_VALUE_STROKE;
  const dash = hasAnnotations ? t.ANNOTATION_DASH : isEntity ? undefined : "4,3";
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;

  const hasAliases = (node.aliases?.length ?? 0) > 0;
  const hasRefMode = node.referenceMode !== undefined;
  const nameOffset = hasAliases && hasRefMode ? -8 : hasAliases || hasRefMode ? -3 : 0;

  return (
    <g
      data-id={node.id}
      data-kind="object_type"
      data-ghost={ghost ? "true" : undefined}
      transform={dx || dy ? `translate(${dx},${dy})` : undefined}
      style={{ opacity: ghost ? 0.45 : opacity, cursor: "move" }}
    >
      {hasAnnotations && <title>{node.annotations!.join("\n")}</title>}
      {selected && (
        <rect
          x={node.x - 4}
          y={node.y - 4}
          width={node.width + 8}
          height={node.height + 8}
          rx={t.OT_CORNER_RADIUS + 2}
          fill="none"
          stroke={t.COLOR_SELECTION}
          strokeWidth={1.5}
          strokeDasharray="4,3"
        />
      )}
      {isEntity
        ? (
          <rect
            x={node.x}
            y={node.y}
            width={node.width}
            height={node.height}
            rx={t.OT_CORNER_RADIUS}
            ry={t.OT_CORNER_RADIUS}
            fill={fill}
            stroke={stroke}
            strokeWidth={1.5}
            strokeDasharray={ghost ? "6,3" : dash}
          />
        )
        : (
          <ellipse
            cx={cx}
            cy={cy}
            rx={node.width / 2}
            ry={node.height / 2}
            fill={fill}
            stroke={stroke}
            strokeWidth={1.5}
            strokeDasharray={dash ?? "4,3"}
          />
        )}
      {hasAnnotations && (
        <circle
          cx={node.x + node.width - 4}
          cy={node.y + 4}
          r={t.ANNOTATION_MARKER_RADIUS}
          fill={t.COLOR_ANNOTATION_MARKER}
        />
      )}
      <text
        x={cx}
        y={cy + nameOffset}
        textAnchor="middle"
        dominantBaseline="central"
        fill={t.COLOR_TEXT}
        fontSize={t.FONT_SIZE_LABEL}
        fontWeight={600}
      >
        {node.name}
      </text>
      {hasRefMode && (
        <text
          x={cx}
          y={hasAliases ? cy + 5 : cy + 12}
          textAnchor="middle"
          dominantBaseline="central"
          fill={t.COLOR_REF_MODE}
          fontSize={t.FONT_SIZE_REF_MODE}
        >
          ({node.referenceMode})
        </text>
      )}
      {hasAliases && (
        <text
          x={cx}
          y={hasRefMode ? cy + 18 : cy + 12}
          textAnchor="middle"
          dominantBaseline="central"
          fill={t.COLOR_ALIAS}
          fontSize={t.FONT_SIZE_ALIAS}
          fontStyle="italic"
        >
          (a.k.a. {node.aliases!.map((a) => `'${a}'`).join(", ")})
        </text>
      )}
    </g>
  );
}
