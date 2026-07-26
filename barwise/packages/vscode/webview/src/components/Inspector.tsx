/**
 * Right inspector pane: contextual detail for the selected element.
 *
 * Detail comes from two layers: the positioned graph (geometry-adjacent
 * facts like orientation and ghost state) and the serialized model
 * summary (modernization Phase 2: readings, constraints, data types,
 * played-in fact types). The summary also lets the inspector describe
 * elements selected from the model tree that the current filtered view
 * does not render.
 */
import type {
  ModelSummary,
  PositionedFactTypeNode,
  PositionedNode,
  PositionedObjectTypeNode,
  SummaryFactType,
  SummaryObjectType,
} from "@barwise/diagram";
import type { DiagramMeta } from "../../../src/diagram/protocol";

const HOP_CHOICES = [1, 2, 3] as const;

export interface InspectorProps {
  /** The selected node in the rendered graph, if present there. */
  readonly node: PositionedNode | null;
  /** The selected element id (may exist only in the summary). */
  readonly selectedId: string | null;
  readonly meta: DiagramMeta | null;
  /** True when the selected node is a ghost-neighbor preview. */
  readonly isGhost: boolean;
  readonly onFocus: (nodeId: string, hopCount: number) => void;
  readonly onShowNeighbors: (nodeId: string) => void;
  readonly onAddToView: (nodeId: string) => void;
  /** Select a related element (a played-in fact type, a role player). */
  readonly onSelectRelated: (id: string) => void;
}

export function Inspector(props: InspectorProps): JSX.Element {
  const { node, selectedId, meta, isGhost } = props;
  const summary = meta?.modelSummary ?? null;

  const summaryObjectType = selectedId && summary
    ? summary.objectTypes.find((ot) => ot.id === selectedId) ?? null
    : null;
  const summaryFactType = selectedId && summary
    ? summary.factTypes.find((ft) => ft.id === selectedId) ?? null
    : null;
  const summarySubtype = selectedId && summary
    ? summary.subtypes.find((sf) => sf.id === selectedId) ?? null
    : null;

  if (summaryObjectType || (node && node.kind === "object_type")) {
    return (
      <ObjectTypeDetail
        {...props}
        node={node?.kind === "object_type" ? node : null}
        detail={summaryObjectType}
        summary={summary}
        isGhost={isGhost}
      />
    );
  }
  if (summaryFactType || (node && node.kind === "fact_type")) {
    return (
      <FactTypeDetail
        node={node?.kind === "fact_type" ? node : null}
        detail={summaryFactType}
        onSelectRelated={props.onSelectRelated}
      />
    );
  }
  if (summarySubtype) {
    return (
      <div className="inspector-body">
        <Header
          kind="subtype"
          name={`${summarySubtype.subtypeName} is a ${summarySubtype.supertypeName}`}
        />
        <Field label="Subtype">
          <button
            type="button"
            className="inspector-link"
            onClick={() => props.onSelectRelated(summarySubtype.subtypeId)}
          >
            {summarySubtype.subtypeName}
          </button>
        </Field>
        <Field label="Supertype">
          <button
            type="button"
            className="inspector-link"
            onClick={() => props.onSelectRelated(summarySubtype.supertypeId)}
          >
            {summarySubtype.supertypeName}
          </button>
        </Field>
        <Field label="Provides identification">
          {summarySubtype.providesIdentification ? "yes" : "no"}
        </Field>
      </div>
    );
  }
  if (node) {
    return (
      <div className="inspector-body">
        <Header kind="constraint" name="External constraint" />
        {node.kind === "constraint" && (
          <>
            <Field label="Kind">{node.constraintKind.replace(/_/g, " ")}</Field>
            <Field label="Covered roles">{node.roleIds.length}</Field>
          </>
        )}
      </div>
    );
  }
  return (
    <div className="inspector-body inspector-empty">
      Select an element in the diagram or the model tree to see its details.
    </div>
  );
}

function ObjectTypeDetail(
  props: InspectorProps & {
    node: PositionedObjectTypeNode | null;
    detail: SummaryObjectType | null;
    summary: ModelSummary | null;
  },
): JSX.Element {
  const { node, detail, summary, meta, isGhost, onSelectRelated } = props;
  const name = detail?.name ?? node?.name ?? "";
  const kind = detail?.kind ?? node?.objectTypeKind ?? "entity";
  const id = detail?.id ?? node?.id ?? null;
  const inGraph = node != null;

  const playedIn = detail && summary
    ? detail.factTypeIds
      .map((ftId) => summary.factTypes.find((ft) => ft.id === ftId))
      .filter((ft): ft is SummaryFactType => ft !== undefined)
    : [];

  return (
    <div className="inspector-body">
      <Header kind={isGhost ? "neighbor" : kind} name={name} />
      {!inGraph && <div className="inspector-note">Not in the current view.</div>}
      {(detail?.referenceMode ?? node?.referenceMode) && (
        <Field label="Reference mode">{detail?.referenceMode ?? node?.referenceMode}</Field>
      )}
      {detail?.dataType && <Field label="Data type">{detail.dataType}</Field>}
      {(detail?.aliases ?? node?.aliases)
        && (detail?.aliases ?? node?.aliases)!.length > 0 && (
        <Field label="Aliases">{(detail?.aliases ?? node?.aliases)!.join(", ")}</Field>
      )}
      {node?.annotations && node.annotations.length > 0 && (
        <Field label="Annotations">
          {node.annotations.map((a, i) => <div key={i}>{a}</div>)}
        </Field>
      )}
      {playedIn.length > 0 && (
        <Field label={`Plays roles in (${playedIn.length})`}>
          {playedIn.map((ft) => (
            <button
              type="button"
              key={ft.id}
              className="inspector-link"
              onClick={() => onSelectRelated(ft.id)}
            >
              {ft.name}
            </button>
          ))}
        </Field>
      )}
      {id && inGraph && (
        <ObjectTypeActions
          nodeId={id}
          meta={meta}
          isGhost={isGhost}
          onFocus={props.onFocus}
          onShowNeighbors={props.onShowNeighbors}
          onAddToView={props.onAddToView}
        />
      )}
    </div>
  );
}

