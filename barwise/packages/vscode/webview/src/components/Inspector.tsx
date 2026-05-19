/**
 * Right inspector pane: contextual detail for the selected diagram
 * element, read from the positioned graph, plus the focus / neighbor
 * affordances for the selected object type.
 */
import type {
  PositionedFactTypeNode,
  PositionedGraph,
  PositionedNode,
  PositionedObjectTypeNode,
} from "@barwise/diagram";
import type { DiagramMeta } from "../../../src/diagram/protocol";

const HOP_CHOICES = [1, 2, 3] as const;

export interface InspectorProps {
  readonly node: PositionedNode | null;
  readonly graph: PositionedGraph | null;
  readonly meta: DiagramMeta | null;
  /** True when the selected node is a ghost-neighbor preview. */
  readonly isGhost: boolean;
  readonly onFocus: (nodeId: string, hopCount: number) => void;
  readonly onShowNeighbors: (nodeId: string) => void;
  readonly onAddToView: (nodeId: string) => void;
}

export function Inspector(props: InspectorProps): JSX.Element {
  const { node, graph, meta, isGhost, onFocus, onShowNeighbors, onAddToView } = props;
  if (!node) {
    return (
      <div className="inspector-body inspector-empty">
        Select an element in the diagram to see its details.
      </div>
    );
  }
  if (node.kind === "object_type") {
    return (
      <ObjectTypeDetail
        node={node}
        graph={graph}
        meta={meta}
        isGhost={isGhost}
        onFocus={onFocus}
        onShowNeighbors={onShowNeighbors}
        onAddToView={onAddToView}
      />
    );
  }
  if (node.kind === "fact_type") {
    return <FactTypeDetail node={node} />;
  }
  return (
    <div className="inspector-body">
      <Header kind="constraint" name="External constraint" />
      <Field label="Kind">{node.constraintKind.replace(/_/g, " ")}</Field>
      <Field label="Covered roles">{node.roleIds.length}</Field>
    </div>
  );
}

function ObjectTypeDetail(props: {
  node: PositionedObjectTypeNode;
  graph: PositionedGraph | null;
  meta: DiagramMeta | null;
  isGhost: boolean;
  onFocus: (nodeId: string, hopCount: number) => void;
  onShowNeighbors: (nodeId: string) => void;
  onAddToView: (nodeId: string) => void;
}): JSX.Element {
  const { node, graph, meta, isGhost, onFocus, onShowNeighbors, onAddToView } = props;
  const playsIn = graph
    ? graph.edges
      .filter((e) => e.sourceNodeId === node.id || e.targetNodeId === node.id)
      .map((e) => (e.sourceNodeId === node.id ? e.targetNodeId : e.sourceNodeId))
    : [];
  const factNames = new Map<string, string>();
  if (graph) {
    for (const id of playsIn) {
      const ft = graph.nodes.find(
        (n): n is PositionedFactTypeNode => n.id === id && n.kind === "fact_type",
      );
      if (ft) factNames.set(id, ft.name);
    }
  }
  return (
    <div className="inspector-body">
      <Header kind={isGhost ? "neighbor" : node.objectTypeKind} name={node.name} />
      {node.referenceMode && <Field label="Reference mode">{node.referenceMode}</Field>}
      {node.aliases && node.aliases.length > 0 && (
        <Field label="Aliases">{node.aliases.join(", ")}</Field>
      )}
      {node.annotations && node.annotations.length > 0 && (
        <Field label="Annotations">
          {node.annotations.map((a, i) => <div key={i}>{a}</div>)}
        </Field>
      )}
      {factNames.size > 0 && (
        <Field label={`Plays roles in (${factNames.size})`}>
          {[...factNames.values()].map((n, i) => <div key={i}>{n}</div>)}
        </Field>
      )}
      <ObjectTypeActions
        node={node}
        meta={meta}
        isGhost={isGhost}
        onFocus={onFocus}
        onShowNeighbors={onShowNeighbors}
        onAddToView={onAddToView}
      />
    </div>
  );
}

function ObjectTypeActions(props: {
  node: PositionedObjectTypeNode;
  meta: DiagramMeta | null;
  isGhost: boolean;
  onFocus: (nodeId: string, hopCount: number) => void;
  onShowNeighbors: (nodeId: string) => void;
  onAddToView: (nodeId: string) => void;
}): JSX.Element {
  const { node, meta, isGhost, onFocus, onShowNeighbors, onAddToView } = props;
  const activeHop = meta?.focus?.entityId === node.id ? meta.focus.hopCount : null;
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
            onClick={() => onFocus(node.id, hop)}
          >
            {hop} {hop === 1 ? "hop" : "hops"}
          </button>
        ))}
      </div>
      {viewActive && isGhost && (
        <button
          type="button"
          className="inspector-action"
          onClick={() => onAddToView(node.id)}
        >
          Add to view
        </button>
      )}
      {viewActive && !isGhost && (
        <button
          type="button"
          className="inspector-action"
          title="Preview entities adjacent to the current view as ghosts"
          onClick={() => onShowNeighbors(node.id)}
        >
          Show neighbors
        </button>
      )}
    </div>
  );
}

function FactTypeDetail(props: { node: PositionedFactTypeNode; }): JSX.Element {
  const { node } = props;
  const arity = node.roles.length;
  const arityLabel = arity === 1
    ? "unary"
    : arity === 2
    ? "binary"
    : arity === 3
    ? "ternary"
    : `${arity}-ary`;
  return (
    <div className="inspector-body">
      <Header kind="fact" name={node.name} />
      <Field label="Arity">{arityLabel}</Field>
      <Field label="Orientation">{node.orientation}</Field>
      {node.isObjectified && (
        <Field label="Objectified as">{node.objectifiedEntityName ?? node.name}</Field>
      )}
      {node.ringConstraint && <Field label="Ring constraint">{node.ringConstraint.label}</Field>}
      <Field label={`Roles (${arity})`}>
        {node.roles.map((r, i) => (
          <div key={r.roleId} className="inspector-role">
            <span className="inspector-role-idx">{i + 1}</span>
            <span className="inspector-role-name">{r.roleName || "(unnamed)"}</span>
            <span className="inspector-role-player">{r.playerName}</span>
            {r.isMandatory && <span className="inspector-tag">mand</span>}
            {r.hasUniqueness && <span className="inspector-tag">uniq</span>}
          </div>
        ))}
      </Field>
      {node.hasSpanningUniqueness && <Field label="Uniqueness">spanning all roles</Field>}
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
