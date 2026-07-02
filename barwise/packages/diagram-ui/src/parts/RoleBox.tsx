import type { PositionedRoleBox } from "@barwise/diagram";
import * as t from "@barwise/diagram/theme";

export function RoleBox(props: {
  parentX: number;
  parentY: number;
  role: PositionedRoleBox;
  vertical: boolean;
}): JSX.Element {
  const { parentX, parentY, role, vertical } = props;
  const x = parentX + role.x;
  const y = parentY + role.y;

  let freqLabel: string | undefined;
  if (role.frequencyMin !== undefined) {
    const max = role.frequencyMax === "unbounded" ? "*" : String(role.frequencyMax);
    freqLabel = role.frequencyMin === role.frequencyMax
      ? String(role.frequencyMin)
      : `${role.frequencyMin}..${max}`;
  }

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={role.width}
        height={role.height}
        fill={t.COLOR_ROLE_FILL}
        stroke={t.COLOR_ROLE_STROKE}
        strokeWidth={1}
      />
      {role.hasUniqueness && (
        vertical
          ? (
            <rect
              x={x - t.UNIQUENESS_BAR_OFFSET - t.UNIQUENESS_BAR_HEIGHT}
              y={y + 4}
              width={t.UNIQUENESS_BAR_HEIGHT}
              height={role.height - 8}
              fill={t.COLOR_UNIQUENESS}
              rx={1}
            />
          )
          : (
            <rect
              x={x + 4}
              y={y - t.UNIQUENESS_BAR_OFFSET - t.UNIQUENESS_BAR_HEIGHT}
              width={role.width - 8}
              height={t.UNIQUENESS_BAR_HEIGHT}
              fill={t.COLOR_UNIQUENESS}
              rx={1}
            />
          )
      )}
      {freqLabel !== undefined && (
        <text
          x={vertical ? x + role.width + 12 : x + role.width / 2}
          y={vertical ? y + role.height / 2 : y + role.height + 12}
          textAnchor={vertical ? "start" : "middle"}
          dominantBaseline={vertical ? "central" : undefined}
          fontSize={t.FONT_SIZE_ANNOTATION}
          fill={t.COLOR_ANNOTATION}
        >
          {freqLabel}
        </text>
      )}
    </g>
  );
}