function ObjectTypeActions(props: {
  nodeId: string;
  meta: DiagramMeta | null;
  isGhost: boolean;
  onFocus: (nodeId: string, hopCount: number) => void;
  onShowNeighbors: (nodeId: string) => void;
  onAddToView: (nodeId: string) => void;
}): JSX.Element {
  const { nodeId, meta, isGhost, onFocus, onShowNeighbors, onAddToView } = props;
  const activeHop = meta?.focus?.entityId === nodeId ? meta.focus.hopCount : null;
  const viewActive = meta?.view != null;

  return (
    <div className="inspector-actions">
      <div className="inspector-field-label">Focus neighborhood</div>
      <div className="inspector-hops">
        {HOP_CHOICES.map((hop) => (
          <button
            type="button"
            key={hop}
            className={"inspector-hop" + (hop === activeHop ? " active" : "")}
            title={`Focus on this entity and ${hop} ${hop === 1 ? "hop" : "hops"} out`}
            onClick={() => onFocus(nodeId, hop)}
          >
            {hop} {hop === 1 ? "hop" : "hops"}
          </button>
        ))}
      </div>
      {viewActive && isGhost && (
        <button
          type="button"
          className="inspector-action"
          onClick={() => onAddToView(nodeId)}
        >
          Add to view
        </button>
      )}
      {viewActive && !isGhost && (
        <button
          type="button"
          className="inspector-action"
          title="Preview entities adjacent to the current view as ghosts"
          onClick={() => onShowNeighbors(nodeId)}
        >
          Show neighbors
        </button>
      )}
    </div>
  );
}

function FactTypeDetail(props: {
  node: PositionedFactTypeNode | null;
  detail: SummaryFactType | null;
  onSelectRelated: (id: string) => void;
}): JSX.Element {
  const { node, detail, onSelectRelated } = props;
  const name = detail?.name ?? node?.name ?? "";
  const arity = detail?.roles.length ?? node?.roles.length ?? 0;
  const arityLabel = arity === 1
    ? "unary"
    : arity === 2
    ? "binary"
    : arity === 3
    ? "ternary"
    : `${arity}-ary`;
  return (
    <div className="inspector-body">
      <Header kind="fact" name={name} />
      {!node && <div className="inspector-note">Not in the current view.</div>}
      <Field label="Arity">{arityLabel}</Field>
      {node && <Field label="Orientation">{node.orientation}</Field>}
      {node?.isObjectified && (
        <Field label="Objectified as">{node.objectifiedEntityName ?? name}</Field>
      )}
      {node?.ringConstraint && <Field label="Ring constraint">{node.ringConstraint.label}</Field>}
      {detail && detail.readings.length > 0 && (
        <Field label="Readings">
          {detail.readings.map((r, i) => <div key={i} className="inspector-reading">{r}</div>)}
        </Field>
      )}
      <Field label={`Roles (${arity})`}>
        {detail
          ? detail.roles.map((r, i) => (
            <div key={r.id} className="inspector-role">
              <span className="inspector-role-idx">{i + 1}</span>
              <span className="inspector-role-name">{r.name || "(unnamed)"}</span>
              <button
                type="button"
                className="inspector-link inspector-role-player"
                onClick={() => onSelectRelated(r.playerId)}
              >
                {r.playerName}
              </button>
            </div>
          ))
          : node?.roles.map((r, i) => (
            <div key={r.roleId} className="inspector-role">
              <span className="inspector-role-idx">{i + 1}</span>
              <span className="inspector-role-name">{r.roleName || "(unnamed)"}</span>
              <span className="inspector-role-player">{r.playerName}</span>
              {r.isMandatory && <span className="inspector-tag">mand</span>}
              {r.hasUniqueness && <span className="inspector-tag">uniq</span>}
            </div>
          ))}
      </Field>
      {detail && detail.constraints.length > 0 && (
        <Field label={`Constraints (${detail.constraints.length})`}>
          {detail.constraints.map((c, i) => (
            <div key={c.id ?? i} className="inspector-constraint">
              {c.type.replace(/_/g, " ")}
            </div>
          ))}
        </Field>
      )}
      {node?.hasSpanningUniqueness && <Field label="Uniqueness">spanning all roles</Field>}
    </div>
  );
}

function Header(props: { kind: string; name: string; }): JSX.Element {
  return (
    <div className="inspector-header">
      <span className="inspector-name">{props.name}</span>
      <span className="inspector-kind">{props.kind}</span>
    </div>
  );
}

function Field(props: { label: string; children: React.ReactNode; }): JSX.Element {
  return (
    <div className="inspector-field">
      <div className="inspector-field-label">{props.label}</div>
      <div className="inspector-field-value">{props.children}</div>
    </div>
  );
}
