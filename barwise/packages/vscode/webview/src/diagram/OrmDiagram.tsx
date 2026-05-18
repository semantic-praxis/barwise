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
import type {
  Position,
  PositionedConstraintEdge,
  PositionedConstraintNode,
  PositionedEdge,
  PositionedFactTypeNode,
  PositionedGraph,
  PositionedObjectTypeNode,
  PositionedRoleBox,
  PositionedSubtypeEdge,
} from "@barwise/diagram";
import * as t from "./theme";

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

function pathData(points: readonly Position[]): string {
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
    .join(" ");
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

// -- Object types --------------------------------------------------------

function ObjectTypeNode(props: {
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

// -- Fact types ----------------------------------------------------------

function FactTypeNode(props: {
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

function RoleBox(props: {
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

// -- Edges ---------------------------------------------------------------

function RoleEdge(props: {
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

function SubtypeEdge(props: {
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

function ConstraintEdge(props: { edge: PositionedConstraintEdge; }): JSX.Element | null {
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

// -- Constraint nodes ----------------------------------------------------

function ConstraintNode(props: {
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
